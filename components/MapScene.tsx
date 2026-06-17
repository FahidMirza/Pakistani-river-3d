"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { TerrainLayer, TripsLayer } from "@deck.gl/geo-layers";
import { PathLayer, ColumnLayer, SolidPolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { MapViewState } from "@deck.gl/core";
import type { RiverFeature, RiverCollection } from "@/lib/rivers";
import { DAM_MARKERS } from "@/lib/rivers";
import type { SnapshotData } from "@/app/api/snapshot/route";
import type { DamLevel } from "@/lib/wapda";

// ── Tile sources ──────────────────────────────────────────────────────────────
const TERRAIN_IMAGE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const SURFACE_IMAGES = {
  dark:      "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
} as const;

export type MapMode = keyof typeof SURFACE_IMAGES;

// 3× elevation exaggeration — makes Karakoram / Himalaya tower dramatically
const ELEV = 3;
const ELEVATION_DECODER = {
  rScaler: 256 * ELEV,
  gScaler: 1 * ELEV,
  bScaler: (1 / 256) * ELEV,
  offset: -32768 * ELEV,
};

// ── Camera ────────────────────────────────────────────────────────────────────
const INITIAL_VIEW_STATE: MapViewState = {
  latitude: 29.5,
  longitude: 70.5,
  zoom: 5.4,
  pitch: 62,
  bearing: 8,
  minZoom: 3,
  maxZoom: 13,
};

// ── Fallback colour when API hasn't loaded yet ────────────────────────────────
const FALLBACK_COLOR: [number, number, number] = [0, 130, 220];

// Full reservoir-capacity column height (water rises within this)
const DAM_CAP_HEIGHT = 16000;

interface RiverTrip {
  path: [number, number][];
  timestamps: number[];
  color: [number, number, number];
  riverName: string;
}

// Anchor a river label roughly at the middle of its traced path
function labelPoint(feature: RiverFeature): [number, number] {
  const coords = feature.geometry.coordinates as [number, number][];
  return coords[Math.floor(coords.length / 2)] ?? coords[0];
}

function toTrip(feature: RiverFeature): RiverTrip {
  const coords = feature.geometry.coordinates as [number, number][];
  const n = coords.length;
  return {
    riverName: feature.properties.name,
    path: coords,
    timestamps: coords.map((_, i) => i / Math.max(n - 1, 1)),
    color: feature.properties.color,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
interface MapSceneProps {
  onSnapshot?: (s: SnapshotData) => void;
  mode?: MapMode;
}

export default function MapScene({ onSnapshot, mode = "dark" }: MapSceneProps) {
  const [rivers, setRivers] = useState<RiverFeature[]>([]);
  const [trips, setTrips] = useState<RiverTrip[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [pakBorder, setPakBorder] = useState<[number, number][][]>([]);

  // rAF clock — single master time 0→1 looping
  const timeRef = useRef(0);
  const [tick, setTick] = useState(0);

  // Auto-orbit camera (for cinematic recording) — on by default
  const [orbit, setOrbit] = useState(true);
  const orbitRef = useRef(true);
  useEffect(() => {
    orbitRef.current = orbit;
  }, [orbit]);

  // Load Pakistan boundary
  useEffect(() => {
    fetch("/pakistan-border.geojson")
      .then((r) => r.json())
      .then((data) => {
        // Natural Earth gives a Polygon; grab every ring as a path
        const feature = data.features?.[0];
        if (!feature) return;
        const geom = feature.geometry;
        const rings: [number, number][][] =
          geom.type === "MultiPolygon"
            ? geom.coordinates.flat()
            : geom.coordinates;
        setPakBorder(rings);
      })
      .catch(console.error);
  }, []);

  // Load river geometry
  useEffect(() => {
    fetch("/rivers.geojson")
      .then((r) => r.json())
      .then((data: RiverCollection) => {
        setRivers(data.features);
        setTrips(data.features.map(toTrip));
      })
      .catch(console.error);
  }, []);

  // Fetch discharge snapshot from our cached API route
  useEffect(() => {
    fetch("/api/snapshot")
      .then((r) => r.json())
      .then((data: SnapshotData) => {
        setSnapshot(data);
        onSnapshot?.(data);
      })
      .catch(console.error);
  }, [onSnapshot]);

  // Animation loop
  useEffect(() => {
    let rafId: number;
    const animate = () => {
      timeRef.current = (timeRef.current + 0.0006) % 1;
      setTick((t) => t + 1);
      if (orbitRef.current) {
        setViewState((vs) => ({
          ...vs,
          bearing: (((vs.bearing ?? 0) + 0.06) % 360),
        }));
      }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const onViewStateChange = useCallback(
    ({
      viewState: vs,
      interactionState,
    }: {
      viewState: MapViewState;
      interactionState?: { isDragging?: boolean };
    }) => {
      // Hand control to the user the moment they drag (pan/rotate)
      if (interactionState?.isDragging) {
        setOrbit(false);
      }
      setViewState(vs);
    },
    []
  );

  // WebGL constants (numeric — no @luma.gl/constants needed)
  const GL_SRC_ALPHA = 770;  // 0x0302
  const GL_ONE       = 1;    // additive: dst += src*alpha → true bloom on dark bg

  // Additive blend: layers add light to whatever's behind them
  const additive = { depthTest: false, blend: true, blendFunc: [GL_SRC_ALPHA, GL_ONE] } as const;
  // Normal alpha for the solid core line
  const noDepth  = { depthTest: false } as const;
  const t = timeRef.current;

  function riverColor(name: string): [number, number, number] {
    return snapshot?.rivers[name]?.color ?? FALLBACK_COLOR;
  }

  // Zoom-aware label size: small when zoomed out, larger (clamped) when zoomed in
  const zoom = viewState.zoom ?? INITIAL_VIEW_STATE.zoom ?? 5.4;
  const labelSize = Math.max(9, Math.min(17, 8 + (zoom - 4) * 1.5));

  // ── Layers ─────────────────────────────────────────────────────────────────
  const layers = [
    // id includes mode so deck.gl fully remounts the layer on switch
    new TerrainLayer({
      id: `terrain-${mode}`,
      minZoom: 0,
      maxZoom: 9,
      strategy: "no-overlap",
      elevationDecoder: ELEVATION_DECODER,
      elevationData: TERRAIN_IMAGE,
      texture: SURFACE_IMAGES[mode],
      wireframe: false,
      meshMaxError: 4,
    }),

    // ── Pakistan boundary ────────────────────────────────────────────────────
    // Subtle territory fill — tints Pakistan's area against neighbours
    new SolidPolygonLayer({
      id: "pak-fill",
      data: pakBorder,
      getPolygon: (d) => d,
      getFillColor: [30, 160, 255, mode === "dark" ? 18 : 10],
      stroked: false,
      filled: true,
      parameters: { depthTest: false },
    }),

    // Border outer glow
    new PathLayer({
      id: "pak-border-glow",
      data: pakBorder,
      getPath: (d) => d,
      getColor: [200, 240, 255, 60],
      getWidth: 8000,
      widthMinPixels: 6,
      widthMaxPixels: 16,
      jointRounded: true,
      parameters: { depthTest: false, blend: true, blendFunc: [GL_SRC_ALPHA, GL_ONE] },
    }),

    // Border crisp inner line
    new PathLayer({
      id: "pak-border-core",
      data: pakBorder,
      getPath: (d) => d,
      getColor: [220, 245, 255, 200],
      getWidth: 1500,
      widthMinPixels: 1.5,
      widthMaxPixels: 3,
      jointRounded: true,
      parameters: { depthTest: false },
    }),

    // ── River neon stack — 4 additive bloom passes + a white-hot center line ──
    // Pass 1: widest, faintest halo — soft atmospheric bloom
    new PathLayer<RiverFeature>({
      id: "rivers-halo",
      data: rivers,
      getPath: (d) => d.geometry.coordinates as [number, number][],
      getColor: (d) => [...riverColor(d.properties.name), 22] as [number, number, number, number],
      getWidth: (d) => d.properties.width * 20000,
      widthMinPixels: 38,
      widthMaxPixels: 90,
      jointRounded: true,
      capRounded: true,
      parameters: additive,
      updateTriggers: { getColor: [snapshot] },
    }),

    // Pass 2: wide soft bloom
    new PathLayer<RiverFeature>({
      id: "rivers-bloom",
      data: rivers,
      getPath: (d) => d.geometry.coordinates as [number, number][],
      getColor: (d) => [...riverColor(d.properties.name), 48] as [number, number, number, number],
      getWidth: (d) => d.properties.width * 9000,
      widthMinPixels: 20,
      widthMaxPixels: 48,
      jointRounded: true,
      capRounded: true,
      parameters: additive,
      updateTriggers: { getColor: [snapshot] },
    }),

    // Pass 3: mid glow — saturated colour body
    new PathLayer<RiverFeature>({
      id: "rivers-glow",
      data: rivers,
      getPath: (d) => d.geometry.coordinates as [number, number][],
      getColor: (d) => [...riverColor(d.properties.name), 120] as [number, number, number, number],
      getWidth: (d) => d.properties.width * 3600,
      widthMinPixels: 9,
      widthMaxPixels: 22,
      jointRounded: true,
      capRounded: true,
      parameters: additive,
      updateTriggers: { getColor: [snapshot] },
    }),

    // Pass 4: tight bright colour core — additive so it reinforces the glow
    new PathLayer<RiverFeature>({
      id: "rivers-core",
      data: rivers,
      getPath: (d) => d.geometry.coordinates as [number, number][],
      getColor: (d) => [...riverColor(d.properties.name), 200] as [number, number, number, number],
      getWidth: (d) => d.properties.width * 1400,
      widthMinPixels: 3,
      widthMaxPixels: 9,
      jointRounded: true,
      capRounded: true,
      parameters: additive,
      updateTriggers: { getColor: [snapshot] },
    }),

    // Pass 5: white-hot center line — thin bright filament down the middle
    new PathLayer<RiverFeature>({
      id: "rivers-hot",
      data: rivers,
      getPath: (d) => d.geometry.coordinates as [number, number][],
      getColor: (d) => {
        const c = riverColor(d.properties.name);
        return [
          Math.min(255, c[0] + 140),
          Math.min(255, c[1] + 120),
          Math.min(255, c[2] + 90),
          230,
        ] as [number, number, number, number];
      },
      getWidth: (d) => d.properties.width * 500,
      widthMinPixels: 1,
      widthMaxPixels: 3.5,
      jointRounded: true,
      capRounded: true,
      parameters: additive,
      updateTriggers: { getColor: [snapshot] },
    }),

    // Comet pulses — two TripsLayers per river: a soft wide glow trail
    // beneath a white-hot narrow head. Both additive so they truly blaze.
    ...trips.flatMap((trip) => {
      const info = snapshot?.rivers[trip.riverName];
      const speedMult = info?.speedMultiplier ?? 1;
      const trailLength = info?.trailLength ?? 0.10;
      const col = info?.color ?? trip.color;
      const ct = (t * speedMult) % 1;

      const glowCol: [number, number, number] = [
        Math.min(255, col[0] + 50),
        Math.min(255, col[1] + 50),
        Math.min(255, col[2] + 30),
      ];
      const hotCol: [number, number, number] = [
        Math.min(255, col[0] + 150),
        Math.min(255, col[1] + 140),
        Math.min(255, col[2] + 110),
      ];

      return [
        // Wide soft glow trail
        new TripsLayer<RiverTrip>({
          id: `trips-glow-${trip.riverName}`,
          data: [trip],
          getPath: (d) => d.path,
          getTimestamps: (d) => d.timestamps,
          getColor: () => glowCol,
          opacity: 1,
          widthMinPixels: 10,
          widthMaxPixels: 28,
          trailLength: trailLength * 1.4,
          currentTime: ct,
          jointRounded: true,
          capRounded: true,
          parameters: additive,
        }),
        // White-hot narrow head
        new TripsLayer<RiverTrip>({
          id: `trips-hot-${trip.riverName}`,
          data: [trip],
          getPath: (d) => d.path,
          getTimestamps: (d) => d.timestamps,
          getColor: () => hotCol,
          opacity: 1,
          widthMinPixels: 3,
          widthMaxPixels: 9,
          trailLength: trailLength * 0.55,
          currentTime: ct,
          jointRounded: true,
          capRounded: true,
          parameters: additive,
        }),
      ];
    }),

    // ── Dams as luminous water vessels ───────────────────────────────────────
    // 0..1 sine pulse for the breathing base glow
    new ScatterplotLayer({
      id: "dam-base-glow",
      data: DAM_MARKERS,
      getPosition: (d) => d.position,
      getRadius: () => 7000 + Math.sin(t * Math.PI * 2) * 1500,
      getFillColor: (d) => {
        const live = snapshot?.dams?.find((x) => x.name === d.key);
        const fill = live?.fillFraction ?? d.fillFraction;
        return [255, Math.round(170 + fill * 70), 60, 45] as [number, number, number, number];
      },
      radiusMinPixels: 6,
      radiusMaxPixels: 24,
      stroked: false,
      parameters: additive,
      updateTriggers: { getRadius: [tick], getFillColor: [snapshot?.dams] },
    }),

    // Glass capacity cage — wireframe only (no fill), shows full dead→max height
    new ColumnLayer({
      id: "dam-vessel",
      data: DAM_MARKERS,
      diskResolution: 48,
      getPosition: (d) => d.position,
      getLineColor: [190, 225, 255, 150],
      getElevation: DAM_CAP_HEIGHT,
      radius: 6500,
      radiusMinPixels: 5,
      radiusMaxPixels: 16,
      extruded: true,
      filled: false,
      stroked: true,
      lineWidthMinPixels: 1,
      pickable: true,
      parameters: noDepth,
    }),

    // Glowing water inside — rises to the real fill fraction
    new ColumnLayer({
      id: "dam-water",
      data: DAM_MARKERS,
      diskResolution: 48,
      getPosition: (d) => d.position,
      getFillColor: (d) => {
        const live = snapshot?.dams?.find((x) => x.name === d.key);
        const fill = live?.fillFraction ?? d.fillFraction;
        // low fill → cool teal, high fill → warm amber (alert)
        return [
          Math.round(40 + fill * 200),
          Math.round(200 - fill * 30),
          Math.round(210 - fill * 150),
          235,
        ] as [number, number, number, number];
      },
      getElevation: (d) => {
        const live = snapshot?.dams?.find((x) => x.name === d.key);
        return (live?.fillFraction ?? d.fillFraction) * DAM_CAP_HEIGHT;
      },
      radius: 5600,
      radiusMinPixels: 4,
      radiusMaxPixels: 14,
      extruded: true,
      stroked: true,
      getLineColor: [255, 255, 255, 220],
      lineWidthMinPixels: 1,
      pickable: true,
      parameters: noDepth,
      updateTriggers: { getElevation: [snapshot?.dams], getFillColor: [snapshot?.dams] },
    }),

    // Light beam — thin tall shaft shooting up from the vessel
    new ColumnLayer({
      id: "dam-beam",
      data: DAM_MARKERS,
      diskResolution: 16,
      getPosition: (d) => d.position,
      getFillColor: (d) => {
        const live = snapshot?.dams?.find((x) => x.name === d.key);
        const fill = live?.fillFraction ?? d.fillFraction;
        return [255, Math.round(220 - fill * 60), 160, 90] as [number, number, number, number];
      },
      getElevation: DAM_CAP_HEIGHT * 2.6,
      radius: 1100,
      radiusMinPixels: 1.5,
      radiusMaxPixels: 4,
      extruded: true,
      stroked: false,
      parameters: additive,
      updateTriggers: { getFillColor: [snapshot?.dams] },
    }),

    // ── Labels (zoom-aware text) ─────────────────────────────────────────────
    // River names — tinted to match each river, with a dark halo for legibility
    new TextLayer<RiverFeature>({
      id: "river-labels",
      data: rivers,
      getPosition: (d) => labelPoint(d),
      getText: (d) => d.properties.name,
      getSize: labelSize,
      getColor: (d) => {
        const c = riverColor(d.properties.name);
        return [
          Math.min(255, c[0] + 120),
          Math.min(255, c[1] + 110),
          Math.min(255, c[2] + 90),
          255,
        ] as [number, number, number, number];
      },
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      getPixelOffset: [0, -10],
      billboard: true,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontWeight: 700,
      characterSet: "auto",
      fontSettings: { sdf: true },
      outlineWidth: 3,
      outlineColor: [3, 6, 16, 255],
      parameters: { depthTest: false },
      updateTriggers: { getSize: [labelSize], getColor: [snapshot], getText: 1 },
    }),

    // Dam names — warm tint, lifted above the vessel beam
    new TextLayer<(typeof DAM_MARKERS)[number]>({
      id: "dam-labels",
      data: DAM_MARKERS,
      getPosition: (d) => d.position,
      getText: (d) => d.name,
      getSize: labelSize * 0.92,
      getColor: [255, 224, 170, 255],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      getPixelOffset: [0, -26],
      billboard: true,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontWeight: 700,
      characterSet: "auto",
      fontSettings: { sdf: true },
      outlineWidth: 3,
      outlineColor: [3, 6, 16, 255],
      parameters: { depthTest: false },
      updateTriggers: { getSize: [labelSize], getText: 1 },
    }),

    // Dam fill percentage — small caption under the dam name
    new TextLayer<(typeof DAM_MARKERS)[number]>({
      id: "dam-pct",
      data: DAM_MARKERS,
      getPosition: (d) => d.position,
      getText: (d) => {
        const live = snapshot?.dams?.find((x) => x.name === d.key);
        const fill = live?.fillFraction ?? d.fillFraction;
        return `${Math.round(fill * 100)}% full`;
      },
      getSize: labelSize * 0.78,
      getColor: [180, 220, 255, 230],
      getTextAnchor: "start",
      getAlignmentBaseline: "center",
      getPixelOffset: [16, 0],
      billboard: true,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontWeight: 600,
      characterSet: "auto",
      fontSettings: { sdf: true },
      outlineWidth: 3,
      outlineColor: [3, 6, 16, 255],
      parameters: { depthTest: false },
      updateTriggers: { getSize: [labelSize], getText: [snapshot?.dams] },
    }),
  ];

  // Suppress unused-variable warning; tick is consumed only to trigger re-render
  void tick;

  return (
    <>
    <DeckGL
      viewState={viewState}
      onViewStateChange={onViewStateChange}
      controller={true}
      layers={layers}
      parameters={{ clearColor: [0.02, 0.02, 0.06, 1] }}
      getTooltip={({ object }: { object: unknown }) => {
        if (!object) return null;
        const dam = object as (typeof DAM_MARKERS)[0];
        if (dam?.name) {
          const live = snapshot?.dams?.find((x) => x.name === dam.key) as DamLevel | undefined;
          const fill = live?.fillFraction ?? dam.fillFraction;
          const pct = Math.round(fill * 100);
          const levelStr = live ? `${live.levelFt.toFixed(1)} ft` : "—";
          const srcBadge = live?.source === "live" ? "● WAPDA live" : "○ est.";
          const inflowStr = live?.inflowCusecs
            ? `${Math.round(live.inflowCusecs).toLocaleString()} cusecs in`
            : "";
          return {
            html: `<b>${dam.name}</b><br/>${dam.river} River<br/>Level: ${levelStr} · Fill: ${pct}%${inflowStr ? `<br/>${inflowStr}` : ""}<br/><span style="opacity:0.5;font-size:10px">${srcBadge}</span>`,
            style: {
              background: "rgba(5,5,20,0.92)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              fontSize: "12px",
              padding: "6px 10px",
            },
          };
        }
        const river = object as RiverFeature;
        if (river?.properties?.name) {
          const info = snapshot?.rivers[river.properties.name];
          const q = info ? `${Math.round(info.discharge).toLocaleString()} m³/s` : "loading…";
          return {
            html: `<b>${river.properties.name} River</b><br/>Discharge: ${q}`,
            style: {
              background: "rgba(5,5,20,0.92)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              fontSize: "12px",
              padding: "6px 10px",
            },
          };
        }
        return null;
      }}
      style={{ width: "100%", height: "100%" }}
    />

      {/* Auto-orbit toggle */}
      <button
        onClick={() => setOrbit((o) => !o)}
        className="absolute right-4 top-16 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-sm transition hover:bg-white/10 hover:text-white"
        title="Toggle auto-orbit camera"
      >
        {orbit ? (
          <>
            <span>⏸</span> Orbiting
          </>
        ) : (
          <>
            <span>↻</span> Orbit
          </>
        )}
      </button>
    </>
  );
}
