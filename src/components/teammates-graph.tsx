"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { findTeam, logoUrl } from "@/lib/teams";
import { BallLoader } from "@/components/ball-loader";
import { useMinLoader } from "@/lib/use-min-loader";

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
type PlayerTeam = { teamId: number; abbr: string; fullName: string; games: number; points: number };
type PlayerNode = {
  id: string;
  kind: "player";
  playerId: number;
  name: string;
  games: number;
  points: number;
  assistsFromLebron: number;
  assistsToLebron: number;
  ptsOffFromLebron: number;
  ptsOffToLebron: number;
  firstTogether: string;
  lastTogether: string;
  teams: PlayerTeam[];
  radius: number;
};
type GraphNode = SelfNode | PlayerNode;
type GraphLink = { source: string; target: string; points?: number; astFrom?: number; astTo?: number };

type Stats = {
  lebronGames: number;
  teammateCount: number;
  lebronAssists: number;
  ptsOffAssistsCombined: number;
  astFromLebron: number;
  astToLebron: number;
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

type ApiErr = { code: "DB_NOT_SEEDED" | "DB_ERROR" | "HTTP"; message: string };

function hash01(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return ((x >>> 0) % 1_000_000) / 1_000_000;
}

export function TeammatesGraph() {
  const [data, setData] = useState<Payload | null>(null);
  const [apiErr, setApiErr] = useState<ApiErr | null>(null);
  const [hoverNode, setHoverNode] = useState<RTNode | null>(null);
  const minLoading = useMinLoader(1000);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGRef | null>(null);
  const [pinnedScreen, setPinnedScreen] = useState<{ x: number; y: number } | null>(null);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lebron-teammates.json");
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
    return () => { cancelled = true; };
  }, []);

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

  const playerSearchList = useMemo(() => {
    const out: { playerId: number; name: string; ptsOff: number; games: number; teams: string[]; node: PlayerNode }[] = [];
    playerIndex.forEach((nodes, playerId) => {
      const node = nodes[0];
      const ptsOff = (node.ptsOffFromLebron ?? 0) + (node.ptsOffToLebron ?? 0);
      out.push({ playerId, name: node.name, ptsOff, games: node.games, teams: node.teams.map((t) => t.abbr), node });
    });
    return out.sort((a, b) => b.ptsOff - a.ptsOff);
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

  const positionedData = useMemo(() => {
    if (!data || !size.w || !size.h) return null;

    const GAP = 5;
    const lebronR = 36;

    // LeBron on the left, players scattered on the right.
    const lebronX = -size.w * 0.8;
    const lebronY = 0;

    // Player zone: right side, full height spread
    const playerMinX = -size.w * 0.15;
    const playerMaxX = size.w * 1.5;
    const playerHalfH = size.h * 1.5;

    const nodes = data.nodes.map((n) => ({ ...n })) as RTNode[];
    const links = data.links.map((l) => ({ ...l }));

    const playerNodes = nodes.filter((n) => n.kind === "player") as (PlayerNode & RTNode)[];
    const sorted = [...playerNodes].sort((a, b) => b.radius - a.radius);

    const placed: { x: number; y: number; r: number }[] = [];
    // LeBron is placed separately, but register him for collision avoidance
    placed.push({ x: lebronX, y: lebronY, r: lebronR });

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
    addToGrid(0, lebronX, lebronY);

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

      // Hash into the right-side zone only
      const baseX = playerMinX + hash01((n.playerId * 0x9e3779b1) >>> 0) * (playerMaxX - playerMinX);
      const baseY = (hash01(((n.playerId ^ 0xdeadbeef) * 0xc2b2ae35) >>> 0) - 0.5) * 2 * playerHalfH;

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
            // Keep players in the right zone
            if (cx < playerMinX - 50 || cx > playerMaxX + 200 || Math.abs(cy) > playerHalfH + 200) continue;
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

    for (const n of nodes) {
      if (n.id === "lebron") {
        n.fx = lebronX;
        n.fy = lebronY;
        n.x = lebronX;
        n.y = lebronY;
      }
    }

    return { nodes, links, stats: data.stats };
  }, [data, size.w, size.h]);

  // max points to normalize link opacity + LED brightness
  const maxPoints = useMemo(() => {
    if (!data) return 1;
    let mx = 1;
    for (const l of data.links) {
      if (l.points && l.points > mx) mx = l.points;
    }
    return mx;
  }, [data]);

  // peak assists in either direction across all teammates — single normalizer
  // so a thick gold strand and a thick blue strand mean the same magnitude.
  const maxAst = useMemo(() => {
    if (!data) return 1;
    let mx = 1;
    for (const l of data.links) {
      if (l.astFrom && l.astFrom > mx) mx = l.astFrom;
      if (l.astTo && l.astTo > mx) mx = l.astTo;
    }
    return mx;
  }, [data]);

  const hasLanded = useRef(false);
  const landingUntil = useRef(0);

  useEffect(() => {
    if (!fgRef.current || !positionedData) return;
    const fg = fgRef.current;
    fg.d3Force("charge", null);
    fg.d3Force("link", null);
    fg.d3Force("center", null);
    fg.d3Force("ring", null);

    if (!hasLanded.current) {
      hasLanded.current = true;
      // Block all other zoom effects for the full landing duration.
      landingUntil.current = Date.now() + 3200;
      // Start tight on LeBron, then smoothly zoom out.
      const lebron = positionedData.nodes.find((n) => n.id === "lebron");
      if (lebron) {
        fg.centerAt(lebron.x ?? 0, lebron.y ?? 0, 0);
        fg.zoom(5, 0);
        // Smoothly pan + zoom to show everything
        setTimeout(() => {
          fg.zoomToFit(2400, 20);
        }, 500);
      } else {
        fg.zoomToFit(0, 20);
      }
    } else {
      requestAnimationFrame(() => {
        fg.zoomToFit(0, 20);
      });
    }
  }, [positionedData]);

  useEffect(() => {
    if (!fgRef.current || !positionedData || !size.w || !size.h) return;
    // Skip resize-triggered zoom during the landing animation
    if (Date.now() < landingUntil.current) return;
    const fg = fgRef.current;
    requestAnimationFrame(() => {
      fg.zoomToFit(300, 20);
    });
  }, [size.w, size.h, positionedData]);

  useEffect(() => {
    if (!fgRef.current || !data) return;
    // Don't override landing animation
    if (Date.now() < landingUntil.current) return;
    if (selectedPlayerId === null) {
      const id = setTimeout(() => fgRef.current?.zoomToFit?.(700, 20), 30);
      return () => clearTimeout(id);
    }
    const targetNodeId = `p:${selectedPlayerId}`;
    const id = setTimeout(() => {
      fgRef.current?.zoomToFit?.(800, 140, (n) => n.id === "lebron" || n.id === targetNodeId);
    }, 30);
    return () => clearTimeout(id);
  }, [selectedPlayerId, data]);

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

  const isFilteredOut = useMemo(() => {
    return (p: PlayerNode): boolean => {
      if (teamFilter) {
        if (!p.teams.some((t) => t.abbr === teamFilter)) return true;
      }
      return false;
    };
  }, [teamFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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

  // LED twinkle animation on a separate canvas overlay so we don't
  // need to reheat the force simulation (which caused glitching).
  const ledCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!positionedData || !size.w || !size.h) return;
    const canvas = ledCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Each teammate-with-assists yields TWO geos (one per direction). Teammates
    // with no PBP assist data yield ONE faint geo as a fallback.
    type LinkGeo = {
      x1: number; y1: number; cx1: number; cy1: number;
      cx2: number; cy2: number; x2: number; y2: number;
      playerId: number;
      intensity: number;
      // dir: +1 = LeBron → teammate (gold, LEDs flow t 0→1)
      //      -1 = teammate → LeBron (blue, LEDs flow t 1→0)
      //       0 = neutral fallback (white-ish, no PBP data)
      dir: 1 | -1 | 0;
    };
    const geos: LinkGeo[] = [];
    for (const l of positionedData.links) {
      const srcNode = positionedData.nodes.find((n) => n.id === (typeof l.source === "object" ? (l.source as RTNode).id : l.source));
      const tgtNode = positionedData.nodes.find((n) => n.id === (typeof l.target === "object" ? (l.target as RTNode).id : l.target));
      if (!srcNode || !tgtNode || tgtNode.kind !== "player") continue;
      const x1 = srcNode.x ?? 0, y1 = srcNode.y ?? 0;
      const x2 = tgtNode.x ?? 0, y2 = tgtNode.y ?? 0;
      const dx = x2 - x1, dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;
      const player = tgtNode as PlayerNode & RTNode;
      const theta = Math.atan2(dy, dx);
      const perpX = -Math.sin(theta), perpY = Math.cos(theta);
      const astFrom = (l as GraphLink).astFrom ?? 0;
      const astTo = (l as GraphLink).astTo ?? 0;

      if (astFrom === 0 && astTo === 0) {
        // Fallback single curve, matching the static-strand fallback above.
        const j1 = hash01((player.playerId ^ 0xabad1dea) >>> 0);
        const j2 = hash01((player.playerId ^ 0x51ed51ed) >>> 0);
        const points = (l as GraphLink).points ?? 0;
        geos.push({
          x1, y1,
          cx1: x1 + dx * 0.33 + perpX * (j1 - 0.5) * dist * 0.4,
          cy1: y1 + dy * 0.33 + perpY * (j1 - 0.5) * dist * 0.4,
          cx2: x1 + dx * 0.66 + perpX * (j2 - 0.5) * dist * 0.4,
          cy2: y1 + dy * 0.66 + perpY * (j2 - 0.5) * dist * 0.4,
          x2, y2,
          playerId: player.playerId,
          intensity: Math.pow(points / (maxPoints || 1), 0.5),
          dir: 0,
        });
        continue;
      }

      const bow = Math.min(dist * 0.06, 24);
      const j = hash01((player.playerId ^ 0xabad1dea) >>> 0);
      const wobble = (j - 0.5) * dist * 0.18;
      const pushGeo = (dirSign: 1 | -1, count: number) => {
        const off = dirSign * bow;
        geos.push({
          x1, y1,
          cx1: x1 + dx * 0.30 + perpX * (off + wobble),
          cy1: y1 + dy * 0.30 + perpY * (off + wobble),
          cx2: x1 + dx * 0.70 + perpX * (off - wobble),
          cy2: y1 + dy * 0.70 + perpY * (off - wobble),
          x2, y2,
          playerId: player.playerId,
          intensity: Math.pow(count / (maxAst || 1), 0.5),
          dir: dirSign,
        });
      };
      pushGeo(1, astFrom);
      pushGeo(-1, astTo);
    }

    const LED_COUNT = 6;
    type Led = { geo: LinkGeo; t: number; phase: number; speed: number };
    const leds: Led[] = [];
    for (const g of geos) {
      for (let i = 0; i < LED_COUNT; i++) {
        const t = (i + 0.5) / LED_COUNT;
        const seed = (g.playerId * 31 + i * 7919) >>> 0;
        leds.push({
          geo: g, t,
          phase: hash01(seed) * Math.PI * 2,
          speed: 0.8 + hash01((seed ^ 0x1234) >>> 0) * 1.5,
        });
      }
    }

    let raf = 0;
    const draw = () => {
      const fg = fgRef.current;
      if (!fg) { raf = requestAnimationFrame(draw); return; }

      canvas.width = size.w * (window.devicePixelRatio || 1);
      canvas.height = size.h * (window.devicePixelRatio || 1);
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);

      const now = Date.now() / 1000;

      for (const led of leds) {
        const { geo, t, phase, speed } = led;
        const raw = Math.sin(now * speed + phase);
        if (raw < 0.3) continue;
        const brightness = (raw - 0.3) / 0.7;

        // Inbound strands (teammate → LeBron) flow from the teammate side
        // toward LeBron, i.e. parametrically backward.
        const tEff = geo.dir === -1 ? 1 - t : t;
        const u = 1 - tEff;
        const gx = u*u*u*geo.x1 + 3*u*u*tEff*geo.cx1 + 3*u*tEff*tEff*geo.cx2 + tEff*tEff*tEff*geo.x2;
        const gy = u*u*u*geo.y1 + 3*u*u*tEff*geo.cy1 + 3*u*tEff*tEff*geo.cy2 + tEff*tEff*tEff*geo.y2;

        const screen = fg.graph2ScreenCoords(gx, gy);
        const sx = screen.x, sy = screen.y;
        if (sx < -20 || sx > size.w + 20 || sy < -20 || sy > size.h + 20) continue;

        const isHi = highlightedPlayerId !== null && geo.playerId === highlightedPlayerId;
        const filtered = isFilteredOut({ playerId: geo.playerId } as PlayerNode);
        const isDim = (highlightedPlayerId !== null && !isHi) || filtered;
        if (isDim) continue;

        const alpha = brightness * (isHi ? 0.9 : 0.08 + geo.intensity * 0.30);
        const r = isHi ? 3 : 1.0 + geo.intensity * 1.2;
        // Color follows direction: gold (out), blue (in), neutral (no PBP data).
        const baseColor =
          geo.dir === 1 ? "253,185,39" :
          geo.dir === -1 ? "94,182,255" :
          "180,180,180";
        const coreColor =
          isHi ? "255,220,80" :
          geo.dir === 1 ? "255,210,120" :
          geo.dir === -1 ? "180,220,255" :
          "200,200,200";
        const color = isHi ? "253,185,39" : baseColor;

        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.5);
        glow.addColorStop(0, `rgba(${color},${alpha})`);
        glow.addColorStop(0.5, `rgba(${color},${alpha * 0.2})`);
        glow.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${coreColor},${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [positionedData, size.w, size.h, maxPoints, maxAst, highlightedPlayerId, isFilteredOut]);

  // Unique teams LeBron played for (for team filter dropdown)
  const lebronTeams = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, string>();
    for (const n of data.nodes) {
      if (n.kind === "player") {
        for (const t of n.teams) {
          if (!seen.has(t.abbr)) seen.set(t.abbr, t.fullName);
        }
      }
    }
    return Array.from(seen.entries()).map(([abbr, fullName]) => ({ abbr, fullName })).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [data]);

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
    <div className="relative flex h-full w-full bg-black">
      {/* Left: infographic stat panel */}
      {data && !minLoading && (
        <div className="relative z-10 flex w-[340px] shrink-0 flex-col justify-center border-r border-white/8 px-10">
          <AssistsStatsCard stats={data.stats} />
        </div>
      )}
      {/* Right: graph */}
      <div
        ref={wrapRef}
        className="relative min-w-0 flex-1"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        onMouseLeave={() => setCursor(null)}
      >
      {positionedData && size.w > 0 && !minLoading && (
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
            const theta = Math.atan2(dy, dx);
            const perpX = -Math.sin(theta);
            const perpY = Math.cos(theta);

            const isHi = highlightedPlayerId !== null && player.playerId === highlightedPlayerId;
            const filtered = isFilteredOut(player);
            const isDim = (highlightedPlayerId !== null && !isHi) || (filtered && !isHi);

            const astFrom = (l as GraphLink).astFrom ?? 0;
            const astTo = (l as GraphLink).astTo ?? 0;

            // Fallback: faint single strand when we have no PBP assist data
            // for this teammate (older seasons, short stints, etc.).
            if (astFrom === 0 && astTo === 0) {
              const j1 = hash01((player.playerId ^ 0xabad1dea) >>> 0);
              const j2 = hash01((player.playerId ^ 0x51ed51ed) >>> 0);
              const curl1 = (j1 - 0.5) * dist * 0.4;
              const curl2 = (j2 - 0.5) * dist * 0.4;
              const cx1 = x1 + dx * 0.33 + perpX * curl1;
              const cy1 = y1 + dy * 0.33 + perpY * curl1;
              const cx2 = x1 + dx * 0.66 + perpX * curl2;
              const cy2 = y1 + dy * 0.66 + perpY * curl2;
              const pts = (l as GraphLink).points ?? 0;
              const intensity = Math.pow(pts / maxPoints, 0.5);
              ctx.strokeStyle = isHi
                ? "rgba(253,185,39,0.9)"
                : isDim
                ? "rgba(255,255,255,0.012)"
                : `rgba(255,255,255,${0.03 + intensity * 0.05})`;
              ctx.lineWidth = (isHi ? 1.5 : 0.25) / globalScale;
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
              ctx.stroke();
              return;
            }

            // Two parallel strands, bowed apart so they read as separate flows.
            // The "bow" magnitude scales with distance so short edges still split.
            const bow = Math.min(dist * 0.06, 24);
            // Each strand keeps a small per-player jitter so the graph doesn't
            // look like a perfect schematic.
            const j = hash01((player.playerId ^ 0xabad1dea) >>> 0);
            const wobble = (j - 0.5) * dist * 0.18;

            const drawStrand = (
              dirSign: 1 | -1,           // +1 = outbound side (gold), -1 = inbound side (blue)
              count: number,             // assists in this direction
              colorRgb: string,          // "253,185,39" etc.
            ) => {
              const off = dirSign * bow;
              const cx1 = x1 + dx * 0.30 + perpX * (off + wobble);
              const cy1 = y1 + dy * 0.30 + perpY * (off + wobble);
              const cx2 = x1 + dx * 0.70 + perpX * (off - wobble);
              const cy2 = y1 + dy * 0.70 + perpY * (off - wobble);
              const intensity = Math.pow(count / (maxAst || 1), 0.5);
              const alpha = isHi ? 0.85 : isDim ? 0.02 : 0.08 + intensity * 0.55;
              const width = (isHi ? 1.6 : 0.4 + intensity * 1.6) / globalScale;
              ctx.strokeStyle = `rgba(${colorRgb},${alpha})`;
              ctx.lineWidth = width;
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
              ctx.stroke();
            };

            // Always draw both, even if one is zero — a near-invisible strand
            // signals "this direction was not used" rather than hiding it.
            drawStrand(1, astFrom, "253,185,39");   // gold: LeBron → teammate
            drawStrand(-1, astTo, "94,182,255");    // blue: teammate → LeBron
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

            if (rt.kind === "self") {
              const r = rt.radius;
              const t = Date.now() / 1000;
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
              const haloR = r * (4.2 + pulse * 1.6);

              // Purple-gold halo for assists theme
              const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, haloR);
              halo.addColorStop(0, `rgba(138,100,255,${0.32 + pulse * 0.2})`);
              halo.addColorStop(0.4, `rgba(253,185,39,${0.12 + pulse * 0.08})`);
              halo.addColorStop(0.7, "rgba(138,100,255,0.06)");
              halo.addColorStop(1, "rgba(138,100,255,0)");
              ctx.fillStyle = halo;
              ctx.beginPath();
              ctx.arc(x, y, haloR, 0, Math.PI * 2);
              ctx.fill();

              for (let i = 0; i < 3; i++) {
                const ringR = r + 8 + i * 6 + pulse * 4;
                ctx.strokeStyle = `rgba(138,100,255,${0.22 - i * 0.06})`;
                ctx.lineWidth = 1 / globalScale;
                ctx.beginPath();
                ctx.arc(x, y, ringR, 0, Math.PI * 2);
                ctx.stroke();
              }

              // Gold center
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

            const isHighlighted = highlightedPlayerId !== null && rt.playerId === highlightedPlayerId;
            const filteredOut = isFilteredOut(rt as PlayerNode);
            const r = isHighlighted ? rt.radius * 1.6 : rt.radius;

            // Highlighted player gets a purple-gold halo
            if (isHighlighted) {
              const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
              halo.addColorStop(0, "rgba(138,100,255,0.8)");
              halo.addColorStop(0.5, "rgba(253,185,39,0.3)");
              halo.addColorStop(1, "rgba(138,100,255,0)");
              ctx.fillStyle = halo;
              ctx.beginPath();
              ctx.arc(x, y, r * 4, 0, Math.PI * 2);
              ctx.fill();
            }

            // Points intensity drives the purple tint
            const pts = (rt as PlayerNode).points ?? 0;
            const intensity = Math.pow(pts / maxPoints, 0.5);

            ctx.fillStyle = isHighlighted
              ? "#FDB927"
              : filteredOut
              ? "rgba(138,100,255,0.06)"
              : dimmed
              ? "rgba(138,100,255,0.12)"
              : `rgba(${Math.round(138 + (255 - 138) * intensity)},${Math.round(100 + (255 - 100) * intensity * 0.3)},255,${0.35 + intensity * 0.5})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();

            if (isHighlighted) {
              ctx.strokeStyle = "rgba(253,185,39,1)";
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
      {positionedData && size.w > 0 && !minLoading && (
        <canvas
          ref={ledCanvasRef}
          className="pointer-events-none absolute inset-0"
          style={{ width: size.w, height: size.h }}
        />
      )}
      {(!data || minLoading) && !apiErr && <BallLoader color="#8a64ff" />}
      {data && !minLoading && (
        <>
          <TeammatesControls
            players={playerSearchList}
            selectedPlayerId={selectedPlayerId}
            onSelect={setSelectedPlayerId}
            lebronTeams={lebronTeams}
            teamFilter={teamFilter}
            onTeamChange={setTeamFilter}
          />
          <TeammatesDetailCard
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
    </div>
  );
}

function AssistsStatsCard({ stats }: { stats: Stats }) {
  return (
    <div className="space-y-8 text-white">
      <div>
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">LeBron James</div>
        <div className="mt-1 font-mono text-sm font-light tracking-[0.2em] text-white/60">The players he fed</div>
      </div>

      {/* Big hero number: assists */}
      <div>
        <div className="font-serif text-7xl font-light leading-none tracking-tight">{stats.lebronAssists.toLocaleString()}</div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.4em] text-white/40">career assists</div>
      </div>

      {/* Teammates / Points row */}
      <div className="flex gap-6 border-t border-white/10 pt-6">
        <div>
          <div className="font-mono text-3xl font-light leading-none text-[#8a64ff]">{stats.teammateCount.toLocaleString()}</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-white/40">teammates</div>
        </div>
        <div className="border-l border-white/10 pl-6">
          <div className="font-mono text-3xl font-light leading-none">{stats.ptsOffAssistsCombined.toLocaleString()}</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-white/40">pts off assists</div>
        </div>
      </div>

      <div className="space-y-1 border-t border-white/8 pt-5">
        <p className="text-xs leading-relaxed text-white/45">
          Across {stats.lebronGames.toLocaleString()} games, LeBron dished out {stats.lebronAssists.toLocaleString()} assists
          to {stats.teammateCount.toLocaleString()} distinct teammates.
        </p>
      </div>
    </div>
  );
}

function TeammatesControls({
  players,
  selectedPlayerId,
  onSelect,
  lebronTeams,
  teamFilter,
  onTeamChange,
}: {
  players: { playerId: number; name: string; ptsOff: number; games: number; teams: string[] }[];
  selectedPlayerId: number | null;
  onSelect: (id: number | null) => void;
  lebronTeams: { abbr: string; fullName: string }[];
  teamFilter: string | null;
  onTeamChange: (abbr: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Show the full set so the inner scroll engages — list is ~200 teammates max.
    if (!needle) return players;
    return players.filter((p) => p.name.toLowerCase().includes(needle));
  }, [q, players]);

  const selectedName = useMemo(
    () => (selectedPlayerId !== null ? players.find((p) => p.playerId === selectedPlayerId)?.name ?? "" : ""),
    [selectedPlayerId, players],
  );

  const filtersActive = teamFilter !== null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`absolute right-6 top-6 z-10 rounded-md border bg-black/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] backdrop-blur ${
          filtersActive
            ? "border-[#8a64ff]/60 text-[#8a64ff]"
            : "border-white/15 text-white/75 hover:border-white/35 hover:text-white"
        }`}
      >
        search · filter{filtersActive ? " ●" : ""}
      </button>
    );
  }

  return (
    <div className="absolute right-6 top-6 z-10 w-80 space-y-3 rounded-md border border-white/15 bg-black/80 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/55">search · filter</div>
        <button onClick={() => setOpen(false)} className="text-white/45 hover:text-white text-base leading-none" aria-label="Close panel">×</button>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          ref={inputRef}
          value={q || (selectedName && !searchOpen ? selectedName : "")}
          onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
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
          placeholder="Search a teammate…"
          className="w-full rounded-sm border border-white/10 bg-black/60 px-3 py-2 pr-8 font-mono text-xs text-white outline-none placeholder:text-white/30 focus:border-white/30"
        />
        {(q || selectedPlayerId !== null) && (
          <button
            onClick={() => { setQ(""); onSelect(null); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs"
            aria-label="Clear search"
          >×</button>
        )}
        {searchOpen && matches.length > 0 && (
          <div
            // Prevent the input from losing focus when the user clicks the
            // scrollbar (otherwise onBlur fires and the dropdown closes
            // before the scroll registers).
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-sm border border-white/10 bg-black/95 backdrop-blur shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
          >
            {matches.map((p) => (
              <button
                key={p.playerId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(p.playerId); setQ(""); setSearchOpen(false); }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-white/85 hover:bg-white/5"
              >
                <span className="font-mono truncate">{p.name}</span>
                <span className="flex items-center gap-1.5 text-white/40">
                  <span className="text-[10px]">{p.ptsOff.toLocaleString()}pts off ast</span>
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
            <button onClick={() => onTeamChange(null)} className="text-[10px] uppercase tracking-[0.2em] text-white/50 hover:text-white">reset</button>
          )}
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">team</span>
          <TeamDropdown options={lebronTeams} value={teamFilter} onChange={onTeamChange} />
        </div>
      </div>
    </div>
  );
}

function TeamDropdown({
  options,
  value,
  onChange,
}: {
  options: { abbr: string; fullName: string }[];
  value: string | null;
  onChange: (abbr: string | null) => void;
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

  const selected = value ? options.find((o) => o.abbr === value) ?? null : null;

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
            <span className="truncate">{selected.fullName}</span>
          </span>
        ) : (
          <span className="text-white/55">All teams</span>
        )}
        <svg viewBox="0 0 12 8" className={`h-2 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1.5l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-sm border border-white/15 bg-black/95 backdrop-blur shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs hover:bg-white/5 ${
              value === null ? "bg-white/10 text-white" : "text-white/75"
            }`}
          >
            <span className="w-9 text-white/35">all</span>
            <span>All teams</span>
          </button>
          {options.map((o) => {
            const tm = findTeam(o.abbr);
            return (
              <button
                key={o.abbr}
                type="button"
                onClick={() => { onChange(o.abbr); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs hover:bg-white/5 ${
                  value === o.abbr ? "bg-white/10 text-white" : "text-white/80"
                }`}
              >
                {tm ? <img src={logoUrl(tm)} alt={o.abbr} className="h-4 w-4 object-contain" /> : null}
                <span className="w-9 text-white/35">{o.abbr}</span>
                <span className="truncate">{o.fullName}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeammatesDetailCard({
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
    const points = allTeamsForPlayer.reduce((s, n) => s + n.points, 0);
    const astFrom = allTeamsForPlayer[0]?.assistsFromLebron ?? 0;
    const astTo = allTeamsForPlayer[0]?.assistsToLebron ?? 0;
    const ptsOffFrom = allTeamsForPlayer[0]?.ptsOffFromLebron ?? 0;
    const ptsOffTo = allTeamsForPlayer[0]?.ptsOffToLebron ?? 0;
    const firsts = allTeamsForPlayer.map((n) => n.firstTogether).sort();
    const lasts = allTeamsForPlayer.map((n) => n.lastTogether).sort();
    return {
      games,
      points,
      astFrom,
      astTo,
      ptsOffFrom,
      ptsOffTo,
      firstYear: firsts[0]?.slice(0, 4) ?? "",
      lastYear: lasts[lasts.length - 1]?.slice(0, 4) ?? "",
    };
  }, [allTeamsForPlayer]);

  if (!player || !aggregate) return null;

  const cardW = 300;
  const cardH = 200;
  const pad = 14;
  const dotR = (player.radius ?? 6) + 8;

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
            <button onClick={onClear} className="text-white/40 hover:text-white text-xs" aria-label="Clear selection">×</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 font-mono">
          <Stat label="games" value={aggregate.games} accent="text-white" />
          <Stat
            label="pts off assists"
            value={aggregate.ptsOffFrom + aggregate.ptsOffTo}
            accent="text-[#8a64ff]"
          />
        </div>
        <AssistFlow
          name={player.name}
          fromLebron={aggregate.astFrom}
          toLebron={aggregate.astTo}
          ptsFromLebron={aggregate.ptsOffFrom}
          ptsToLebron={aggregate.ptsOffTo}
        />
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
                {t.abbr} · {t.games}g · {t.points.toLocaleString()}pts
              </span>
            );
          })}
        </div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">
          together {aggregate.firstYear}
          {aggregate.firstYear !== aggregate.lastYear ? `–${aggregate.lastYear}` : ""}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <div className={`text-xl leading-none ${accent}`}>{value.toLocaleString()}</div>
      <div className="mt-1 text-[9px] uppercase tracking-[0.25em] text-white/40">{label}</div>
    </div>
  );
}

// Two-way assist exchange. Bar widths are proportional to the larger side, so
// you can see at a glance who fed whom more. Each row shows assist count and
// the points scored on those assists (so the math is internally consistent).
function AssistFlow({
  name, fromLebron, toLebron, ptsFromLebron, ptsToLebron,
}: {
  name: string;
  fromLebron: number; toLebron: number;
  ptsFromLebron: number; ptsToLebron: number;
}) {
  const firstName = name.split(/\s+/)[0] ?? name;
  const max = Math.max(fromLebron, toLebron, 1);
  const fromPct = Math.round((fromLebron / max) * 100);
  const toPct = Math.round((toLebron / max) * 100);
  if (fromLebron === 0 && toLebron === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-white/10 pt-3 font-mono">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-white/40">
        <span>assists</span>
        <span className="text-white/30">ast · pts</span>
      </div>
      <div className="space-y-1.5">
        <FlowRow
          leftLabel="LeBron"
          arrow="→"
          rightLabel={firstName}
          value={fromLebron}
          pts={ptsFromLebron}
          pct={fromPct}
          color="#ffb547"
        />
        <FlowRow
          leftLabel={firstName}
          arrow="→"
          rightLabel="LeBron"
          value={toLebron}
          pts={ptsToLebron}
          pct={toPct}
          color="#5eb6ff"
        />
      </div>
    </div>
  );
}

function FlowRow({
  leftLabel, arrow, rightLabel, value, pts, pct, color,
}: { leftLabel: string; arrow: string; rightLabel: string; value: number; pts: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/85">
      <div className="w-[112px] shrink-0 truncate text-[10px] tracking-[0.05em] text-white/55">
        {leftLabel} <span className="text-white/35">{arrow}</span> {rightLabel}
      </div>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-sm bg-white/5">
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <div className="shrink-0 text-right tabular-nums text-[10px]" style={{ color }}>
        <span className="font-medium">{value.toLocaleString()}</span>
        <span className="ml-1 text-white/45">· {pts.toLocaleString()}p</span>
      </div>
    </div>
  );
}
