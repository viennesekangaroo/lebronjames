"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findTeam, logoUrl } from "@/lib/teams";
import type { GamesPayload, SeasonRow, GameCell } from "@/lib/api-types";
import { BallLoader } from "@/components/ball-loader";
import { useMinLoader } from "@/lib/use-min-loader";

type ApiErr = { code: "DB_NOT_SEEDED" | "DB_ERROR" | "HTTP"; message: string };

type Hover = {
  season: SeasonRow;
  cell: GameCell;
  phase: "reg" | "po";
  gameIndex: number;
  sx: number;
  sy: number;
};

const PAD_LEFT = 130;
const PAD_RIGHT = 36;
const PAD_TOP = 70;
const PAD_BOTTOM = 150; // legend strip + clearance for the fixed page-nav pill
const MIN_ROW_H = 22;
const MAX_ROW_H = 44;
// Minimum visible cell size; the actual size is computed from screen width.
const MIN_CELL = 6;

export function GamesGrid() {
  const [data, setData] = useState<GamesPayload | null>(null);
  const [apiErr, setApiErr] = useState<ApiErr | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const minLoading = useMinLoader(1000);
  const [hover, setHover] = useState<Hover | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-games.json");
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
        if (!cancelled) setData(body as GamesPayload);
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
    const totalCells = data.maxRegularGames + data.maxPlayoffGames;
    const innerW = Math.max(0, size.w - PAD_LEFT - PAD_RIGHT);
    const SEPARATOR = 16;
    const rawCellW = (innerW - SEPARATOR) / totalCells;
    const cellW = Math.max(MIN_CELL, rawCellW);
    // Fit row height to the viewport so the grid fills the page rather than
    // leaving a wide dead band at the bottom. Clamped between sensible limits.
    const innerH = Math.max(0, size.h - PAD_TOP - PAD_BOTTOM);
    const rawRowH = innerH / data.seasons.length;
    const rowH = Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, rawRowH));
    // Cell height fills nearly the full row but leaves a 4px breathing strip.
    const cellH = Math.min(rowH - 4, Math.max(cellW, MIN_CELL));
    const regularBlockW = cellW * data.maxRegularGames;
    const playoffsBlockW = cellW * data.maxPlayoffGames;
    const playoffsX0 = PAD_LEFT + regularBlockW + SEPARATOR;
    return {
      innerW,
      cellW,
      cellH,
      rowH,
      regularBlockW,
      playoffsBlockW,
      playoffsX0,
      separatorX: PAD_LEFT + regularBlockW + SEPARATOR / 2,
    };
  }, [data, size.w, size.h]);

  if (apiErr?.code === "DB_NOT_SEEDED") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black px-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">No data yet</div>
          <h2 className="font-mono text-2xl font-light text-white">Database not seeded</h2>
          <p className="text-xs leading-relaxed text-white/55">
            Run <span className="font-mono text-white/85">npm run seed</span>, then refresh.
          </p>
        </div>
      </div>
    );
  }
  if (apiErr) return <div className="p-8 font-mono text-xs text-red-400">{apiErr.message}</div>;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-black">
      {(!data || minLoading) && <BallLoader color="#e87e24" />}

      {data && layout && !minLoading && (
        <>
          <Grid data={data} layout={layout} setHover={setHover} />
          <InfoButton data={data} />
          <Tooltip hover={hover} viewport={size} />
        </>
      )}
    </div>
  );
}

type Layout = {
  innerW: number; cellW: number; cellH: number; rowH: number;
  regularBlockW: number; playoffsBlockW: number;
  playoffsX0: number; separatorX: number;
};

// Per-team color ramp. Each ramp interpolates from a deep team-tinted dark to
// a bright team-tinted highlight, so the eras read as visually distinct
// "chapters" without needing a separate hue per cell.
//   CLE:  wine → gold       (their official colors)
//   MIA:  charcoal → red    (Heat black + flame)
//   LAL:  deep purple → gold
type RampStops = Array<[number, [number, number, number]]>;

// LeBron's four championships — title clinched in the final playoff game of
// each of these seasons (MIA 2012, MIA 2013, CLE 2016, LAL 2020).
const CHAMPIONSHIP_SEASONS: ReadonlySet<string> = new Set([
  "2011-12",
  "2012-13",
  "2015-16",
  "2019-20",
]);

const TEAM_RAMPS: Record<string, RampStops> = {
  CLE: [
    [0.0, [22, 6, 12]],     // near-black
    [0.35, [108, 14, 36]],  // wine
    [0.75, [217, 84, 30]],  // burnt orange
    [1.0, [253, 187, 48]],  // CLE gold
  ],
  MIA: [
    [0.0, [10, 8, 8]],      // black
    [0.4, [120, 20, 22]],   // dark red
    [0.8, [224, 58, 71]],   // hot red
    [1.0, [249, 160, 27]],  // MIA orange-gold
  ],
  LAL: [
    [0.0, [14, 8, 26]],     // near-black violet
    [0.4, [56, 28, 110]],   // deep purple
    [0.8, [120, 60, 180]],  // bright purple
    [1.0, [253, 185, 39]],  // Lakers gold
  ],
};

function colorForMinutes(min: number, teamAbbr: string): string {
  if (min <= 0) return "rgba(255,255,255,0.05)"; // DNP / didn't play
  const stops = TEAM_RAMPS[teamAbbr] ?? TEAM_RAMPS.CLE;
  // Domain: 0..48 minutes. Above 48 (overtime marathons) saturates at the top.
  const t = Math.min(1, min / 48);
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i]; hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const f = span === 0 ? 0 : (t - lo[0]) / span;
  const r = Math.round(lo[1][0] + f * (hi[1][0] - lo[1][0]));
  const g = Math.round(lo[1][1] + f * (hi[1][1] - lo[1][1]));
  const b = Math.round(lo[1][2] + f * (hi[1][2] - lo[1][2]));
  return `rgb(${r}, ${g}, ${b})`;
}

function Grid({
  data,
  layout,
  setHover,
}: {
  data: GamesPayload;
  layout: Layout;
  setHover: (h: Hover | null) => void;
}) {
  const totalH = PAD_TOP + data.seasons.length * layout.rowH + PAD_BOTTOM;
  const totalW = PAD_LEFT + layout.regularBlockW + 16 + layout.playoffsBlockW + PAD_RIGHT;
  const gridBottomY = PAD_TOP + data.seasons.length * layout.rowH;

  return (
    <div className="absolute inset-0 overflow-auto">
      <svg width={totalW} height={totalH} className="block" style={{ minWidth: "100%" }}>
        {/* Section labels */}
        <text
          x={PAD_LEFT + layout.regularBlockW / 2}
          y={PAD_TOP - 28}
          textAnchor="middle"
          className="fill-white/65"
          style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase" }}
        >
          Regular Season
        </text>
        <text
          x={layout.playoffsX0 + layout.playoffsBlockW / 2}
          y={PAD_TOP - 28}
          textAnchor="middle"
          className="fill-white/65"
          style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase" }}
        >
          Playoffs
        </text>
        {/* Game-index ticks (every 10 games for reg, every 5 for playoffs) */}
        {Array.from({ length: Math.floor(data.maxRegularGames / 10) + 1 }, (_, i) => {
          const g = i * 10;
          if (g === 0 || g > data.maxRegularGames) return null;
          const x = PAD_LEFT + g * layout.cellW;
          return (
            <text key={`rt${g}`} x={x} y={PAD_TOP - 12} textAnchor="middle" className="fill-white/45" style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9 }}>
              {g}
            </text>
          );
        })}
        {Array.from({ length: Math.floor(data.maxPlayoffGames / 5) + 1 }, (_, i) => {
          const g = i * 5;
          if (g === 0 || g > data.maxPlayoffGames) return null;
          const x = layout.playoffsX0 + g * layout.cellW;
          return (
            <text key={`pt${g}`} x={x} y={PAD_TOP - 12} textAnchor="middle" className="fill-white/45" style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9 }}>
              {g}
            </text>
          );
        })}

        {/* Vertical separator between regular season and playoffs */}
        <line
          x1={layout.separatorX}
          x2={layout.separatorX}
          y1={PAD_TOP - 8}
          y2={gridBottomY + 4}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={1}
        />

        {/* Each season row */}
        {data.seasons.map((season, i) => {
          const y0 = PAD_TOP + i * layout.rowH;
          const yCenter = y0 + layout.rowH / 2;
          const team = findTeam(season.teamAbbr);
          const totalMin = Math.round(season.regularMinutes + season.playoffsMinutes);
          return (
            <g key={season.season}>
              {/* Row label */}
              <foreignObject x={6} y={y0} width={PAD_LEFT - 12} height={layout.rowH}>
                <div
                  className="flex h-full items-center justify-end gap-2 pr-2"
                  style={{ fontFamily: "Datatype, ui-monospace, monospace" }}
                >
                  <div className="flex flex-col items-end leading-none">
                    <span className="text-[11px] text-white">{season.season}</span>
                    <span className="text-[9px] uppercase tracking-[0.25em] text-white/65">
                      {totalMin.toLocaleString()}m
                    </span>
                  </div>
                  {team ? (
                    <img src={logoUrl(team)} alt={season.teamAbbr} className="h-5 w-5 object-contain opacity-90" />
                  ) : null}
                </div>
              </foreignObject>

              {/* Regular season cells */}
              {season.regular.map((cell, idx) => {
                const x = PAD_LEFT + idx * layout.cellW;
                const cw = Math.max(1, layout.cellW - 1.5);
                const ch = layout.cellH;
                const yTop = yCenter - ch / 2;
                return (
                  <rect
                    key={`r${idx}`}
                    x={x + 0.75}
                    y={yTop}
                    width={cw}
                    height={ch}
                    fill={colorForMinutes(cell.minutes, season.teamAbbr)}
                    rx={1.5}
                    onMouseEnter={() =>
                      setHover({ season, cell, phase: "reg", gameIndex: idx + 1, sx: x + cw / 2, sy: yCenter })
                    }
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}

              {/* Playoff cells */}
              {(() => {
                const isChip = CHAMPIONSHIP_SEASONS.has(season.season);
                const lastIdx = season.playoffs.length - 1;
                return season.playoffs.map((cell, idx) => {
                  const x = layout.playoffsX0 + idx * layout.cellW;
                  const cw = Math.max(1, layout.cellW - 1.5);
                  const ch = layout.cellH;
                  const yTop = yCenter - ch / 2;
                  const isClincher = isChip && idx === lastIdx;
                  return (
                    <g key={`p${idx}`}>
                      <rect
                        x={x + 0.75}
                        y={yTop}
                        width={cw}
                        height={ch}
                        fill={colorForMinutes(cell.minutes, season.teamAbbr)}
                        rx={1.5}
                        stroke={isClincher ? "rgba(253,185,39,0.95)" : "rgba(255,255,255,0.18)"}
                        strokeWidth={isClincher ? 1.5 : 0.5}
                        onMouseEnter={() =>
                          setHover({ season, cell, phase: "po", gameIndex: idx + 1, sx: x + cw / 2, sy: yCenter })
                        }
                        onMouseLeave={() => setHover(null)}
                        style={{ cursor: "pointer" }}
                      />
                      {isClincher && (
                        <Trophy cx={x + 0.75 + cw / 2} cy={yCenter} size={Math.min(cw, ch) * 0.85} />
                      )}
                    </g>
                  );
                });
              })()}
            </g>
          );
        })}

        {/* Legend strip — three team ramps + a faint DNP swatch */}
        <Legend gridBottomY={gridBottomY} totalW={totalW} />
      </svg>
    </div>
  );
}

// Crown glyph for championship-clinching games. Rendered as a dark backdrop
// disc + bright fill + dark outline so it reads on any cell color (the cell
// underneath ranges from gold to deep purple). Same crown shape used on the
// Points page so the visual language is consistent.
function Trophy({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  // Crown path in a [-10, 10] viewbox: three peaks + base bar.
  const path = "M -8 4 L 8 4 L 8 -1 L 5 1 L 0 -7 L -5 1 L -8 -1 Z";
  return (
    <g pointerEvents="none">
      {/* Dark backdrop disc — guarantees contrast on yellow/gold cells */}
      <circle cx={cx} cy={cy} r={size * 0.55} fill="rgba(0,0,0,0.7)" />
      <g transform={`translate(${cx}, ${cy}) scale(${size / 22})`}>
        <path d={path} fill="#FDB927" stroke="#000" strokeWidth={1.2} strokeLinejoin="round" />
      </g>
    </g>
  );
}

function Legend({ gridBottomY, totalW }: { gridBottomY: number; totalW: number }) {
  // Lay out three ramps centered horizontally beneath the grid. Each ramp:
  // a 140-px gradient bar + 0/48m tick labels above, team abbr below.
  const RAMP_W = 140;
  const RAMP_H = 8;
  const GAP = 64;
  const teams: Array<{ abbr: string; label: string }> = [
    { abbr: "CLE", label: "Cleveland" },
    { abbr: "MIA", label: "Miami" },
    { abbr: "LAL", label: "L.A. Lakers" },
  ];
  const totalLegendW = teams.length * RAMP_W + (teams.length - 1) * GAP;
  const startX = (totalW - totalLegendW) / 2;
  const y = gridBottomY + 30;

  return (
    <g>
      <text
        x={totalW / 2}
        y={y - 18}
        textAnchor="middle"
        className="fill-white/55"
        style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase" }}
      >
        Minutes played · 0 → 48
      </text>
      {teams.map((t, i) => {
        const x0 = startX + i * (RAMP_W + GAP);
        const gradId = `ramp-${t.abbr}`;
        const stops = TEAM_RAMPS[t.abbr];
        return (
          <g key={t.abbr}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                {stops.map(([offset, [r, g, b]]) => (
                  <stop key={offset} offset={`${offset * 100}%`} stopColor={`rgb(${r}, ${g}, ${b})`} />
                ))}
              </linearGradient>
            </defs>
            <rect x={x0} y={y} width={RAMP_W} height={RAMP_H} fill={`url(#${gradId})`} rx={1.5} />
            <text
              x={x0 + RAMP_W / 2}
              y={y + RAMP_H + 14}
              textAnchor="middle"
              className="fill-white/85"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase" }}
            >
              {t.label}
            </text>
            <text
              x={x0}
              y={y - 4}
              textAnchor="start"
              className="fill-white/45"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 8 }}
            >
              0
            </text>
            <text
              x={x0 + RAMP_W}
              y={y - 4}
              textAnchor="end"
              className="fill-white/45"
              style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 8 }}
            >
              48m
            </text>
          </g>
        );
      })}
      {/* DNP swatch + Championship marker, right side of the legend strip */}
      <g>
        <rect
          x={startX + totalLegendW + 32}
          y={y}
          width={14}
          height={RAMP_H}
          fill="rgba(255,255,255,0.05)"
          rx={1.5}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={0.5}
        />
        <text
          x={startX + totalLegendW + 50}
          y={y + RAMP_H - 1}
          className="fill-white/55"
          style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" }}
        >
          DNP
        </text>
      </g>
      {/* Championship marker callout */}
      <g>
        <rect
          x={startX + totalLegendW + 110}
          y={y - 1}
          width={14}
          height={RAMP_H + 2}
          fill="rgba(255,255,255,0.04)"
          rx={1.5}
          stroke="rgba(253,185,39,0.95)"
          strokeWidth={1}
        />
        <Trophy cx={startX + totalLegendW + 117} cy={y + RAMP_H / 2} size={Math.min(14, RAMP_H + 2) * 0.85} />
        <text
          x={startX + totalLegendW + 132}
          y={y + RAMP_H - 1}
          className="fill-white/55"
          style={{ fontFamily: "Datatype, ui-monospace, monospace", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" }}
        >
          championship
        </text>
      </g>
    </g>
  );
}

function InfoButton({ data }: { data: GamesPayload }) {
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

function InfoOverlay({ data, onClose }: { data: GamesPayload; onClose: () => void }) {
  const stats = useMemo(() => {
    let regGames = 0, poGames = 0;
    let regWins = 0, regLosses = 0, poWins = 0, poLosses = 0;
    let dnps = 0;
    let totalMin = 0;
    let marathon40 = 0; // 40+ minute games
    let maxMin = { mins: 0, season: "", date: "" };
    let bestSeason = { season: "", team: "", min: 0 };
    let chips = 0;

    for (const s of data.seasons) {
      const seasonMin = s.regularMinutes + s.playoffsMinutes;
      if (seasonMin > bestSeason.min) {
        bestSeason = { season: s.season, team: s.teamAbbr, min: seasonMin };
      }
      if (CHAMPIONSHIP_SEASONS.has(s.season)) chips += 1;

      for (const c of s.regular) {
        regGames += 1;
        totalMin += c.minutes;
        if (!c.played) dnps += 1;
        if (c.minutes >= 40) marathon40 += 1;
        if (c.minutes > maxMin.mins) maxMin = { mins: c.minutes, season: s.season, date: c.date };
        if (c.played) {
          if (c.win === 1) regWins += 1;
          else if (c.win === 0) regLosses += 1;
        }
      }
      for (const c of s.playoffs) {
        poGames += 1;
        totalMin += c.minutes;
        if (c.minutes >= 40) marathon40 += 1;
        if (c.minutes > maxMin.mins) maxMin = { mins: c.minutes, season: s.season, date: c.date };
        if (c.played) {
          if (c.win === 1) poWins += 1;
          else if (c.win === 0) poLosses += 1;
        }
      }
    }
    const totalWins = regWins + poWins;
    const totalDecided = regWins + regLosses + poWins + poLosses;
    return {
      regGames, poGames, totalGames: regGames + poGames,
      regWins, regLosses, poWins, poLosses, totalWins,
      winPct: totalDecided > 0 ? totalWins / totalDecided : 0,
      dnps,
      totalMin: Math.round(totalMin),
      marathon40,
      maxMin,
      bestSeason,
      chips,
    };
  }, [data]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-[560px] max-w-[calc(100vw-3rem)] space-y-5 rounded-lg border border-white/15 bg-black/85 p-8 text-white shadow-[0_8px_48px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-white/45 hover:text-white text-base leading-none"
          aria-label="Close"
        >
          ×
        </button>
        <div>
          <div className="font-mono text-xl font-light tracking-[0.15em] text-white/90">LeBron James</div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">2003-04 → 2025-26</div>
        </div>

        {/* Headline stats — three big numbers */}
        <div className="grid grid-cols-3 gap-4">
          <BigStat value={stats.totalGames.toLocaleString()} label="games" />
          <BigStat value={stats.totalMin.toLocaleString()} label="minutes" />
          <BigStat value={stats.chips.toString()} label="rings" accent="text-[#FDB927]" />
        </div>

        {/* W-L breakdown */}
        <div className="grid grid-cols-2 gap-3">
          <SmallStat
            label="regular season"
            value={`${stats.regWins}-${stats.regLosses}`}
            sub={`${((stats.regWins / Math.max(1, stats.regWins + stats.regLosses)) * 100).toFixed(1)}% wins`}
          />
          <SmallStat
            label="playoffs"
            value={`${stats.poWins}-${stats.poLosses}`}
            sub={`${((stats.poWins / Math.max(1, stats.poWins + stats.poLosses)) * 100).toFixed(1)}% wins`}
          />
        </div>

        {/* Workload + marathons */}
        <div className="grid grid-cols-3 gap-3">
          <SmallStat label="40+ min nights" value={stats.marathon40.toLocaleString()} />
          <SmallStat label="missed (DNP)" value={stats.dnps.toLocaleString()} />
          <SmallStat
            label="longest game"
            value={`${stats.maxMin.mins}m`}
            sub={stats.maxMin.season}
          />
        </div>

        {/* Heaviest-load season callout */}
        <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-xs">
          <div className="text-[9px] uppercase tracking-[0.3em] text-white/40">Heaviest workload</div>
          <div className="mt-1 font-mono text-sm text-white/90">
            {stats.bestSeason.season} <span className="text-white/45">{stats.bestSeason.team}</span>{" "}
            <span className="text-white/55">— {Math.round(stats.bestSeason.min).toLocaleString()} minutes</span>
          </div>
        </div>

        {/* All-time records held */}
        <div className="rounded-md border border-[#FDB927]/25 bg-[#FDB927]/[0.04] px-4 py-3">
          <div className="text-[9px] uppercase tracking-[0.3em] text-[#FDB927]/70">All-time #1</div>
          <div className="mt-2 space-y-1.5 font-mono text-xs">
            <div>
              <span className="text-base text-white/95">43,229</span>
              <span className="ml-2 text-white/55">career points</span>
            </div>
            <div>
              <span className="text-base text-white/95">1,612</span>
              <span className="ml-2 text-white/55">career games</span>
            </div>
            <div>
              <span className="text-base text-white/95">8,289</span>
              <span className="ml-2 text-white/55">playoff points</span>
            </div>
          </div>
        </div>

        <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">press esc or click outside to close</div>
      </div>
    </div>
  );
}

function BigStat({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className={`font-mono text-3xl font-light leading-none ${accent ?? ""}`}>{value}</span>
      <span className="mt-2 text-[10px] uppercase tracking-[0.3em] text-white/40">{label}</span>
    </div>
  );
}

function SmallStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.25em] text-white/40">{label}</div>
      <div className="mt-1 font-mono text-base text-white/95 leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-[10px] text-white/45">{sub}</div>}
    </div>
  );
}

function Tooltip({ hover, viewport }: { hover: Hover | null; viewport: { w: number; h: number } }) {
  if (!hover) return null;
  const { season, cell, phase, gameIndex } = hover;
  const team = findTeam(season.teamAbbr);
  const cardW = 240;
  const cardH = 130;
  const pad = 14;
  let left = hover.sx + 14;
  let top = hover.sy + 14;
  if (left + cardW + pad > viewport.w) left = hover.sx - cardW - 14;
  if (top + cardH + pad > viewport.h) top = hover.sy - cardH - 14;
  left = Math.max(pad, left);
  top = Math.max(pad, top);

  const result =
    cell.win === null ? null : cell.win === 1 ? { txt: "W", color: "text-[#FDB927]" } : { txt: "L", color: "text-white/55" };

  return (
    <div
      className="pointer-events-none absolute z-30 w-[240px] rounded-md border border-white/10 bg-black/85 p-3 backdrop-blur shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2">
        {team ? <img src={logoUrl(team)} alt={season.teamAbbr} className="h-5 w-5 object-contain" /> : null}
        <div className="font-mono text-sm text-white">{season.season}</div>
        <div className="ml-auto text-[10px] uppercase tracking-[0.3em] text-white/55">
          {phase === "reg" ? `Game ${gameIndex}` : `PO ${gameIndex}`}
        </div>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-white/40">{cell.date}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 font-mono">
        <Stat label="min" value={cell.minutes ? cell.minutes.toFixed(1) : "DNP"} />
        <Stat label="pts" value={cell.points} />
        <Stat label={cell.isHome === 1 ? "vs" : "@"} value={cell.oppAbbr ?? "—"} />
      </div>
      {result && (
        <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-white/40">
          result <span className={`ml-1 ${result.color}`}>{result.txt}</span>
        </div>
      )}
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
