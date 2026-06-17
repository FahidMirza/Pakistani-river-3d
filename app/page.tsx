"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import Legend from "@/components/Legend";
import type { SnapshotData } from "@/app/api/snapshot/route";
import type { MapMode } from "@/components/MapScene";

const MapScene = dynamic(() => import("@/components/MapScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-slate-500">
      Loading 3D terrain…
    </div>
  ),
});

export default function Home() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [mode, setMode] = useState<MapMode>("dark");

  const handleSnapshot = useCallback((s: SnapshotData) => setSnapshot(s), []);
  const toggleMode = useCallback(
    () => setMode((m) => (m === "dark" ? "satellite" : "dark")),
    []
  );

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#05050f]">
      <MapScene onSnapshot={handleSnapshot} mode={mode} />
      <Legend snapshot={snapshot} />

      {/* Title */}
      <div className="pointer-events-none absolute left-4 top-4 z-10">
        <h1 className="text-xl font-bold tracking-wide text-white drop-shadow-lg">
          Pakistan Rivers
        </h1>
        <p className="text-xs text-slate-400">Live daily discharge · 3D hydrology</p>
      </div>

      {/* Mode toggle */}
      <button
        onClick={toggleMode}
        className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-sm transition hover:bg-white/10 hover:text-white"
        title="Toggle map style"
      >
        {mode === "dark" ? (
          <>
            <span>🛰️</span> Satellite
          </>
        ) : (
          <>
            <span>🌙</span> Dark
          </>
        )}
      </button>
    </main>
  );
}
