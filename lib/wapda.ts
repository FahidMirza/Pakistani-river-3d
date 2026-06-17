/**
 * Scrapes WAPDA / IRSA daily water situation reports for reservoir levels.
 *
 * Reality check: these pages are HTML/PDF, change layout often, and are
 * sometimes down. Strategy: try multiple URLs → tolerant regex → never crash.
 * If every source fails, return fallback values so the app never goes blank.
 */

export interface DamLevel {
  name: string;
  levelFt: number;
  inflowCusecs: number | null;
  outflowCusecs: number | null;
  fillFraction: number; // 0–1 between dead and max level
  source: "live" | "fallback";
}

const DAM_BOUNDS: Record<string, { dead: number; max: number }> = {
  Tarbela: { dead: 1402, max: 1550 },
  Mangla:  { dead: 1050, max: 1242 },
  Chashma: { dead: 640,  max: 649  },
};

// Typical pre-monsoon (June) fallback values in feet
const FALLBACK_LEVELS: Record<string, number> = {
  Tarbela: 1465,
  Mangla:  1162,
  Chashma: 644,
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function fillFraction(name: string, levelFt: number): number {
  const b = DAM_BOUNDS[name];
  if (!b) return 0.5;
  return clamp((levelFt - b.dead) / (b.max - b.dead), 0, 1);
}

/**
 * Parse a reservoir level (feet) from an HTML blob.
 * Tries several pattern families to survive layout changes.
 */
function parseLevel(html: string, dam: string): number | null {
  const b = DAM_BOUNDS[dam];
  if (!b) return null;

  const lo = b.dead - 60;
  const hi = b.max + 20;

  // Four increasingly loose patterns:
  const patterns = [
    // "Tarbela  1465.23" — plain number after name (whitespace / colon / dash)
    new RegExp(`${dam}[^\\d]{0,40}(1[0-9]{3}\\.?[0-9]{0,2})`, "i"),
    // Level in feet: "1465.23 ft" within 300 chars of dam name
    new RegExp(
      `${dam}[\\s\\S]{0,300}?(1[0-9]{3}\\.?[0-9]{0,2})\\s*(?:ft|feet)`,
      "i"
    ),
    // Table cell after dam name: <td>1465.23</td>
    new RegExp(
      `${dam}[\\s\\S]{0,500}?<td[^>]*>\\s*(1[0-9]{3}\\.?[0-9]{0,2})\\s*</td>`,
      "i"
    ),
    // Reversed: number then dam name within 80 chars
    new RegExp(`(1[0-9]{3}\\.?[0-9]{0,2})[^\\d]{0,80}${dam}`, "i"),
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (v >= lo && v <= hi) return v;
    }
  }
  return null;
}

/**
 * Parse inflow / outflow in cusecs (order: inflow then outflow after dam name).
 */
function parseFlow(html: string, dam: string): [number | null, number | null] {
  const re = new RegExp(
    `${dam}[\\s\\S]{0,600}?([0-9]{2,6}(?:\\.[0-9]{1,2})?)\\s*[\\s|,/\\-]{1,10}\\s*([0-9]{2,6}(?:\\.[0-9]{1,2})?)`,
    "i"
  );
  const m = html.match(re);
  if (!m) return [null, null];
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  // Sanity: cusecs for Pakistan major dams are typically 1,000 – 500,000
  const valid = (n: number) => n >= 500 && n <= 800_000;
  return [valid(a) ? a : null, valid(b) ? b : null];
}

const SCRAPE_URLS = [
  // IRSA daily situation
  "https://www.irsa.gov.pk/site/river_flows",
  "https://www.irsa.gov.pk/",
  // WAPDA water situation
  "https://www.wapda.gov.pk/index.php/real-time-hydrological-data",
  "https://www.wapda.gov.pk/",
];

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PakistanRiversBot/1.0; +https://github.com/)",
        Accept: "text/html",
      },
      // 8 s timeout — WAPDA can be slow
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchDamLevels(): Promise<DamLevel[]> {
  // Try sources in order; stop at the first that gives usable HTML
  let html = "";
  for (const url of SCRAPE_URLS) {
    const h = await fetchHtml(url);
    if (h && h.length > 500) {
      html = h;
      break;
    }
  }

  return Object.keys(DAM_BOUNDS).map((name) => {
    const levelFt = html ? parseLevel(html, name) : null;

    if (levelFt !== null) {
      const [inflow, outflow] = parseFlow(html, name);
      return {
        name,
        levelFt,
        inflowCusecs: inflow,
        outflowCusecs: outflow,
        fillFraction: fillFraction(name, levelFt),
        source: "live" as const,
      };
    }

    // Fallback — never leave the UI empty
    const fb = FALLBACK_LEVELS[name] ?? (DAM_BOUNDS[name].dead + DAM_BOUNDS[name].max) / 2;
    return {
      name,
      levelFt: fb,
      inflowCusecs: null,
      outflowCusecs: null,
      fillFraction: fillFraction(name, fb),
      source: "fallback" as const,
    };
  });
}
