"use client";

import type { SnapshotData } from "@/app/api/snapshot/route";

const RIVERS = [
  { name: "Indus",  label: "Indus" },
  { name: "Kabul",  label: "Kabul" },
  { name: "Jhelum", label: "Jhelum" },
  { name: "Chenab", label: "Chenab" },
  { name: "Ravi",   label: "Ravi" },
  { name: "Sutlej", label: "Sutlej" },
];

interface LegendProps {
  snapshot: SnapshotData | null;
}

export default function Legend({ snapshot }: LegendProps) {
  const hasData = snapshot && Object.keys(snapshot.rivers).length > 0;

  return (
    <div className="absolute bottom-4 left-4 z-10 w-64 rounded-xl border border-white/10 bg-black/75 px-4 py-3 text-xs text-slate-300 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Pakistan Rivers — Live</span>
        {hasData ? (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            Live
          </span>
        ) : (
          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
            Loading…
          </span>
        )}
      </div>

      {/* Discharge colour ramp */}
      <div className="mb-3">
        <div className="mb-1 text-slate-400">Daily Discharge</div>
        <div className="flex items-center gap-2">
          <div
            className="h-2 w-32 rounded-full"
            style={{ background: "linear-gradient(to right, #0a287e, #008cdc, #78f0ff)" }}
          />
          <span className="text-slate-500">Low → High</span>
        </div>
      </div>

      {/* Per-river discharge values */}
      <div className="mb-3 space-y-1.5">
        {RIVERS.map(({ name, label }) => {
          const info = snapshot?.rivers[name];
          const col = info
            ? `rgb(${info.color[0]},${info.color[1]},${info.color[2]})`
            : "rgb(0,130,220)";
          const q = info
            ? `${Math.round(info.discharge).toLocaleString()} m³/s`
            : "—";

          return (
            <div key={name} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="h-[3px] w-5 rounded-full flex-shrink-0"
                  style={{ background: col, boxShadow: `0 0 6px ${col}` }}
                />
                <span className="text-slate-300">{label}</span>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">{q}</span>
            </div>
          );
        })}
      </div>

      {/* Dam levels */}
      <div className="mb-3">
        <div className="mb-1.5 text-slate-400">Reservoirs</div>
        {[
          { name: "Tarbela", river: "Indus",  dead: 1402, max: 1550 },
          { name: "Mangla",  river: "Jhelum", dead: 1050, max: 1242 },
          { name: "Chashma", river: "Indus",  dead: 640,  max: 649  },
        ].map(({ name, river, dead, max }) => {
          const dam = snapshot?.dams?.find((d) => d.name === name);
          const fill = dam?.fillFraction ?? 0.5;
          const pct  = Math.round(fill * 100);
          const isLive = dam?.source === "live";
          return (
            <div key={name} className="mb-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">
                  {name}
                  <span className="ml-1 text-slate-500">({river})</span>
                </span>
                <span className="flex items-center gap-1 font-mono tabular-nums text-slate-400">
                  {dam ? `${dam.levelFt.toFixed(0)} ft` : "— ft"}
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isLive ? "bg-emerald-400" : "bg-yellow-600"
                    }`}
                    title={isLive ? "WAPDA live" : "estimated"}
                  />
                </span>
              </div>
              {/* Fill bar */}
              <div className="mt-0.5 h-1 w-full rounded-full bg-white/10">
                <div
                  className="h-1 rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: `rgb(255,${Math.round(180 + fill * 60)},${Math.round(20 + fill * 40)})`,
                    boxShadow: `0 0 4px rgb(255,${Math.round(180 + fill * 60)},40)`,
                  }}
                />
              </div>
              <div className="mt-0.5 text-[9px] text-slate-600">
                dead {dead} ft · max {max} ft · {pct}% full
              </div>
            </div>
          );
        })}
      </div>

      {/* Data freshness */}
      {snapshot?.fetchedAt && (
        <div className="mb-2 text-[10px] text-slate-500">
          Updated:{" "}
          {new Date(snapshot.fetchedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {snapshot.rivers.Indus?.date && ` · data ${snapshot.rivers.Indus.date}`}
        </div>
      )}

      {/* Attribution */}
      <div className="border-t border-white/10 pt-2 text-[10px] leading-snug text-slate-500">
        Discharge: Open-Meteo / GloFAS (CC BY 4.0) · Reservoir: WAPDA/IRSA · Terrain: AWS
        Terrarium · Rivers: Natural Earth / HydroSHEDS
      </div>
    </div>
  );
}
