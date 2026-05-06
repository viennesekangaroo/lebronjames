"use client";

import { useEffect, useState } from "react";
import type { ComputedRecords } from "@/lib/api-types";
import { BallLoader } from "@/components/ball-loader";
import { useMinLoader } from "@/lib/use-min-loader";

// Hybrid records page: career-volume numbers come from the SQLite DB (always
// current with the seed); award counts, win shares, VORP, and "all-time #1"
// labels stay static because they require leaderboard context or voting data
// that's not in the DB. The footer shows when each section was last refreshed.

type StaticRecord = {
  value: string;
  label: string;
  detail?: string;
  // `crown: true` paints the value gold (signals all-time #1).
  crown?: boolean;
};
type StaticSection = {
  title: string;
  blurb?: string;
  records: StaticRecord[];
};

// Awards, leaderboard-context records, off-court — not derivable from our DB.
// Update by hand each season; the footer is dated.
const STATIC_LAST_VERIFIED = "2026-05";

const STATIC_SECTIONS: StaticSection[] = [
  {
    title: "Awards & recognition",
    records: [
      { value: "4", label: "Finals MVPs", crown: true },
      { value: "4", label: "regular-season MVPs", detail: "'09, '10, '12, '13" },
      { value: "21", label: "All-NBA selections", detail: "+6 over Kareem, Duncan, Kobe", crown: true },
      { value: "13", label: "All-NBA First Teams", detail: "+2 over Kobe, Malone", crown: true },
      { value: "22", label: "All-Star selections", detail: "+3 over Kareem", crown: true },
      { value: "69", label: "Player of the Week awards", crown: true },
      { value: "41", label: "Player of the Month awards", crown: true },
    ],
  },
  {
    title: "Records held — leaderboard context",
    blurb: "Outright #1 all-time. The numbers themselves we can compute; the rank requires every other player's totals.",
    records: [
      { value: "#1", label: "career points", detail: "passed Kareem, Feb 2023", crown: true },
      { value: "#1", label: "career games played", detail: "passed Robert Parish, Mar 2026", crown: true },
      { value: "#1", label: "playoff points", detail: "8,000+ ahead of #2", crown: true },
      { value: "#1", label: "consecutive double-digit games", detail: "1,297 straight", crown: true },
      { value: "#1", label: "playoff win shares", detail: "59.5 vs Jordan's 39.8", crown: true },
      { value: "#1", label: "regular-season win shares", crown: true },
      { value: "#1", label: "playoff VORP", crown: true },
      { value: "#1", label: "playoff buzzer-beaters", detail: "5 total", crown: true },
      { value: "#1", label: "points after age 40", crown: true },
      { value: "#1", label: "unique opponents faced", detail: "1,845", crown: true },
    ],
  },
  {
    title: "Advanced",
    blurb: "Win shares and VORP aren't in our box-score database — pulled from basketball-reference.",
    records: [
      { value: "275.6", label: "regular-season win shares" },
      { value: "59.5", label: "playoff win shares" },
      { value: "158.8", label: "regular-season VORP" },
      { value: "36.6", label: "playoff VORP" },
    ],
  },
  {
    title: "Off court",
    records: [
      { value: "$583.9M", label: "career on-court earnings" },
    ],
  },
];

type ApiErr = { code: string; message: string };

export function RecordsPage() {
  const [data, setData] = useState<ComputedRecords | null>(null);
  const [err, setErr] = useState<ApiErr | null>(null);
  const minLoading = useMinLoader(1000);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-records.json");
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          if (!cancelled) setErr({ code: "HTTP", message: `HTTP ${res.status}: ${text.slice(0, 300)}` });
          return;
        }
        if (!res.ok) {
          const b = body as { error?: string; message?: string } | null;
          if (!cancelled) setErr({ code: b?.error ?? "HTTP", message: b?.message ?? `HTTP ${res.status}` });
          return;
        }
        if (!cancelled) setData(body as ComputedRecords);
      } catch (e) {
        if (!cancelled) setErr({ code: "HTTP", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black px-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Error</div>
          <p className="font-mono text-xs text-red-400">{err.message}</p>
        </div>
      </div>
    );
  }
  if (!data || minLoading) {
    return (
      <div className="relative h-full w-full bg-black">
        <BallLoader color="#fdb927" />
      </div>
    );
  }

  // Build the "live" sections from the DB-derived payload.
  const liveSections: StaticSection[] = [
    {
      title: "Career volume — computed from DB",
      blurb: `Through ${data.lastGameDate}. Live numbers, regenerated every page load.`,
      records: [
        { value: data.totalPoints.toLocaleString(), label: "career points" },
        { value: data.totalGames.toLocaleString(), label: "career games" },
        { value: data.totalMinutes.toLocaleString(), label: "career minutes" },
        { value: data.seasons.toString(), label: "NBA seasons" },
        { value: data.championships.toString(), label: "championships", crown: true },
        { value: `${data.regWins.toLocaleString()}-${data.regLosses}`, label: "regular-season W-L", detail: `${pct(data.regWins, data.regWins + data.regLosses)}%` },
        { value: `${data.poWins}-${data.poLosses}`, label: "playoff W-L", detail: `${pct(data.poWins, data.poWins + data.poLosses)}%` },
        { value: data.regPoints.toLocaleString(), label: "regular-season points" },
        { value: data.poPoints.toLocaleString(), label: "playoff points" },
        { value: data.games30plus.toLocaleString(), label: "30-point games", detail: `${data.reg30plus.toLocaleString()} reg · ${data.po30plus} playoff` },
        { value: data.games40plusMin.toLocaleString(), label: "40+ minute games" },
        { value: data.totalDnp.toString(), label: "missed (DNP)" },
      ],
    },
  ];

  return (
    <div className="relative h-full w-full overflow-y-auto bg-black text-white">
      <div className="mx-auto max-w-[920px] px-8 pt-16 pb-32">
        <div className="mb-12">
          <div className="font-mono text-2xl font-light tracking-[0.15em] text-white/95">LeBron James</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.4em] text-white/40">
            Records · {data.firstGameDate} → {data.lastGameDate}
          </div>
          <p className="mt-6 max-w-[640px] text-sm leading-relaxed text-white/65">
            Career-volume numbers are computed from the same SQLite database that powers the rest of the
            site — they update whenever the seed is refreshed. Awards, win shares, and all-time-#1 rankings
            need leaderboard or voting data we don&apos;t ingest, so they&apos;re hand-verified from public sources.
          </p>
        </div>

        {[...liveSections, ...STATIC_SECTIONS].map((section, i) => (
          <section key={section.title} className={i === 0 ? "" : "mt-14"}>
            <h2 className="text-[10px] uppercase tracking-[0.4em] text-white/55">{section.title}</h2>
            {section.blurb && <p className="mt-2 max-w-[560px] text-xs text-white/45">{section.blurb}</p>}
            <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
              {section.records.map((r) => (
                <RecordRow key={`${section.title}-${r.label}`} record={r} />
              ))}
            </div>
          </section>
        ))}

        <div className="mt-20 space-y-1 border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.3em] text-white/35">
          <div>Live · regenerated {new Date(data.generatedAt).toLocaleDateString()}</div>
          <div>Static sections last verified · {STATIC_LAST_VERIFIED}</div>
        </div>
      </div>
    </div>
  );
}

function pct(num: number, denom: number): string {
  if (denom <= 0) return "0.0";
  return ((num / denom) * 100).toFixed(1);
}

function RecordRow({ record }: { record: StaticRecord }) {
  const valueClass = record.crown
    ? "font-mono text-3xl font-light leading-none text-[#FDB927]"
    : "font-mono text-3xl font-light leading-none text-white/95";
  return (
    <div className="flex items-baseline gap-4 border-b border-white/[0.06] pb-4">
      <div className="min-w-[140px] flex-shrink-0">
        <div className={valueClass}>{record.value}</div>
      </div>
      <div className="flex-1">
        <div className="text-xs uppercase tracking-[0.2em] text-white/75">{record.label}</div>
        {record.detail && <div className="mt-1 text-[11px] text-white/40">{record.detail}</div>}
      </div>
    </div>
  );
}
