export interface SamplePoint {
  riverName: string;
  lat: number;
  lon: number;
  /** Approximate 50-year peak discharge in m³/s — used for log-scale normalisation */
  historicMax: number;
}

/**
 * One sampling coordinate per river (on or very near the main channel).
 * Coordinates nudged ≤ 0.1° toward the channel so GloFAS returns the right river.
 */
export const SAMPLE_POINTS: SamplePoint[] = [
  { riverName: "Indus",  lat: 34.10, lon: 72.68, historicMax: 28000 }, // Tarbela
  { riverName: "Kabul",  lat: 34.02, lon: 71.96, historicMax: 5500  }, // Nowshera
  { riverName: "Jhelum", lat: 33.15, lon: 73.65, historicMax: 7500  }, // Mangla
  { riverName: "Chenab", lat: 32.68, lon: 74.47, historicMax: 11000 }, // Marala
  { riverName: "Ravi",   lat: 31.58, lon: 74.32, historicMax: 3500  }, // Shahdara/Lahore
  { riverName: "Sutlej", lat: 30.37, lon: 73.87, historicMax: 6500  }, // Sulemanki
];

export interface DischargeReading {
  riverName: string;
  discharge: number; // m³/s
  date: string;      // ISO date of the reading
}

/**
 * Fetch today's discharge for a single sample point from Open-Meteo Flood API.
 * Returns null if the API is unreachable or returns no data.
 */
export async function fetchDischarge(
  point: SamplePoint,
  signal?: AbortSignal
): Promise<DischargeReading | null> {
  const url =
    `https://flood-api.open-meteo.com/v1/flood` +
    `?latitude=${point.lat}&longitude=${point.lon}` +
    `&daily=river_discharge&past_days=3&forecast_days=0`;

  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json();
    const times: string[] = data.daily?.time ?? [];
    const discharges: (number | null)[] = data.daily?.river_discharge ?? [];

    // Walk backwards to find the most recent non-null value
    for (let i = discharges.length - 1; i >= 0; i--) {
      if (discharges[i] !== null) {
        return {
          riverName: point.riverName,
          discharge: discharges[i] as number,
          date: times[i],
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
