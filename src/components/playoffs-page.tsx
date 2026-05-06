"use client";

import { useEffect, useMemo, useState } from "react";
import { findTeam } from "@/lib/teams";
import type { PlayoffsPayload, FinalsEntry } from "@/lib/api-types";
import { BallLoader } from "@/components/ball-loader";

type ApiErr = { code: string; message: string };

const GOLD = "#FDB927";

export function PlayoffsPage() {
  const [data, setData] = useState<PlayoffsPayload | null>(null);
  const [err, setErr] = useState<ApiErr | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-playoffs.json");
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
        if (!cancelled) setData(body as PlayoffsPayload);
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
  if (!data) {
    return (
      <div className="relative h-full w-full bg-black">
        <BallLoader color="#c9a449" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-y-auto bg-black text-white">
      <div className="mx-auto max-w-[1100px] px-8 pt-16 pb-32">
        <header className="mb-12">
          <div className="font-mono text-2xl font-light tracking-[0.15em] text-white/95">
            Playoff Dominance
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.4em] text-white/40">
            Finals · 1947 → 2025 &nbsp;·&nbsp; Career playoff wins vs every franchise
          </div>
        </header>

        <FinalsTimeline data={data} />

        <div className="mt-24" />

        <FranchiseChart data={data} />
      </div>
    </div>
  );
}

// ─── Finals timeline ──────────────────────────────────────────────────────
//
// One column per Finals year. LeBron-Finals years are tall, team-colored (gold
// outline = championship, hollow = runner-up). Other years are tiny gray ticks.
// The proportion of "his" bars on the page is the visual answer to
// "12.8% of all Finals series in history."

function FinalsTimeline({ data }: { data: PlayoffsPayload }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const finals = data.finals;
  const lebronCount = data.lebronFinalsCount;
  const total = data.totalFinalsInHistory;

  return (
    <section>
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.4em] text-white/55">
            Every NBA Finals
          </h2>
          <p className="mt-2 max-w-[640px] text-xs text-white/45">
            One mark per championship series since 1947. Tall marks are the {lebronCount} Finals LeBron played in
            — that&apos;s {(data.finalsParticipationPct).toFixed(1)}% of every Finals ever contested.
          </p>
        </div>
        <div className="flex items-center gap-5 text-[10px] uppercase tracking-[0.3em] text-white/45">
          <span className="flex items-center gap-2">
            <span className="block h-3 w-1.5" style={{ backgroundColor: GOLD }} />
            won
          </span>
          <span className="flex items-center gap-2">
            <span className="block h-3 w-1.5 border" style={{ borderColor: GOLD }} />
            lost
          </span>
          <span className="flex items-center gap-2">
            <span className="block h-1 w-1.5 bg-white/30" />
            others
          </span>
        </div>
      </div>

      <div className="relative mt-6 h-[180px] w-full">
        {/* baseline */}
        <div className="absolute inset-x-0 bottom-10 h-px bg-white/10" />

        <div className="absolute inset-x-0 bottom-10 top-0 flex items-end gap-[2px]">
          {finals.map((f, i) => {
            const isLebron = !!f.lebron;
            const won = f.lebron?.team === "champion";
            const team = f.lebron ? findTeam(f.lebron.teamAbbr) : null;
            const baseColor = team?.primary ?? GOLD;
            const heightPct = isLebron ? 100 : 14;
            return (
              <div
                key={f.year}
                className="group relative flex-1 cursor-pointer"
                style={{ height: "100%" }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              >
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 transition-all"
                  style={{
                    height: `${heightPct}%`,
                    width: isLebron ? 8 : 3,
                    backgroundColor: isLebron && won ? baseColor : "transparent",
                    border: isLebron ? `1.5px solid ${baseColor}` : "none",
                    backgroundImage: !isLebron
                      ? "linear-gradient(to top, rgba(255,255,255,0.35), rgba(255,255,255,0.2))"
                      : undefined,
                    boxShadow:
                      hoverIdx === i && isLebron
                        ? `0 0 18px ${baseColor}88`
                        : undefined,
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* decade ticks */}
        <div className="absolute inset-x-0 bottom-0 h-10">
          <div className="relative h-full w-full">
            {finals.map((f, i) => {
              if (f.year % 10 !== 0) return null;
              const left = ((i + 0.5) / finals.length) * 100;
              return (
                <div
                  key={f.year}
                  className="absolute -translate-x-1/2 text-[10px] uppercase tracking-[0.2em] text-white/35"
                  style={{ left: `${left}%`, top: 6 }}
                >
                  {String(f.year).slice(2)}
                </div>
              );
            })}
            <div className="absolute right-0 top-1.5 text-[10px] uppercase tracking-[0.2em] text-white/35">
              &apos;25
            </div>
          </div>
        </div>

        {/* hover card */}
        {hoverIdx !== null && (
          <FinalsHoverCard
            f={finals[hoverIdx]}
            anchor={(hoverIdx + 0.5) / finals.length}
          />
        )}
      </div>

      {/* summary strip */}
      <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat value={lebronCount.toString()} label="Finals appearances" />
        <Stat value={data.lebronFinalsWins.toString()} label="championships" gold />
        <Stat value={total.toString()} label="Finals in history" />
        <Stat
          value={`${data.finalsParticipationPct.toFixed(1)}%`}
          label="of all Finals · LeBron"
          gold
        />
      </div>
    </section>
  );
}

function FinalsHoverCard({ f, anchor }: { f: FinalsEntry; anchor: number }) {
  const isLebron = !!f.lebron;
  const lebronWon = f.lebron?.team === "champion";
  const left = `${Math.min(Math.max(anchor * 100, 8), 92)}%`;

  return (
    <div
      className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded border border-white/15 bg-black/95 px-3 py-2 text-[11px] backdrop-blur"
      style={{ left, minWidth: 200 }}
    >
      <div className="font-mono text-xs text-white/95">{f.year} Finals</div>
      <div className="mt-1 text-white/80">
        <span className={lebronWon ? "text-[#FDB927]" : ""}>{f.champion}</span>
        <span className="text-white/40"> def. </span>
        {f.runnerUp}
        <span className="ml-2 text-white/45">{f.result}</span>
      </div>
      {isLebron && (
        <div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: GOLD }}>
          LeBron · {f.lebron!.team === "champion" ? "won" : "lost"} (with {f.lebron!.teamAbbr})
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, gold }: { value: string; label: string; gold?: boolean }) {
  return (
    <div className="border-b border-white/[0.06] pb-3">
      <div
        className={`font-mono text-3xl font-light leading-none ${
          gold ? "text-[#FDB927]" : "text-white/95"
        }`}
      >
        {value}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-white/55">{label}</div>
    </div>
  );
}

// ─── Franchise chart ──────────────────────────────────────────────────────
//
// Sorted bar chart. LeBron sits as a single row alongside 30 franchises. Bars
// shorter than his are tinted red — those are franchises he has surpassed.

function FranchiseChart({ data }: { data: PlayoffsPayload }) {
  const lebronWins = data.lebronPlayoffWins;

  const rows = useMemo(() => {
    const all = [
      ...data.franchiseWins.map((f) => ({
        kind: "team" as const,
        abbr: f.abbr,
        label: f.fullName,
        wins: f.playoffWins,
      })),
      {
        kind: "lebron" as const,
        abbr: "LBJ",
        label: "LeBron James",
        wins: lebronWins,
      },
    ];
    all.sort((a, b) => b.wins - a.wins);
    return all;
  }, [data.franchiseWins, lebronWins]);

  const maxWins = rows[0].wins;
  const surpassed = data.franchiseWins.filter((f) => f.playoffWins < lebronWins).length;
  const lebronRank = rows.findIndex((r) => r.kind === "lebron") + 1;

  return (
    <section>
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.4em] text-white/55">
            Career playoff wins vs every franchise
          </h2>
          <p className="mt-2 max-w-[640px] text-xs text-white/45">
            All-time playoff wins for the 30 active franchises (since each franchise&apos;s
            inception, including pre-relocation history) compared against LeBron&apos;s {lebronWins} career playoff wins.
            One player, ranked #{lebronRank} of 31. He has more playoff wins than {surpassed} franchises.
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-[3px]">
        {rows.map((r) => {
          const widthPct = (r.wins / maxWins) * 100;
          const isLebron = r.kind === "lebron";
          const team = !isLebron ? findTeam(r.abbr) : null;
          const beaten = !isLebron && r.wins < lebronWins;
          const barColor = isLebron
            ? GOLD
            : beaten
            ? "rgba(229, 96, 66, 0.55)"
            : team?.primary ?? "rgba(255,255,255,0.25)";
          return (
            <div
              key={r.abbr}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: "180px 1fr 60px" }}
            >
              <div
                className={`text-[11px] uppercase tracking-[0.18em] ${
                  isLebron ? "text-[#FDB927] font-semibold" : "text-white/70"
                }`}
              >
                {isLebron ? "LeBron James" : r.label}
              </div>
              <div className="relative h-5">
                <div
                  className="absolute left-0 top-0 h-full transition-all"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: barColor,
                    boxShadow: isLebron ? `0 0 16px ${GOLD}55` : undefined,
                  }}
                />
                {/* LeBron threshold line drawn on every row except his */}
                {!isLebron && (
                  <div
                    className="absolute top-0 h-full border-l border-dashed"
                    style={{
                      left: `${(lebronWins / maxWins) * 100}%`,
                      borderColor: "rgba(253, 185, 39, 0.35)",
                    }}
                  />
                )}
              </div>
              <div
                className={`text-right font-mono text-xs ${
                  isLebron ? "text-[#FDB927]" : beaten ? "text-white/40" : "text-white/75"
                }`}
              >
                {r.wins}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-6 text-[10px] uppercase tracking-[0.3em] text-white/45">
        <span className="flex items-center gap-2">
          <span className="block h-2 w-4" style={{ backgroundColor: GOLD }} />
          LeBron
        </span>
        <span className="flex items-center gap-2">
          <span className="block h-2 w-4" style={{ backgroundColor: "rgba(229, 96, 66, 0.55)" }} />
          surpassed by LeBron ({surpassed})
        </span>
        <span className="flex items-center gap-2">
          <span className="block h-2 w-4 bg-white/25" />
          ahead of LeBron
        </span>
      </div>
    </section>
  );
}
