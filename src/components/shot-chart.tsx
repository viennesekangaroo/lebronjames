"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drawFullCourt, nbaToCanvasFullCourt } from "@/lib/court";
import { TEAM_ERAS, eraMatches, type TeamEra } from "@/lib/team-eras";
import { BallLoader } from "@/components/ball-loader";
import { useMinLoader } from "@/lib/use-min-loader";

type Shot = {
  game_date: string;
  season: string;
  period: number;
  minutes_remaining: number;
  seconds_remaining: number;
  loc_x: number;
  loc_y: number;
  made: 0 | 1;
  shot_type: string | null;
  shot_distance: number | null;
  shot_zone_basic: string | null;
  opp_abbr: string | null;
};

type Stats = {
  attempts: number;
  made: number;
  seasons: string[];
  opponents: { abbr: string; full_name: string; first: string; last: string; n: number }[];
};

type Payload = { shots: Shot[]; stats: Stats };
type ApiErr = { code: string; message: string };

const MAKE_COLOR = "#FDB927"; // crown gold
const MISS_COLOR = "rgba(220,80,80,0.7)"; // muted red
const COURT_LINE = "rgba(255,255,255,0.28)";
const COURT_PAD = 36;

const SPEED_OPTIONS = [1, 4, 16, 64, 256];

export function ShotChart() {
  const [data, setData] = useState<Payload | null>(null);
  const [apiErr, setApiErr] = useState<ApiErr | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const minLoading = useMinLoader(1000);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Filters (committed) and pending (held inside the panel until Apply).
  const [opponentFilter, setOpponentFilter] = useState<string | null>(null); // era id
  const [periodFilter, setPeriodFilter] = useState<number | null>(null); // 1..4 / 5+ overtime
  const [yearFilter, setYearFilter] = useState<{ min: number; max: number } | null>(null);
  const [shotTypeFilter, setShotTypeFilter] = useState<string | null>(null); // "2PT" | "3PT"
  const [resultFilter, setResultFilter] = useState<"made" | "miss" | null>(null);

  // Playback
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(64); // shots per second
  const [progress, setProgress] = useState(0); // index into filtered shots
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Live progress lives in a ref so scrubbing/restart writes a value the RAF
  // reads on the very next frame. Without this, the loop's local copy drifts
  // out of sync with state changes and the scrubber appears to "stick".
  const progressRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-shots.json");
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          if (!cancelled) setApiErr({ code: "HTTP", message: `HTTP ${res.status}` });
          return;
        }
        if (!res.ok) {
          const b = body as { error?: string; message?: string } | null;
          if (!cancelled) setApiErr({ code: b?.error ?? "HTTP", message: b?.message ?? `HTTP ${res.status}` });
          return;
        }
        if (!cancelled) setData(body as Payload);
      } catch (err) {
        if (!cancelled) setApiErr({ code: "HTTP", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtered + chronologically-ordered shot list (the API already orders).
  const filteredShots = useMemo(() => {
    if (!data) return [];
    const era = opponentFilter ? TEAM_ERAS.find((e) => e.id === opponentFilter) ?? null : null;
    return data.shots.filter((s) => {
      if (era) {
        if (!s.opp_abbr) return false;
        if (
          !eraMatches(
            { abbr: s.opp_abbr, firstFaced: s.game_date, lastFaced: s.game_date },
            era,
          )
        )
          return false;
      }
      if (periodFilter !== null) {
        if (periodFilter === 5 ? s.period < 5 : s.period !== periodFilter) return false;
      }
      if (yearFilter) {
        const y = parseInt(s.game_date.slice(0, 4));
        if (y < yearFilter.min || y > yearFilter.max) return false;
      }
      if (shotTypeFilter) {
        if (shotTypeFilter === "2PT" && s.shot_type !== "2PT Field Goal") return false;
        if (shotTypeFilter === "3PT" && s.shot_type !== "3PT Field Goal") return false;
      }
      return true;
    });
  }, [data, opponentFilter, periodFilter, yearFilter, shotTypeFilter]);

  // Reset progress whenever filters change.
  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
    setPlaying(true);
  }, [opponentFilter, periodFilter, yearFilter, shotTypeFilter]);

  const yearBounds = useMemo(() => {
    if (!data?.shots.length) return null;
    const first = data.shots[0].game_date;
    const last = data.shots[data.shots.length - 1].game_date;
    return { min: parseInt(first.slice(0, 4)), max: parseInt(last.slice(0, 4)) };
  }, [data]);

  // Resize the canvas to its CSS box (accounting for devicePixelRatio).
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Animation loop. Advances progress by speed*dt shots per frame, then
  // repaints the canvas: court markings + dots[0..progress].
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    let last = performance.now();

    const paint = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // clamp so tab-out doesn't fast-forward
      last = now;
      let cur = progressRef.current;
      if (playing) {
        cur = Math.min(filteredShots.length, cur + speed * dt);
        progressRef.current = cur;
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, size.w, size.h);
      drawFullCourt(ctx, size.w, size.h, COURT_PAD, { stroke: COURT_LINE, lineWidth: 1.4 });

      const upTo = Math.floor(cur);
      // Two passes so makes always sit on top of misses for the same x,y cluster.
      ctx.save();
      if (resultFilter !== "made") {
        for (let i = 0; i < upTo; i++) {
          const s = filteredShots[i];
          if (s.made) continue;
          const p = nbaToCanvasFullCourt(s.loc_x, s.loc_y, size.w, size.h, COURT_PAD);
          ctx.fillStyle = MISS_COLOR;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (resultFilter !== "miss") {
        for (let i = 0; i < upTo; i++) {
          const s = filteredShots[i];
          if (!s.made) continue;
          const p = nbaToCanvasFullCourt(s.loc_x, s.loc_y, size.w, size.h, COURT_PAD);
          ctx.fillStyle = MAKE_COLOR;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Glow on the latest shot for "currently being painted" feel.
      if (playing && upTo > 0 && upTo < filteredShots.length) {
        const s = filteredShots[upTo - 1];
        const p = nbaToCanvasFullCourt(s.loc_x, s.loc_y, size.w, size.h, COURT_PAD);
        const r = 14;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        const c = s.made ? "253,185,39" : "220,80,80";
        grad.addColorStop(0, `rgba(${c},0.55)`);
        grad.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Push React state at integer boundaries so the readouts update without
      // a setState every frame.
      setProgress((p) => (Math.floor(cur) !== Math.floor(p) ? cur : p));
      if (cur >= filteredShots.length && playing) setPlaying(false);
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
    // We deliberately exclude `progress` from deps — it's mutated locally and
    // pushed to state at integer boundaries. Including it would restart RAF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredShots, size.w, size.h, playing, speed, resultFilter]);

  const upTo = Math.floor(progress);
  const visible = filteredShots.slice(0, upTo);
  const made = visible.reduce((a, s) => a + s.made, 0);
  const fgPct = visible.length ? ((made / visible.length) * 100).toFixed(1) : "—";
  const cur = filteredShots[Math.min(upTo, filteredShots.length - 1)];

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    progressRef.current = v;
    setProgress(v);
    setPlaying(false);
  };

  if (apiErr?.code === "DB_NOT_SEEDED") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black px-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">No data yet</div>
          <h2 className="font-mono text-2xl font-light text-white">Shots not seeded</h2>
          <p className="text-xs leading-relaxed text-white/55">
            Run <span className="font-mono text-white/85">npm run fetch-shots</span> then{" "}
            <span className="font-mono text-white/85">npm run seed-shots</span>, then refresh.
          </p>
        </div>
      </div>
    );
  }
  if (apiErr) return <div className="p-8 font-mono text-xs text-red-400">{apiErr.message}</div>;

  return (
    <div className="relative flex h-full w-full bg-black">
      {/* Left: infographic stat panel */}
      {data && !minLoading && (
        <div className="relative z-10 flex w-[340px] shrink-0 flex-col justify-center border-r border-white/8 px-10">
          <StatsCard
            total={filteredShots.length}
            shown={upTo}
            made={made}
            fgPct={fgPct}
            currentDate={cur?.game_date ?? null}
            currentSeason={cur?.season ?? null}
            currentOpp={cur?.opp_abbr ?? null}
          />
        </div>
      )}
      {/* Right: court canvas + playback below */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div ref={wrapRef} className="relative min-h-0 flex-1">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {(!data || minLoading) && <BallLoader color="#ff6b1a" label="loading shots" />}
          {data && !minLoading && (
            <>
              <Legend resultFilter={resultFilter} onToggle={setResultFilter} />
              <Controls
                open={filtersOpen}
                setOpen={setFiltersOpen}
                opponentFilter={opponentFilter}
                yearFilter={yearFilter}
                periodFilter={periodFilter}
                shotTypeFilter={shotTypeFilter}
                yearBounds={yearBounds}
                onOpponentChange={setOpponentFilter}
                onYearChange={setYearFilter}
                onPeriodChange={setPeriodFilter}
                onShotTypeChange={setShotTypeFilter}
              />
            </>
          )}
        </div>
        {data && !minLoading && (
          <Playback
            total={filteredShots.length}
            progress={upTo}
            playing={playing}
            speed={speed}
            onPlayPause={() => {
              if (upTo >= filteredShots.length) {
                progressRef.current = 0;
                setProgress(0);
              }
              setPlaying((p) => !p);
            }}
            onSpeed={setSpeed}
            onScrub={onScrub}
            onRestart={() => {
              progressRef.current = 0;
              setProgress(0);
              setPlaying(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

function StatsCard({
  total,
  shown,
  made,
  fgPct,
  currentDate,
  currentSeason,
  currentOpp,
}: {
  total: number;
  shown: number;
  made: number;
  fgPct: string;
  currentDate: string | null;
  currentSeason: string | null;
  currentOpp: string | null;
}) {
  return (
    <div className="space-y-8 text-white">
      <div>
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">LeBron James</div>
        <div className="mt-1 font-mono text-sm font-light tracking-[0.2em] text-white/60">Career shot chart</div>
      </div>

      {/* Big hero number: attempts */}
      <div>
        <div className="font-serif text-7xl font-light leading-none tracking-tight">{shown.toLocaleString()}</div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.4em] text-white/40">attempts</div>
      </div>

      {/* Made / FG% row */}
      <div className="flex gap-6 border-t border-white/10 pt-6">
        <div>
          <div className="font-mono text-3xl font-light leading-none text-[#FDB927]">{made.toLocaleString()}</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-white/40">made</div>
        </div>
        <div className="border-l border-white/10 pl-6">
          <div className="font-mono text-3xl font-light leading-none">{fgPct}<span className="text-lg text-white/50">%</span></div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-white/40">field goal</div>
        </div>
      </div>

      {/* Current position in timeline */}
      <div className="space-y-1 border-t border-white/8 pt-5">
        <div className="font-mono text-xs tracking-[0.15em] text-white/55">
          {currentDate ?? "—"}
          {currentSeason ? ` · ${currentSeason}` : ""}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">vs {currentOpp ?? "—"}</div>
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
        of {total.toLocaleString()} total
      </div>
    </div>
  );
}

function Controls({
  open,
  setOpen,
  opponentFilter,
  yearFilter,
  periodFilter,
  shotTypeFilter,
  yearBounds,
  onOpponentChange,
  onYearChange,
  onPeriodChange,
  onShotTypeChange,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  opponentFilter: string | null;
  yearFilter: { min: number; max: number } | null;
  periodFilter: number | null;
  shotTypeFilter: string | null;
  yearBounds: { min: number; max: number } | null;
  onOpponentChange: (id: string | null) => void;
  onYearChange: (r: { min: number; max: number } | null) => void;
  onPeriodChange: (p: number | null) => void;
  onShotTypeChange: (t: string | null) => void;
}) {
  const [pendingOpp, setPendingOpp] = useState<string | null>(opponentFilter);
  const [pendingYear, setPendingYear] = useState<{ min: number; max: number } | null>(yearFilter);
  const [pendingPeriod, setPendingPeriod] = useState<number | null>(periodFilter);
  const [pendingShotType, setPendingShotType] = useState<string | null>(shotTypeFilter);

  useEffect(() => setPendingOpp(opponentFilter), [opponentFilter]);
  useEffect(() => setPendingYear(yearFilter), [yearFilter]);
  useEffect(() => setPendingPeriod(periodFilter), [periodFilter]);
  useEffect(() => setPendingShotType(shotTypeFilter), [shotTypeFilter]);

  const filtersActive = opponentFilter !== null || yearFilter !== null || periodFilter !== null || shotTypeFilter !== null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`absolute right-6 top-6 z-10 rounded-md border bg-black/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] backdrop-blur ${
          filtersActive
            ? "border-[#FDB927]/60 text-[#FDB927]"
            : "border-white/15 text-white/75 hover:border-white/35 hover:text-white"
        }`}
      >
        filters{filtersActive ? " ●" : ""}
      </button>
    );
  }
  if (!yearBounds) return null;

  const yMin = pendingYear?.min ?? yearBounds.min;
  const yMax = pendingYear?.max ?? yearBounds.max;
  const yearEq = (a: { min: number; max: number } | null, b: { min: number; max: number } | null) =>
    (a === null && b === null) || (!!a && !!b && a.min === b.min && a.max === b.max);
  const dirty =
    pendingOpp !== opponentFilter || !yearEq(pendingYear, yearFilter) || pendingPeriod !== periodFilter || pendingShotType !== shotTypeFilter;

  const apply = () => {
    onOpponentChange(pendingOpp);
    onYearChange(pendingYear);
    onPeriodChange(pendingPeriod);
    onShotTypeChange(pendingShotType);
  };
  const reset = () => {
    setPendingOpp(null);
    setPendingYear(null);
    setPendingPeriod(null);
    setPendingShotType(null);
    onOpponentChange(null);
    onYearChange(null);
    onPeriodChange(null);
    onShotTypeChange(null);
  };

  return (
    <div className="absolute right-6 top-6 z-10 w-80 space-y-3 rounded-md border border-white/15 bg-black/80 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/55">filters</div>
        <button
          onClick={() => setOpen(false)}
          className="text-white/45 hover:text-white text-base leading-none"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div>
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">opponent</span>
        <TeamEraDropdown options={TEAM_ERAS} value={pendingOpp} onChange={setPendingOpp} />
      </div>

      <div>
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">shot type</span>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {([null, "2PT", "3PT"] as const).map((v) => (
            <button
              key={v ?? "all"}
              onClick={() => setPendingShotType(v)}
              className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
                pendingShotType === v
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-white/10 bg-black/60 text-white/65 hover:text-white"
              }`}
            >
              {v === null ? "all" : v}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">period</span>
        <div className="mt-1 grid grid-cols-5 gap-1">
          {[null, 1, 2, 3, 4, 5].slice(0, 6).map((v, i) => (
            <button
              key={i}
              onClick={() => setPendingPeriod(v)}
              className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
                pendingPeriod === v
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-white/10 bg-black/60 text-white/65 hover:text-white"
              }`}
            >
              {v === null ? "all" : v === 5 ? "OT+" : `Q${v}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">years</span>
          <span className="font-mono text-[10px] text-white/55">
            {yMin}–{yMax}
          </span>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            type="number"
            min={yearBounds.min}
            max={yearBounds.max}
            value={yMin}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (Number.isNaN(v)) return;
              setPendingYear({ min: Math.max(yearBounds.min, v), max: yMax });
            }}
            className="rounded-sm border border-white/10 bg-black/60 px-2 py-1 font-mono text-xs text-white outline-none focus:border-white/30"
          />
          <input
            type="number"
            min={yearBounds.min}
            max={yearBounds.max}
            value={yMax}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (Number.isNaN(v)) return;
              setPendingYear({ min: yMin, max: Math.min(yearBounds.max, v) });
            }}
            className="rounded-sm border border-white/10 bg-black/60 px-2 py-1 font-mono text-xs text-white outline-none focus:border-white/30"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={apply}
          disabled={!dirty}
          className="flex-1 rounded-sm border border-white/15 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-white/85 hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          apply
        </button>
        {filtersActive && (
          <button
            onClick={reset}
            className="rounded-sm border border-white/10 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-white/55 hover:text-white"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

function TeamEraDropdown({
  options,
  value,
  onChange,
}: {
  options: TeamEra[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = value ? options.find((o) => o.id === value) ?? null : null;
  const eraSuffix = (era: TeamEra) => {
    if (era.from && era.to) return `${era.from.slice(0, 4)}–${era.to.slice(0, 4)}`;
    if (era.from) return `${era.from.slice(0, 4)}+`;
    if (era.to) return `–${era.to.slice(0, 4)}`;
    return null;
  };

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-sm border bg-black/60 px-2.5 py-1.5 font-mono text-xs text-left outline-none ${
          open ? "border-white/35 text-white" : "border-white/10 text-white/85 hover:border-white/25"
        }`}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2 truncate">
            <span className="text-white/45">{selected.abbr}</span>
            <span className="truncate">{selected.label}</span>
            {eraSuffix(selected) && <span className="text-[10px] text-white/40">{eraSuffix(selected)}</span>}
          </span>
        ) : (
          <span className="text-white/55">All opponents</span>
        )}
        <svg viewBox="0 0 12 8" className={`h-2 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1.5l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-sm border border-white/15 bg-black/95 backdrop-blur shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs hover:bg-white/5 ${
              value === null ? "bg-white/10 text-white" : "text-white/75"
            }`}
          >
            <span className="w-9 text-white/35">all</span>
            <span>All opponents</span>
          </button>
          {options.map((o) => {
            const suf = eraSuffix(o);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs hover:bg-white/5 ${
                  value === o.id ? "bg-white/10 text-white" : "text-white/80"
                }`}
              >
                <span className="w-9 text-white/35">{o.abbr}</span>
                <span className="truncate">{o.label}</span>
                {suf && <span className="ml-auto text-[10px] text-white/40">{suf}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Playback({
  total,
  progress,
  playing,
  speed,
  onPlayPause,
  onSpeed,
  onScrub,
  onRestart,
}: {
  total: number;
  progress: number;
  playing: boolean;
  speed: number;
  onPlayPause: () => void;
  onSpeed: (s: number) => void;
  onScrub: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRestart: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-white/8 bg-black px-4 py-3">
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <button
          onClick={onPlayPause}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white hover:bg-white/15"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
              <rect x="2" y="2" width="3" height="8" />
              <rect x="7" y="2" width="3" height="8" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
              <path d="M3 1.5v9l8-4.5z" />
            </svg>
          )}
        </button>
        <button
          onClick={onRestart}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-transparent text-white/65 hover:bg-white/10 hover:text-white"
          aria-label="Restart"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2.5 6a3.5 3.5 0 1 1 1 2.5" />
            <path d="M2 4.5v2h2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={total}
          value={progress}
          onChange={onScrub}
          className="grow accent-[#FDB927]"
        />
        <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/55 tabular-nums">
          {progress.toLocaleString()} / {total.toLocaleString()}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
                speed === s
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-white/10 bg-transparent text-white/55 hover:text-white"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend({ resultFilter, onToggle }: { resultFilter: "made" | "miss" | null; onToggle: (v: "made" | "miss" | null) => void }) {
  const toggle = (v: "made" | "miss") => onToggle(resultFilter === v ? null : v);
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.3em]">
      <button
        onClick={() => toggle("made")}
        className={`flex items-center gap-2 transition-opacity ${
          resultFilter === "miss" ? "opacity-30" : ""
        }`}
      >
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#FDB927] shadow-[0_0_6px_rgba(253,185,39,0.5)]" />
        <span className="text-white/65 hover:text-white">made</span>
      </button>
      <span className="h-3 w-px bg-white/15" />
      <button
        onClick={() => toggle("miss")}
        className={`flex items-center gap-2 transition-opacity ${
          resultFilter === "made" ? "opacity-30" : ""
        }`}
      >
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[rgb(220,80,80)] shadow-[0_0_6px_rgba(220,80,80,0.4)]" />
        <span className="text-white/65 hover:text-white">miss</span>
      </button>
    </div>
  );
}
