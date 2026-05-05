"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findTeam, logoUrl } from "@/lib/teams";
import type { PointsPayload, SeasonRollup, MinuteCell } from "@/app/api/lebron-points/route";

type ApiErr = { code: "PBP_NOT_INGESTED" | "DB_ERROR" | "HTTP"; message: string };

type HoverCell = { season: SeasonRollup; cell: MinuteCell; sx: number; sy: number };

const REG_MINUTES = 48;
const PAD_LEFT = 130;
const PAD_RIGHT = 36;
const PAD_TOP = 90;
const PAD_BOTTOM = 64;
const ROW_H = 30;

// Viz-local team color overrides. Miami's official primary (#98002E) reads as
// the same dark wine as Cleveland (#860038) on a black canvas, which collapses
// the era distinction. Push MIA toward a hot red, leave CLE deep, LAL purple.
const TEAM_ACCENT: Record<string, string> = {
  CLE: "#7A0028",
  MIA: "#E03A47",
  LAL: "#552583",
};

function Crown({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  // SVG crown: three peaks + base bar. Sized to fit inside the dot, in a soft
  // gold so it reads as ornament, not as data. Outline-only when r is tiny.
  const size = Math.max(8, r * 1.1);
  const half = size / 2;
  // crown path tuned for a viewBox of [-10, -10, 20, 20]
  const path = "M -8 4 L 8 4 L 8 -1 L 5 1 L 0 -7 L -5 1 L -8 -1 Z";
  return (
    <g transform={`translate(${cx}, ${cy}) scale(${size / 20})`} pointerEvents="none">
      <path d={path} fill="#FDB927" stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
    </g>
  );
}

export function PointsGrid() {
  const [data, setData] = useState<PointsPayload | null>(null);
  const [apiErr, setApiErr] = useState<ApiErr | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverCell | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-points");
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          if (!cancelled) setApiErr({ code: "HTTP", message: `HTTP ${res.status}: ${text.slice(0, 300)}` });
          return;
        }
        if (!res.ok) {
          const b = body as { error?: string; message?: string } | null;
          if (!cancelled) setApiErr({ code: (b?.error as ApiErr["code"]) ?? "HTTP", message: b?.message ?? `HTTP ${res.status}` });
          return;
        }
        if (!cancelled) setData(body as PointsPayload);
      } catch (err) {
        if (!cancelled) setApiErr({ code: "HTTP", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!data || !size.w || !size.h) return null;
    const rows = data.seasons.length;
    const innerW = Math.max(0, size.w - PAD_LEFT - PAD_RIGHT);
    const innerH = Math.max(0, rows * ROW_H);
    const xStep = innerW / REG_MINUTES;
    const yStep = ROW_H;
    // Cap dot size to the cell. Wide range (minR pinprick → maxR fills cell)
    // so the peak minute reads as visibly massive vs an average minute.
    const maxR = Math.min(xStep * 0.55, ROW_H * 0.55);
    const minR = 0.4;
    // Per-row peak (max points in any minute) AND the minute it occurred at.
    // Peak value normalizes the dot sizes; peak minute gets the crown.
    const rowMax = new Map<string, number>();
    const rowPeakMinute = new Map<string, number>();
    for (const s of data.seasons) {
      let m = 0;
      let mAt = -1;
      for (const c of s.byMinute) {
        if (c.minute < 1 || c.minute > REG_MINUTES) continue;
        if (c.points > m) { m = c.points; mAt = c.minute; }
      }
      rowMax.set(s.season, m);
      if (mAt > 0) rowPeakMinute.set(s.season, mAt);
    }
    return { rows, innerW, innerH, xStep, yStep, maxR, minR, rowMax, rowPeakMinute };
  }, [data, size.w, size.h]);

  if (apiErr?.code === "PBP_NOT_INGESTED") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black px-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">No PBP data yet</div>
          <h2 className="font-mono text-2xl font-light text-white">Play-by-play not ingested</h2>
          <p className="text-xs leading-relaxed text-white/50">
            Run <span className="font-mono text-white/80">npm run ingest:pbp</span> to pull
            LeBron&apos;s scoring events from the play-by-play archive, then refresh.
          </p>
        </div>
      </div>
    );
  }
  if (apiErr) return <div className="p-8 font-mono text-xs text-red-400">{apiErr.message}</div>;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-black">
      {!data && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
          <style>{`@keyframes spin-ball { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          <svg viewBox="0 0 512 512" width="40" height="40" fill="#e87e24" style={{ animation: "spin-ball 1.2s linear infinite" }}>
            <path d="M86.8 48C142.1 17.2 205.1 0 272 0c18.6 0 36.8 1.6 54.6 4.7C263.1 45.1 208.3 108.4 181 185c-9.1-5.3-19-9.8-29.6-13.3C120.3 161.8 96.5 156 74 152.8c-5.9-.8-11.9-1.5-17.8-2C59.1 120.4 70 92.9 86.8 48zM3.2 189.5C14.3 190.8 25.4 192.7 36.3 195.1c19.5 3.9 38.1 9.6 55.3 17c-26 67.3-34.2 142.3-22 213.6C29.5 381.5 3.3 326.5 .3 265.4c-.2-4.5-.3-9-.3-13.4c0-21.8 1.1-43.2 3.2-64.5zM108.5 460.3c-8.1-62.8-2.2-128.5 19.6-189.6c8.8 3.7 17.1 8.2 24.8 13.5c0 0 0 0 0 0c24.4 16.8 43 40.3 53.1 68.2c16.5 45.6 12.7 95-8.4 136C166.6 492.6 135.8 479 108.5 460.3zM232.7 471.3c18.5-42.7 21.1-92.2 5.4-137.5c-11.9-34.3-33.7-63.4-62.5-83.3c0 0 0 0 0 0c-5.4-3.7-11-7.1-16.8-10C188.1 160.4 240.6 96.3 308.7 54.8c37.2 14.3 70.7 36.8 98.3 65.5c-58 53.2-97.8 126.5-107.8 209c-25.1 1.5-49.3 11.5-69 29.8c-5 4.6-9.5 9.7-13.5 15.1zM234.2 512C233.5 512 232.7 512 232 512c.2 0 .5 0 .7 0l1.5 0zM464 256c0 36.5-7.6 71.2-21.3 102.6c-21.3-31.4-54.1-53.5-92.2-60.8c9.3-75.2 46.1-141.5 99-190.3c24.5 40 38.5 86.8 38.5 136.8c0 4.2-.1 8.3-.4 12.5l.4 0c0-.1 0-.1 0-.2z" />
          </svg>
          <span className="text-white/30 text-xs uppercase tracking-[0.4em]">loading</span>
        </div>
      )}

      {data && layout && (
        <>
          <ScrollableGrid data={data} layout={layout} setHover={setHover} />
          <InfoButton data={data} />
          <Tooltip hover={hover} viewport={size} />
        </>
      )}
    </div>
  );
}

type Layout = {
  rows: number; innerW: number; innerH: number; xStep: number; yStep: number; maxR: number; minR: number;
  rowMax: Map<string, number>;
  rowPeakMinute: Map<string, number>;
};

function ScrollableGrid({
  data,
  layout,
  setHover,
}: {
  data: PointsPayload;
  layout: Layout;
  setHover: (h: HoverCell | null) => void;
}) {
  const totalH = PAD_TOP + layout.innerH + PAD_BOTTOM;
  const totalW = PAD_LEFT + layout.innerW + PAD_RIGHT;
  // Per-row power scale: each season normalized to its own peak, then the
  // ratio is taken to a power > 1 to *push small values down* — so a minute
  // at 50% of the row peak reads as ~25% of the max radius, not 50%. Combined
  // with the wide [minR, maxR] range this gives heavy minutes real visual
  // dominance over the bench-time crumbs.
  const POWER = 1.8;
  const scale = (points: number, rowPeak: number) => {
    if (rowPeak <= 0 || points <= 0) return 0;
    const t = Math.pow(points / rowPeak, POWER);
    return layout.minR + t * (layout.maxR - layout.minR);
  };

  return (
    <div className="absolute inset-0 overflow-auto">
      <svg width={totalW} height={totalH} className="block" style={{ minWidth: "100%" }}>
        {/* Vertical month-like guidelines every 12 minutes (quarter starts) */}
        {[0, 12, 24, 36, 48].map((m) => (
          <line
            key={m}
            x1={PAD_LEFT + m * layout.xStep}
            x2={PAD_LEFT + m * layout.xStep}
            y1={PAD_TOP - 12}
            y2={PAD_TOP + layout.innerH + 8}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        ))}

        {/* Top axis: minute ticks (every 1) + bold quarter labels */}
        {Array.from({ length: REG_MINUTES + 1 }, (_, m) => {
          const x = PAD_LEFT + m * layout.xStep;
          const isQuarter = m % 12 === 0;
          if (m === REG_MINUTES) return null;
          return (
            <g key={m}>
              <line x1={x} x2={x} y1={PAD_TOP - 6} y2={PAD_TOP - 2} stroke={isQuarter ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"} strokeWidth={1} />
            </g>
          );
        })}
        {/* Quarter labels (Q1..Q4) above the grid */}
        {[0, 1, 2, 3].map((q) => {
          const x = PAD_LEFT + (q * 12 + 6) * layout.xStep;
          return (
            <text
              key={q}
              x={x}
              y={PAD_TOP - 28}
              textAnchor="middle"
              className="fill-white/75"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase" }}
            >
              Q{q + 1}
            </text>
          );
        })}
        {/* Minute labels every 6 */}
        {[6, 12, 18, 24, 30, 36, 42, 48].map((m) => {
          const x = PAD_LEFT + m * layout.xStep;
          return (
            <text
              key={m}
              x={x}
              y={PAD_TOP - 14}
              textAnchor="middle"
              className="fill-white/55"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9, letterSpacing: "0.15em" }}
            >
              {m}
            </text>
          );
        })}

        {/* Each season row */}
        {data.seasons.map((season, i) => {
          const y = PAD_TOP + i * layout.yStep + layout.yStep / 2;
          const team = findTeam(season.teamAbbr);
          // Viz-local color override: CLE wine and MIA wine read identically on
          // a black background. Push MIA toward its iconic hot red so the eras
          // are visually distinct. Done here, not in teams.ts, so other pages
          // (Connections graph) keep the official palette.
          const accent = TEAM_ACCENT[season.teamAbbr] ?? team?.primary ?? "#888";

          // Subtle baseline so each row reads as its own track even when sparse
          return (
            <g key={season.season}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + layout.innerW}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.025)"
                strokeWidth={1}
              />
              {/* Row label (left): logo + season + team abbr */}
              <foreignObject x={6} y={y - layout.yStep / 2} width={PAD_LEFT - 12} height={layout.yStep}>
                <div
                  className="flex h-full items-center justify-end gap-2 pr-2"
                  style={{ fontFamily: "Datatype, ui-monospace, monospace" }}
                >
                  <div className="flex flex-col items-end leading-none">
                    <span className="text-[11px] text-white">{season.season}</span>
                    <span className="text-[9px] uppercase tracking-[0.25em] text-white/65">
                      {season.totalPoints}p
                    </span>
                  </div>
                  {team ? (
                    <img
                      src={logoUrl(team)}
                      alt={season.teamAbbr}
                      className="h-5 w-5 object-contain opacity-90"
                    />
                  ) : null}
                </div>
              </foreignObject>

              {/* Cells: one dot per (minute, season). Per-row normalized so
                  each season's distribution has full dynamic range. Size alone
                  conveys magnitude — no inner core. The single hottest minute
                  of each row is marked with a small gold crown. */}
              {(() => {
                const rowPeak = layout.rowMax.get(season.season) ?? 0;
                const peakMinute = layout.rowPeakMinute.get(season.season) ?? -1;
                return season.byMinute.map((cell) => {
                  if (cell.minute < 1 || cell.minute > REG_MINUTES) return null;
                  const cx = PAD_LEFT + (cell.minute - 0.5) * layout.xStep;
                  const r = scale(cell.points, rowPeak);
                  if (r <= 0) return null;
                  const ratio = rowPeak > 0 ? cell.points / rowPeak : 0;
                  const isPeak = cell.minute === peakMinute;
                  return (
                    <g
                      key={cell.minute}
                      onMouseEnter={() => setHover({ season, cell, sx: cx, sy: y })}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Outer halo — only for the very top of the row */}
                      {ratio > 0.75 && (
                        <circle cx={cx} cy={y} r={r * 2.4} fill={accent} opacity={0.14} />
                      )}
                      {/* Main fill — saturated team color */}
                      <circle cx={cx} cy={y} r={r} fill={accent} opacity={0.92} />
                      {isPeak && <Crown cx={cx} cy={y} r={r} />}
                    </g>
                  );
                });
              })()}
            </g>
          );
        })}

        {/* Bottom axis: minute reference repeated, plus Q labels */}
        {[0, 1, 2, 3].map((q) => {
          const x = PAD_LEFT + (q * 12 + 6) * layout.xStep;
          return (
            <text
              key={`bq${q}`}
              x={x}
              y={PAD_TOP + layout.innerH + 36}
              textAnchor="middle"
              className="fill-white/75"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase" }}
            >
              Q{q + 1}
            </text>
          );
        })}
        {[6, 12, 18, 24, 30, 36, 42, 48].map((m) => {
          const x = PAD_LEFT + m * layout.xStep;
          return (
            <text
              key={`bm${m}`}
              x={x}
              y={PAD_TOP + layout.innerH + 22}
              textAnchor="middle"
              className="fill-white/55"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9, letterSpacing: "0.15em" }}
            >
              {m}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function InfoButton({ data }: { data: PointsPayload }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute left-6 top-6 z-10 rounded-md border border-white/20 bg-black/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/90 backdrop-blur hover:border-white/45 hover:text-white"
      >
        about · ⓘ
      </button>
      {open && <InfoOverlay data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function InfoOverlay({ data, onClose }: { data: PointsPayload; onClose: () => void }) {
  const totalPoints = data.seasons.reduce((s, x) => s + x.totalPoints, 0);
  const totalGames = data.seasons.reduce((s, x) => s + x.games, 0);
  const peak = useMemo(() => {
    let best: { season: string; minute: number; points: number } | null = null;
    for (const s of data.seasons) {
      for (const c of s.byMinute) {
        if (c.minute < 1 || c.minute > REG_MINUTES) continue;
        if (!best || c.points > best.points) {
          best = { season: s.season, minute: c.minute, points: c.points };
        }
      }
    }
    return best;
  }, [data]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-[560px] max-w-[calc(100vw-3rem)] space-y-4 rounded-lg border border-white/15 bg-black/85 p-8 text-white shadow-[0_8px_48px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-white/45 hover:text-white text-base leading-none"
          aria-label="Close"
        >
          ×
        </button>
        <div className="font-mono text-xl font-light tracking-[0.15em] text-white/90">LeBron James</div>
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Points by minute · regular season</div>
        <div className="flex items-baseline gap-8 pt-1">
          <div className="font-mono text-4xl font-light leading-none">
            {totalPoints.toLocaleString()}
            <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-white/40">points</span>
          </div>
          <div className="font-mono text-4xl font-light leading-none">
            {totalGames.toLocaleString()}
            <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-white/40">games</span>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-white/65">
          Each row is a season. Each dot is one of the 48 game minutes of regulation; size is the
          total points scored in that minute across the year. Empty cells are minutes he was on the
          bench. Each row is normalized to its own peak so seasons with fewer games still show a
          full distribution. Color follows the team — Cleveland wine, Miami black, Lakers purple.
        </p>
        <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
          Peak minute:{" "}
          <span className="font-mono text-white/95">
            {peak ? `${peak.points} points in minute ${peak.minute} of ${peak.season}` : "—"}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">
          press esc or click outside to close
        </div>
      </div>
    </div>
  );
}

function Tooltip({ hover, viewport }: { hover: HoverCell | null; viewport: { w: number; h: number } }) {
  if (!hover) return null;
  const { season, cell } = hover;
  const team = findTeam(season.teamAbbr);
  const cardW = 240;
  const cardH = 110;
  const pad = 14;
  let left = hover.sx + 14;
  let top = hover.sy + 14;
  // Tooltip is positioned in document/SVG coords but the page is scrollable;
  // clamp to viewport rough bounds.
  if (left + cardW + pad > viewport.w) left = hover.sx - cardW - 14;
  if (top + cardH + pad > viewport.h) top = hover.sy - cardH - 14;
  left = Math.max(pad, left);
  top = Math.max(pad, top);

  const quarter = Math.min(4, Math.ceil(cell.minute / 12));
  const minInQ = ((cell.minute - 1) % 12) + 1;
  const ppg = cell.points / Math.max(1, season.games);

  return (
    <div
      className="pointer-events-none absolute z-30 w-[240px] rounded-md border border-white/10 bg-black/85 p-3 backdrop-blur shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2">
        {team ? <img src={logoUrl(team)} alt={season.teamAbbr} className="h-5 w-5 object-contain" /> : null}
        <div className="font-mono text-sm text-white">{season.season}</div>
        <div className="ml-auto text-[10px] uppercase tracking-[0.3em] text-white/45">
          Q{quarter} · m{minInQ}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 font-mono">
        <Stat label="points" value={cell.points} />
        <Stat label="events" value={cell.events} />
        <Stat label="ppg" value={ppg.toFixed(2)} />
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.25em] text-white/35">
        game-minute {cell.minute} of 48
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-base leading-none text-white/95">{value}</div>
      <div className="mt-1 text-[9px] uppercase tracking-[0.25em] text-white/40">{label}</div>
    </div>
  );
}
