import type { Feature, LineString, FeatureCollection } from "geojson";

export interface RiverProperties {
  name: string;
  order: number;
  color: [number, number, number];
  width: number;
}

export type RiverFeature = Feature<LineString, RiverProperties>;
export type RiverCollection = FeatureCollection<LineString, RiverProperties>;

export const DAM_MARKERS = [
  {
    key: "Tarbela",
    name: "Tarbela Dam",
    river: "Indus",
    position: [72.69, 34.09] as [number, number],
    deadLevel: 1402,
    maxLevel: 1550,
    fillFraction: 0.72,
    color: [255, 220, 60] as [number, number, number],
  },
  {
    key: "Mangla",
    name: "Mangla Dam",
    river: "Jhelum",
    position: [73.64, 33.14] as [number, number],
    deadLevel: 1050,
    maxLevel: 1242,
    fillFraction: 0.65,
    color: [255, 200, 40] as [number, number, number],
  },
  {
    key: "Chashma",
    name: "Chashma Barrage",
    river: "Indus",
    position: [71.38, 32.43] as [number, number],
    deadLevel: 640,
    maxLevel: 649,
    fillFraction: 0.80,
    color: [255, 180, 30] as [number, number, number],
  },
];
