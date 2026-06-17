import { NextResponse } from "next/server";
import { SAMPLE_POINTS, fetchDischarge } from "@/lib/openMeteo";
import { fetchDamLevels, type DamLevel } from "@/lib/wapda";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RiverDischargeInfo {
  discharge: number;
  normalized: number;
  color: [number, number, number];
  speedMultiplier: number;
  trailLength: number;
  date: string;
}

export interface SnapshotData {
  fetchedAt: string;
  rivers: Record<string, RiverDischargeInfo>;
  dams: DamLevel[];
}

// ── Server-side cache ─────────────────────────────────────────────────────────

let cached: SnapshotData | null = null;
let cachedAt = 0;
const TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ───────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function normalize(discharge: number, historicMax: number): number {
  return Math.min(Math.log1p(discharge) / Math.log1p(historicMax), 1);
}

/**
 * t = 0 → dark indigo [10, 40, 110]
 * t = 0.5 → vivid blue [0, 140, 220]
 * t = 1 → bright cyan [120, 240, 255]
 */
function toColor(t: number): [number, number, number] {
  if (t < 0.5) {
    const s = t * 2;
    return [
      Math.round(lerp(10, 0, s)),
      Math.round(lerp(40, 140, s)),
      Math.round(lerp(110, 220, s)),
    ];
  }
  const s = (t - 0.5) * 2;
  return [
    Math.round(lerp(0, 120, s)),
    Math.round(lerp(140, 240, s)),
    Math.round(lerp(220, 255, s)),
  ];
}

// ── Build snapshot ────────────────────────────────────────────────────────────

async function buildSnapshot(): Promise<SnapshotData> {
  // Fetch river discharge + dam levels in parallel
  const [readings, dams] = await Promise.all([
    Promise.all(SAMPLE_POINTS.map((p) => fetchDischarge(p))),
    fetchDamLevels(),
  ]);

  const rivers: Record<string, RiverDischargeInfo> = {};

  SAMPLE_POINTS.forEach((point, i) => {
    const reading = readings[i];
    if (!reading) return;
    const t = normalize(reading.discharge, point.historicMax);
    rivers[point.riverName] = {
      discharge: reading.discharge,
      normalized: t,
      color: toColor(t),
      speedMultiplier: lerp(0.4, 2.0, t),
      trailLength: lerp(0.05, 0.25, t),
      date: reading.date,
    };
  });

  return { fetchedAt: new Date().toISOString(), rivers, dams };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  if (cached && Date.now() - cachedAt < TTL_MS) {
    return NextResponse.json(cached);
  }

  try {
    const snapshot = await buildSnapshot();

    const hasRivers = Object.keys(snapshot.rivers).length > 0;
    const hasDams = snapshot.dams.length > 0;

    if (hasRivers || hasDams) {
      cached = snapshot;
      cachedAt = Date.now();
    } else if (cached) {
      return NextResponse.json(cached); // serve stale rather than empty
    }

    return NextResponse.json(snapshot);
  } catch {
    if (cached) return NextResponse.json(cached);
    return NextResponse.json({ fetchedAt: null, rivers: {}, dams: [] });
  }
}
