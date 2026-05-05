"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getStarColor } from "@/lib/star-colors";
import { findTeam, logoUrl } from "@/lib/teams";
import { TEAM_ERAS, eraMatches, type TeamEra } from "@/lib/team-eras";

function withAlpha(hex: string, alpha: number): string {
  if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type ForceGraphProps = Record<string, unknown> & {
  ref?: React.MutableRefObject<unknown>;
  width?: number;
  height?: number;
};
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default as unknown as React.ComponentType<ForceGraphProps>),
  { ssr: false },
) as unknown as React.ComponentType<ForceGraphProps>;

type SelfNode = { id: "lebron"; kind: "self"; name: string; radius: number };
type PlayerTeam = { teamId: number; abbr: string; fullName: string; games: number; firstFaced: string; lastFaced: string };
type PlayerNode = {
  id: string;
  kind: "player";
  playerId: number;
  name: string;
  games: number;
  wins: number;
  losses: number;
  firstFaced: string;
  lastFaced: string;
  teams: PlayerTeam[];
  radius: number;
};
type GraphNode = SelfNode | PlayerNode;
type GraphLink = { source: string; target: string; games?: number };

type Stats = {
  lebronGames: number;
  opponentsFaced: number;
  playerTeamPairings: number;
  teamsFaced: number;
  historicalFranchisesFaced: number;
  totalPlayers: number;
  shareOfHistory: number;
};

type Payload = { nodes: GraphNode[]; links: GraphLink[]; stats: Stats };

type RTNode = GraphNode & { x?: number; y?: number; fx?: number | null; fy?: number | null; vx?: number; vy?: number };
type RTLink = GraphLink & { source: RTNode | string; target: RTNode | string };

type FGRef = {
  d3Force: (name: string, force?: unknown) => unknown;
  d3ReheatSimulation: () => void;
  centerAt: (x?: number, y?: number, ms?: number) => void;
  zoom: (k?: number, ms?: number) => void;
  zoomToFit: (ms?: number, pad?: number, nodeFilter?: (n: { id?: string | number }) => boolean) => void;
  graph2ScreenCoords: (x: number, y: number) => { x: number; y: number };
};

type Branch = {
  x1: number; y1: number;
  cx1: number; cy1: number;
  cx2: number; cy2: number;
  x2: number; y2: number;
  depth: number;     // 1 = trunk, 4 = twig
  parentIdx: number; // -1 for trunks
};

type ApiErr = { code: "DB_NOT_SEEDED" | "DB_ERROR" | "HTTP"; message: string };

// Stable [0, 1) hash so each player sits in the same direction every render.
function hash01(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return ((x >>> 0) % 1_000_000) / 1_000_000;
}

export function OpponentsGraph() {
  const [data, setData] = useState<Payload | null>(null);
  const [apiErr, setApiErr] = useState<ApiErr | null>(null);
  const [hoverNode, setHoverNode] = useState<RTNode | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGRef | null>(null);
  const branchesRef = useRef<Branch[]>([]);
  // playerId -> index of the twig branch terminating at that player. Walking
  // parentIdx from there back to root yields the full root→leaf path.
  const playerBranchRef = useRef<Map<number, number>>(new Map());

  // Screen position of the selected dot, refreshed each frame so the detail
  // card stays glued to it.
  const [pinnedScreen, setPinnedScreen] = useState<{ x: number; y: number } | null>(null);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-opponents");
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          if (!cancelled) setApiErr({ code: "HTTP", message: `HTTP ${res.status}: ${text.slice(0, 300) || "empty response"}` });
          return;
        }
        if (!res.ok) {
          const b = body as { error?: string; message?: string } | null;
          if (!cancelled) setApiErr({ code: (b?.error as ApiErr["code"]) ?? "HTTP", message: b?.message ?? `HTTP ${res.status}` });
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

  // playerId -> all (player, team) nodes for this person. Sourced from the
  // raw payload — used by search + DetailCard which only need metadata. The
  // actual on-canvas coords are looked up separately from positionedData.
  const playerIndex = useMemo(() => {
    const idx = new Map<number, PlayerNode[]>();
    if (!data) return idx;
    for (const n of data.nodes) {
      if (n.kind === "player") {
        const arr = idx.get(n.playerId) ?? [];
        arr.push(n);
        idx.set(n.playerId, arr);
      }
    }
    return idx;
  }, [data]);

  // Search index — one entry per opponent.
  const playerSearchList = useMemo(() => {
    const out: { playerId: number; name: string; total: number; teams: string[]; node: PlayerNode }[] = [];
    playerIndex.forEach((nodes, playerId) => {
      const node = nodes[0];
      out.push({ playerId, name: node.name, total: node.games, teams: node.teams.map((t) => t.abbr), node });
    });
    return out.sort((a, b) => b.total - a.total);
  }, [playerIndex]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Pre-compute positions in a useMemo so the ForceGraph receives nodes with
  // fx/fy already set — no simulation needed, no race condition.
  const positionedData = useMemo(() => {
    if (!data || !size.w || !size.h) return null;

    const GAP = 5;
    // Use a larger coordinate space — 3x the viewport in each direction.
    // ForceGraph will auto-zoom to fit, so bigger space = more spread out.
    const halfW = size.w * 1.5;
    const halfH = size.h * 1.5;
    const lebronR = 36;

    // Deep-clone nodes so we can mutate them.
    const nodes = data.nodes.map((n) => ({ ...n })) as RTNode[];
    const links = data.links.map((l) => ({ ...l }));

    const playerNodes = nodes.filter((n) => n.kind === "player") as (PlayerNode & RTNode)[];

    // Sort largest-radius first so big dots get placed before small ones.
    const sorted = [...playerNodes].sort((a, b) => b.radius - a.radius);

    // Placed positions — check collisions against these.
    const placed: { x: number; y: number; r: number }[] = [];
    placed.push({ x: 0, y: 0, r: lebronR }); // LeBron

    // Spatial grid for fast collision detection.
    const cellSize = 20;
    const grid = new Map<number, number[]>();
    const gk = (cx: number, cy: number) => cx * 100003 + cy;
    const addToGrid = (idx: number, x: number, y: number) => {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const key = gk(cx, cy);
      const list = grid.get(key);
      if (list) list.push(idx);
      else grid.set(key, [idx]);
    };
    addToGrid(0, 0, 0);

    const collides = (x: number, y: number, r: number): boolean => {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const searchR = Math.ceil((r + 40 + GAP) / cellSize) + 1;
      for (let dx = -searchR; dx <= searchR; dx++) {
        for (let dy = -searchR; dy <= searchR; dy++) {
          const list = grid.get(gk(cx + dx, cy + dy));
          if (!list) continue;
          for (const idx of list) {
            const p = placed[idx];
            const need = r + p.r + GAP;
            const ddx = x - p.x;
            const ddy = y - p.y;
            if (ddx * ddx + ddy * ddy < need * need) return true;
          }
        }
      }
      return false;
    };

    for (const n of sorted) {
      const r = n.radius;
      let bestX = 0;
      let bestY = 0;
      let found = false;

      const baseX = (hash01((n.playerId * 0x9e3779b1) >>> 0) - 0.5) * 2 * halfW;
      const baseY = (hash01(((n.playerId ^ 0xdeadbeef) * 0xc2b2ae35) >>> 0) - 0.5) * 2 * halfH;

      if (!collides(baseX, baseY, r)) {
        bestX = baseX;
        bestY = baseY;
        found = true;
      }

      if (!found) {
        for (let ring = 1; ring < 300 && !found; ring++) {
          const step = GAP + r;
          const dist = ring * step;
          const nPts = Math.max(8, Math.floor(2 * Math.PI * dist / step));
          const offset = hash01((n.playerId * 0x12345) >>> 0) * Math.PI * 2;
          for (let k = 0; k < nPts && !found; k++) {
            const angle = offset + (k / nPts) * Math.PI * 2;
            const cx = baseX + Math.cos(angle) * dist;
            const cy = baseY + Math.sin(angle) * dist;
            if (Math.abs(cx) > halfW + 200 || Math.abs(cy) > halfH + 200) continue;
            if (!collides(cx, cy, r)) {
              bestX = cx;
              bestY = cy;
              found = true;
            }
          }
        }
      }

      if (!found) {
        bestX = baseX;
        bestY = baseY;
      }

      const pIdx = placed.length;
      placed.push({ x: bestX, y: bestY, r });
      addToGrid(pIdx, bestX, bestY);

      n.fx = bestX;
      n.fy = bestY;
      n.x = bestX;
      n.y = bestY;
    }

    // Pin LeBron.
    for (const n of nodes) {
      if (n.id === "lebron") {
        n.fx = 0;
        n.fy = 0;
        n.x = 0;
        n.y = 0;
      }
    }

    return { nodes, links, stats: data.stats };
  }, [data, size.w, size.h]);

  // Kill all forces on mount so the simulation never moves our pinned nodes.
  useEffect(() => {
    if (!fgRef.current || !positionedData) return;
    const fg = fgRef.current;
    fg.d3Force("charge", null);
    fg.d3Force("link", null);
    fg.d3Force("center", null);
    fg.d3Force("ring", null);
    requestAnimationFrame(() => {
      fg.zoomToFit(0, 60);
    });
  }, [positionedData]);

  // Re-fit the graph whenever the viewport resizes.
  useEffect(() => {
    if (!fgRef.current || !positionedData || !size.w || !size.h) return;
    const fg = fgRef.current;
    requestAnimationFrame(() => {
      fg.zoomToFit(300, 60);
    });
  }, [size.w, size.h, positionedData]);

  // Selection effect: frame just LeBron + the picked player, with padding so
  // neither dot ever clips. zoomToFit's nodeFilter lets us scope the fit to
  // those two endpoints exactly. Clearing zooms back to the full layout.
  useEffect(() => {
    if (!fgRef.current || !data) return;
    if (selectedPlayerId === null) {
      const id = setTimeout(() => fgRef.current?.zoomToFit?.(700, 60), 30);
      return () => clearTimeout(id);
    }
    const targetNodeId = `p:${selectedPlayerId}`;
    const id = setTimeout(() => {
      fgRef.current?.zoomToFit?.(800, 140, (n) => n.id === "lebron" || n.id === targetNodeId);
    }, 30);
    return () => clearTimeout(id);
  }, [selectedPlayerId, data]);

  // Track the selected dot's screen position every frame so the card stays
  // glued. Sources from positionedData (which actually has .x/.y) — the raw
  // playerIndex entries don't, which was making the pin sit at LeBron.
  useEffect(() => {
    if (selectedPlayerId === null) {
      setPinnedScreen(null);
      return;
    }
    const targetId = `p:${selectedPlayerId}`;
    const player = positionedData?.nodes.find((n) => n.id === targetId) as RTNode | undefined;
    if (!player) return;
    let raf = 0;
    const update = () => {
      const fg = fgRef.current;
      if (fg?.graph2ScreenCoords) {
        const s = fg.graph2ScreenCoords(player.x ?? 0, player.y ?? 0);
        setPinnedScreen({ x: s.x, y: s.y });
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [selectedPlayerId, positionedData]);

  // Era-aware team filter: each option is a (franchise, naming era) pair, so
  // BKN splits into "Brooklyn Nets" / "New Jersey Nets", OKC into Thunder /
  // Sonics, etc. teamFilter holds an era id.
  const yearBounds = useMemo(() => {
    if (!data) return null;
    let lo = 9999;
    let hi = 0;
    for (const n of data.nodes) {
      if (n.kind === "player") {
        const a = parseInt(n.firstFaced.slice(0, 4));
        const b = parseInt(n.lastFaced.slice(0, 4));
        if (!Number.isNaN(a) && a < lo) lo = a;
        if (!Number.isNaN(b) && b > hi) hi = b;
      }
    }
    return lo > hi ? null : { min: lo, max: hi };
  }, [data]);

  const isFilteredOut = useMemo(() => {
    return (p: PlayerNode): boolean => {
      if (teamFilter) {
        const era = TEAM_ERAS.find((e) => e.id === teamFilter);
        if (era && !p.teams.some((t) => eraMatches(t, era))) return true;
      }
      if (yearFilter) {
        const a = parseInt(p.firstFaced.slice(0, 4));
        const b = parseInt(p.lastFaced.slice(0, 4));
        if (b < yearFilter.min || a > yearFilter.max) return true;
      }
      return false;
    };
  }, [teamFilter, yearFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // If focus is in an input (search, year fields), let that input's own
      // ESC handler take precedence — only blur it, don't clear selection.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      setSelectedPlayerId(null);
      setHoverNode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const highlightedPlayerId =
    selectedPlayerId ?? (hoverNode?.kind === "player" ? hoverNode.playerId : null);

  if (apiErr?.code === "DB_NOT_SEEDED") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black px-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">No data yet</div>
          <h2 className="font-mono text-2xl font-light text-white">Database not seeded</h2>
          <p className="text-xs leading-relaxed text-white/50">
            Drop <span className="font-mono text-white/80">PlayerStatistics.csv</span> into{" "}
            <span className="font-mono text-white/80">data/raw/</span> and run{" "}
            <span className="font-mono text-white/80">npm run seed</span>, then refresh.
          </p>
        </div>
      </div>
    );
  }
  if (apiErr) return <div className="p-8 font-mono text-xs text-red-400">{apiErr.message}</div>;

  const detail =
    selectedPlayerId !== null
      ? (playerIndex.get(selectedPlayerId) ?? [])
      : hoverNode?.kind === "player"
      ? playerIndex.get(hoverNode.playerId) ?? []
      : [];

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full bg-black"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseLeave={() => setCursor(null)}
    >
      {positionedData && size.w > 0 && (
        <ForceGraph2D
          ref={fgRef as unknown as React.MutableRefObject<unknown>}
          width={size.w}
          height={size.h}
          backgroundColor="#000000"
          graphData={positionedData}
          cooldownTicks={0}
          warmupTicks={0}
          enableNodeDrag={false}
          nodeRelSize={1}
          nodeLabel={() => ""}
          linkCanvasObjectMode={() => "replace"}
          linkCanvasObject={(link: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const l = link as RTLink;
            const src = typeof l.source === "object" ? (l.source as RTNode) : null;
            const tgt = typeof l.target === "object" ? (l.target as RTNode) : null;
            if (!src || !tgt) return;
            const x1 = src.x ?? 0;
            const y1 = src.y ?? 0;
            const x2 = tgt.x ?? 0;
            const y2 = tgt.y ?? 0;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const dist = Math.hypot(dx, dy);
            if (dist < 1) return;

            const player = tgt as PlayerNode;
            const j1 = hash01((player.playerId ^ 0xabad1dea) >>> 0);
            const j2 = hash01((player.playerId ^ 0x51ed51ed) >>> 0);
            const theta = Math.atan2(dy, dx);
            const perpX = -Math.sin(theta);
            const perpY = Math.cos(theta);
            const curl1 = (j1 - 0.5) * dist * 0.5;
            const curl2 = (j2 - 0.5) * dist * 0.5;
            const cx1 = x1 + dx * 0.33 + perpX * curl1;
            const cy1 = y1 + dy * 0.33 + perpY * curl1;
            const cx2 = x1 + dx * 0.66 + perpX * curl2;
            const cy2 = y1 + dy * 0.66 + perpY * curl2;

            const isHi = highlightedPlayerId !== null && player.playerId === highlightedPlayerId;
            const filtered = isFilteredOut(player);
            const isDim = (highlightedPlayerId !== null && !isHi) || (filtered && !isHi);
            const accent = getStarColor(player.name);

            ctx.strokeStyle = isHi
              ? "rgba(255,255,255,0.85)"
              : isDim
              ? "rgba(255,255,255,0.01)"
              : accent
              ? withAlpha(accent, 0.45)
              : "rgba(232,228,218,0.07)";
            ctx.lineWidth = ((isHi ? 1.5 : accent ? 0.55 : 0.3)) / globalScale;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
            ctx.stroke();
          }}
          onNodeHover={(n: unknown) => setHoverNode((n ?? null) as RTNode | null)}
          onNodeClick={(n: unknown) => {
            const rt = n as RTNode | undefined;
            if (rt?.kind === "player") setSelectedPlayerId(rt.playerId);
            else setSelectedPlayerId(null);
          }}
          onBackgroundClick={() => setSelectedPlayerId(null)}
          nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const rt = node as RTNode;
            const x = rt.x ?? 0;
            const y = rt.y ?? 0;

            const dimmed =
              highlightedPlayerId !== null &&
              rt.kind === "player" &&
              rt.playerId !== highlightedPlayerId;

            // SELF — crown-gold core + pulsing gold halo + "23" badge. Only chromatic
            // pixel in the entire viz; everything else is white-on-black.
            if (rt.kind === "self") {
              const r = rt.radius;
              const t = Date.now() / 1000;
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
              const haloR = r * (4.2 + pulse * 1.6);

              const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, haloR);
              halo.addColorStop(0, `rgba(253,185,39,${0.32 + pulse * 0.2})`);
              halo.addColorStop(0.6, "rgba(253,185,39,0.06)");
              halo.addColorStop(1, "rgba(253,185,39,0)");
              ctx.fillStyle = halo;
              ctx.beginPath();
              ctx.arc(x, y, haloR, 0, Math.PI * 2);
              ctx.fill();

              for (let i = 0; i < 3; i++) {
                const ringR = r + 8 + i * 6 + pulse * 4;
                ctx.strokeStyle = `rgba(253,185,39,${0.22 - i * 0.06})`;
                ctx.lineWidth = 1 / globalScale;
                ctx.beginPath();
                ctx.arc(x, y, ringR, 0, Math.PI * 2);
                ctx.stroke();
              }

              ctx.fillStyle = "#FDB927";
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();

              ctx.strokeStyle = "#000";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
              ctx.stroke();

              ctx.fillStyle = "#000";
              ctx.font = `700 ${Math.max(18, r * 0.7)}px "Datatype", ui-monospace, monospace`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText("23", x, y + 1);
              return;
            }

            // PLAYER — paler off-white default; full white when highlighted; non-hovered
            // and filtered-out dots fade to grey. Star players (Kobe, Curry, Jokić, …)
            // wear their team accent color and get a soft idle halo.
            const isHighlighted = highlightedPlayerId !== null && rt.playerId === highlightedPlayerId;
            const filteredOut = isFilteredOut(rt as PlayerNode);
            const accent = getStarColor((rt as PlayerNode).name);
            const r = isHighlighted ? rt.radius * 1.6 : rt.radius;

            // Idle halo for stars (only when not dimmed/filtered/highlighted) — draws
            // attention without screaming. Highlighted state has its own halo below.
            if (accent && !isHighlighted && !dimmed && !filteredOut) {
              const haloR = r * 3.2;
              const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
              halo.addColorStop(0, withAlpha(accent, 0.45));
              halo.addColorStop(1, withAlpha(accent, 0));
              ctx.fillStyle = halo;
              ctx.beginPath();
              ctx.arc(x, y, haloR, 0, Math.PI * 2);
              ctx.fill();
            }

            if (isHighlighted) {
              const haloColor = accent ?? "#ffffff";
              const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
              halo.addColorStop(0, withAlpha(haloColor, 0.8));
              halo.addColorStop(1, withAlpha(haloColor, 0));
              ctx.fillStyle = halo;
              ctx.beginPath();
              ctx.arc(x, y, r * 4, 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.fillStyle = isHighlighted
              ? accent ?? "#ffffff"
              : filteredOut
              ? "rgba(255,255,255,0.06)"
              : dimmed
              ? "rgba(255,255,255,0.12)"
              : accent ?? "rgba(232,228,218,0.5)";
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();

            if (isHighlighted) {
              ctx.strokeStyle = "rgba(255,255,255,1)";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.arc(x, y, r + 3, 0, Math.PI * 2);
              ctx.stroke();
            }
          }}
          nodePointerAreaPaint={(node: unknown, color: string, ctx: CanvasRenderingContext2D) => {
            const rt = node as RTNode;
            const r = (rt.radius ?? 4) + 4;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(rt.x ?? 0, rt.y ?? 0, r, 0, Math.PI * 2);
            ctx.fill();
          }}
        />
      )}
      {!data && !apiErr && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
          <style>{`
            @keyframes spin-ball { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          `}</style>
          <svg viewBox="0 0 100 100" width="52" height="52" style={{ animation: "spin-ball 1.2s linear infinite" }}>
            <circle cx="50" cy="50" r="48" fill="#e87e24" />
            <circle cx="50" cy="50" r="48" fill="none" stroke="#c56a18" strokeWidth="2" />
            {/* Horizontal seam */}
            <path d="M2 50 C25 35, 75 65, 98 50" fill="none" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" />
            {/* Vertical seam */}
            <path d="M50 2 C35 25, 65 75, 50 98" fill="none" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" />
            {/* Top-left curve */}
            <path d="M10 22 C22 32, 22 42, 14 56" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
            {/* Bottom-right curve */}
            <path d="M90 78 C78 68, 78 58, 86 44" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-white/30 text-xs uppercase tracking-[0.4em]">loading</span>
        </div>
      )}
      {data && (
        <>
          <StatsHeader stats={data.stats} />
          <Controls
            players={playerSearchList}
            selectedPlayerId={selectedPlayerId}
            onSelect={setSelectedPlayerId}
            teamEras={TEAM_ERAS}
            yearBounds={yearBounds}
            teamFilter={teamFilter}
            yearFilter={yearFilter}
            onTeamChange={setTeamFilter}
            onYearChange={setYearFilter}
          />
          <DetailCard
            hover={hoverNode}
            selected={selectedPlayerId !== null ? playerIndex.get(selectedPlayerId)?.[0] ?? null : null}
            allTeamsForPlayer={detail}
            onClear={() => setSelectedPlayerId(null)}
            cursor={cursor}
            viewport={size}
            pinnedScreen={pinnedScreen}
            positionedData={positionedData}
          />
        </>
      )}
    </div>
  );
}

function StatsHeader({ stats }: { stats: Stats }) {
  return (
    <div className="pointer-events-none absolute left-6 top-6 w-[600px] max-w-[calc(100vw-3rem)] rounded-lg border border-white/10 bg-black/65 px-6 py-4 text-white shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md">
      <div className="flex items-baseline gap-4">
        <div className="font-mono text-lg font-light tracking-[0.15em] text-white/85">LeBron James</div>
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">A career in players</div>
      </div>
      <div className="mt-2 flex items-baseline gap-6">
        <div className="font-mono text-3xl font-light leading-tight">
          {stats.opponentsFaced.toLocaleString()}
          <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-white/40">opponents</span>
        </div>
        <div className="font-mono text-3xl font-light leading-tight">
          {stats.historicalFranchisesFaced}
          <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-white/40">franchises</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-white/55 leading-relaxed">
        Across {stats.lebronGames.toLocaleString()} games, LeBron has shared the floor with {stats.opponentsFaced.toLocaleString()}{" "}
        distinct players from {stats.historicalFranchisesFaced} historical franchises (counting the Sonics, NJ Nets, Bobcats, and
        New Orleans Hornets eras separately from their modern incarnations) — roughly {(stats.shareOfHistory * 100).toFixed(1)}% of
        every player who has logged minutes in this dataset.
      </p>
    </div>
  );
}

function Controls({
  players,
  selectedPlayerId,
  onSelect,
  teamEras,
  yearBounds,
  teamFilter,
  yearFilter,
  onTeamChange,
  onYearChange,
}: {
  players: { playerId: number; name: string; total: number; teams: string[] }[];
  selectedPlayerId: number | null;
  onSelect: (id: number | null) => void;
  teamEras: TeamEra[];
  yearBounds: { min: number; max: number } | null;
  teamFilter: string | null;
  yearFilter: { min: number; max: number } | null;
  onTeamChange: (eraId: string | null) => void;
  onYearChange: (range: { min: number; max: number } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingTeam, setPendingTeam] = useState<string | null>(teamFilter);
  const [pendingYear, setPendingYear] = useState<{ min: number; max: number } | null>(yearFilter);

  // Re-sync pending state if filters reset externally.
  useEffect(() => setPendingTeam(teamFilter), [teamFilter]);
  useEffect(() => setPendingYear(yearFilter), [yearFilter]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return players.slice(0, 8);
    return players.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [q, players]);

  const selectedName = useMemo(
    () => (selectedPlayerId !== null ? players.find((p) => p.playerId === selectedPlayerId)?.name ?? "" : ""),
    [selectedPlayerId, players],
  );

  const filtersActive = teamFilter !== null || yearFilter !== null;

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
        search · filter{filtersActive ? " ●" : ""}
      </button>
    );
  }

  if (!yearBounds) return null;

  const yMin = pendingYear?.min ?? yearBounds.min;
  const yMax = pendingYear?.max ?? yearBounds.max;
  const yearEq = (a: typeof pendingYear, b: typeof yearFilter): boolean => {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.min === b.min && a.max === b.max;
  };
  const dirty = pendingTeam !== teamFilter || !yearEq(pendingYear, yearFilter);

  const apply = () => {
    onTeamChange(pendingTeam);
    onYearChange(pendingYear);
  };

  const reset = () => {
    setPendingTeam(null);
    setPendingYear(null);
    onTeamChange(null);
    onYearChange(null);
  };

  return (
    <div className="absolute right-6 top-6 z-10 w-80 space-y-3 rounded-md border border-white/15 bg-black/80 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/55">search · filter</div>
        <button
          onClick={() => setOpen(false)}
          className="text-white/45 hover:text-white text-base leading-none"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          ref={inputRef}
          value={q || (selectedName && !searchOpen ? selectedName : "")}
          onChange={(e) => {
            setQ(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              onSelect(matches[0].playerId);
              setQ("");
              setSearchOpen(false);
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              setSearchOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search a player…"
          className="w-full rounded-sm border border-white/10 bg-black/60 px-3 py-2 pr-8 font-mono text-xs text-white outline-none placeholder:text-white/30 focus:border-white/30"
        />
        {(q || selectedPlayerId !== null) && (
          <button
            onClick={() => {
              setQ("");
              onSelect(null);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
        {searchOpen && matches.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-sm border border-white/10 bg-black/95 backdrop-blur">
            {matches.map((p) => (
              <button
                key={p.playerId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(p.playerId);
                  setQ("");
                  setSearchOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-white/85 hover:bg-white/5"
              >
                <span className="font-mono truncate">{p.name}</span>
                <span className="flex items-center gap-1.5 text-white/40">
                  <span className="text-[10px]">{p.total}g</span>
                  <span className="flex items-center gap-1">
                    {p.teams.slice(0, 3).map((abbr) => {
                      const tm = findTeam(abbr);
                      return tm ? (
                        <img key={abbr} src={logoUrl(tm)} alt={abbr} className="h-3.5 w-3.5 object-contain" title={abbr} />
                      ) : (
                        <span key={abbr} className="text-[9px] uppercase tracking-[0.15em]">{abbr}</span>
                      );
                    })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">filters</div>
          {filtersActive && (
            <button
              onClick={reset}
              className="text-[10px] uppercase tracking-[0.2em] text-white/50 hover:text-white"
            >
              reset
            </button>
          )}
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">team</span>
          <TeamEraDropdown options={teamEras} value={pendingTeam} onChange={setPendingTeam} />
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
        <button
          onClick={apply}
          disabled={!dirty}
          className="w-full rounded-sm border border-white/15 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-white/85 hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          apply
        </button>
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
            {(() => { const tm = findTeam(selected.abbr); return tm ? <img src={logoUrl(tm)} alt={selected.abbr} className="h-4 w-4 object-contain" /> : null; })()}
            <span className="text-white/45">{selected.abbr}</span>
            <span className="truncate">{selected.label}</span>
            {eraSuffix(selected) && <span className="text-[10px] text-white/40">{eraSuffix(selected)}</span>}
          </span>
        ) : (
          <span className="text-white/55">All teams</span>
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
            <span>All teams</span>
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
                {(() => { const tm = findTeam(o.abbr); return tm ? <img src={logoUrl(tm)} alt={o.abbr} className="h-4 w-4 object-contain" /> : null; })()}
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

function DetailCard({
  hover,
  selected,
  allTeamsForPlayer,
  onClear,
  cursor,
  viewport,
  pinnedScreen,
  positionedData,
}: {
  hover: RTNode | null;
  selected: PlayerNode | null;
  allTeamsForPlayer: PlayerNode[];
  onClear: () => void;
  cursor: { x: number; y: number } | null;
  viewport: { w: number; h: number };
  pinnedScreen: { x: number; y: number } | null;
  positionedData: { nodes: RTNode[] } | null;
}) {
  const player = selected ?? (hover?.kind === "player" ? (hover as PlayerNode) : null);
  const aggregate = useMemo(() => {
    if (!allTeamsForPlayer.length) return null;
    const games = allTeamsForPlayer.reduce((s, n) => s + n.games, 0);
    const wins = allTeamsForPlayer.reduce((s, n) => s + n.wins, 0);
    const losses = allTeamsForPlayer.reduce((s, n) => s + n.losses, 0);
    const firsts = allTeamsForPlayer.map((n) => n.firstFaced).sort();
    const lasts = allTeamsForPlayer.map((n) => n.lastFaced).sort();
    return {
      games,
      wins,
      losses,
      firstYear: firsts[0]?.slice(0, 4) ?? "",
      lastYear: lasts[lasts.length - 1]?.slice(0, 4) ?? "",
    };
  }, [allTeamsForPlayer]);

  if (!player || !aggregate) return null;

  const cardW = 300;
  const cardH = 200;
  const pad = 14;
  const dotR = (player.radius ?? 6) + 8;

  // Place card on the side of the anchor (dot for selected, cursor for hover)
  // that points AWAY from LeBron. We use the player's GRAPH coords (LeBron is
  // always at graph 0,0) for the direction so the side decision is stable
  // through camera animations — no flipping mid-zoom.
  const anchor = selected && pinnedScreen ? pinnedScreen : cursor;
  const targetId = selected ? `p:${selected.playerId}` : hover?.id;
  const positioned = targetId ? (positionedData?.nodes.find((n) => n.id === targetId) as RTNode | undefined) : undefined;
  const dxGraph = positioned?.x ?? 0;
  const dyGraph = positioned?.y ?? 0;
  let left: number;
  let top: number;
  if (anchor) {
    const gap = (selected ? dotR : 18) + 8;
    left = dxGraph >= 0 ? anchor.x + gap : anchor.x - cardW - gap;
    top = dyGraph >= 0 ? anchor.y + gap : anchor.y - cardH - gap;
  } else {
    left = viewport.w - cardW - pad;
    top = viewport.h - cardH - pad;
  }
  left = Math.max(pad, Math.min(viewport.w - cardW - pad, left));
  top = Math.max(pad, Math.min(viewport.h - cardH - pad, top));

  return (
    <div
      className="pointer-events-auto absolute z-20 w-[300px] rounded-md border border-white/10 bg-black/85 p-4 backdrop-blur shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      style={{ left, top }}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-base text-white leading-tight">{player.name}</div>
          {selected && (
            <button
              onClick={onClear}
              className="text-white/40 hover:text-white text-xs"
              aria-label="Clear selection"
            >
              ×
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 font-mono">
          <Stat label="games" value={aggregate.games} accent="text-white" />
          <Stat label="L wins" value={aggregate.wins} accent="text-[#FDB927]" />
          <Stat label="L losses" value={aggregate.losses} accent="text-white/55" />
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {player.teams.map((t) => {
            const teamMeta = findTeam(t.abbr);
            const logo = teamMeta ? logoUrl(teamMeta) : null;
            return (
              <span
                key={t.teamId}
                className="inline-flex items-center gap-1.5 rounded-sm border border-white/25 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em] text-white/80"
              >
                {logo ? (
                  <img src={logo} alt={t.abbr} className="h-3.5 w-3.5 object-contain" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                )}
                {t.abbr} · {t.games}g
              </span>
            );
          })}
        </div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">
          faced {aggregate.firstYear}
          {aggregate.firstYear !== aggregate.lastYear ? `–${aggregate.lastYear}` : ""}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <div className={`text-xl leading-none ${accent}`}>{value}</div>
      <div className="mt-1 text-[9px] uppercase tracking-[0.25em] text-white/40">{label}</div>
    </div>
  );
}

