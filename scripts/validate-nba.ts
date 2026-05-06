/**
 * Validates our SQLite database of LeBron's career against the official NBA
 * Stats API (stats.nba.com). Walks the playercareerstats endpoint, compares
 * career totals + per-season totals, and prints a diff report.
 *
 *   Run: npx tsx scripts/validate-nba.ts
 *
 * Doesn't write anything — read-only audit. Run after every reseed.
 */
import { openDb } from "../src/lib/db";

const DB_PATH = "data/nba.db";
const LEBRON_ID = 2544;

const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  Connection: "keep-alive",
};

type ResultSet = { name: string; headers: string[]; rowSet: unknown[][] };
type ApiResponse = { resultSets: ResultSet[] };

async function fetchCareerStats(): Promise<ApiResponse> {
  const url = `https://stats.nba.com/stats/playercareerstats?PlayerID=${LEBRON_ID}&PerMode=Totals`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: NBA_HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`stats.nba.com returned HTTP ${res.status}`);
    return (await res.json()) as ApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

function rowAsObject(rs: ResultSet, row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  rs.headers.forEach((h, i) => (out[h] = row[i]));
  return out;
}

// Color helpers — terminal-friendly, no deps.
const grn = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yel = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type Diff = {
  label: string;
  ours: number;
  theirs: number;
  unit?: string;
  // Tolerance: an absolute or percentage threshold within which a delta is
  // considered "expected drift", not a real mismatch (e.g. minutes are stored
  // as integer-ish in our seed CSV, fractional in NBA's API).
  tolerancePct?: number;
};

function printDiff(diffs: Diff[], header: string) {
  console.log("\n" + bold(header));
  console.log(dim("─".repeat(header.length)));
  for (const d of diffs) {
    const delta = d.ours - d.theirs;
    const pct = d.theirs !== 0 ? Math.abs(delta / d.theirs) * 100 : 0;
    const within = d.tolerancePct != null && pct <= d.tolerancePct;
    const exact = delta === 0;
    const marker = exact ? grn("✓") : within ? yel("≈") : red("✗");
    const ours = String(d.ours).padStart(8);
    const theirs = String(d.theirs).padStart(8);
    const deltaStr = delta === 0 ? "" : delta > 0 ? `+${delta}` : `${delta}`;
    const pctStr = delta === 0 ? "" : `(${pct.toFixed(2)}%)`;
    console.log(
      `  ${marker} ${d.label.padEnd(36)} ours=${ours}  api=${theirs}  ${dim(`${deltaStr.padStart(7)} ${pctStr}`)}`,
    );
  }
}

async function main() {
  console.log(bold("Validating SQLite DB against stats.nba.com..."));
  console.log(dim(`  player: LeBron James (id=${LEBRON_ID})`));
  console.log(dim(`  db:     ${DB_PATH}`));

  const db = openDb(DB_PATH);
  let api: ApiResponse;
  try {
    api = await fetchCareerStats();
  } catch (e) {
    console.error(red(`\nstats.nba.com unreachable: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }

  const careerReg = api.resultSets.find((r) => r.name === "CareerTotalsRegularSeason");
  const careerPo = api.resultSets.find((r) => r.name === "CareerTotalsPostSeason");
  const seasonReg = api.resultSets.find((r) => r.name === "SeasonTotalsRegularSeason");
  const seasonPo = api.resultSets.find((r) => r.name === "SeasonTotalsPostSeason");
  if (!careerReg || !careerPo || !seasonReg || !seasonPo) {
    throw new Error("Missing expected resultSets in API response");
  }
  const cr = rowAsObject(careerReg, careerReg.rowSet[0]);
  const cp = rowAsObject(careerPo, careerPo.rowSet[0]);

  // --- Career totals ----------------------------------------------------
  const ours = db
    .prepare(
      `WITH lj AS (
         SELECT a.minutes, a.points, g.game_type
         FROM appearances a JOIN games g ON g.id=a.game_id
         WHERE a.player_id=? AND g.game_type IN ('Regular Season','Playoffs')
       )
       SELECT
         SUM(CASE WHEN game_type='Regular Season' AND minutes>0 THEN 1 ELSE 0 END) AS reg_gp,
         COALESCE(ROUND(SUM(CASE WHEN game_type='Regular Season' THEN minutes ELSE 0 END)), 0) AS reg_min,
         COALESCE(SUM(CASE WHEN game_type='Regular Season' THEN points ELSE 0 END), 0) AS reg_pts,
         SUM(CASE WHEN game_type='Playoffs' AND minutes>0 THEN 1 ELSE 0 END) AS po_gp,
         COALESCE(ROUND(SUM(CASE WHEN game_type='Playoffs' THEN minutes ELSE 0 END)), 0) AS po_min,
         COALESCE(SUM(CASE WHEN game_type='Playoffs' THEN points ELSE 0 END), 0) AS po_pts
       FROM lj`,
    )
    .get(LEBRON_ID) as {
    reg_gp: number; reg_min: number; reg_pts: number;
    po_gp: number; po_min: number; po_pts: number;
  };

  const careerDiffs: Diff[] = [
    { label: "regular-season games played",   ours: ours.reg_gp,  theirs: Number(cr.GP) },
    { label: "regular-season minutes",        ours: ours.reg_min, theirs: Number(cr.MIN), tolerancePct: 2 },
    { label: "regular-season points",         ours: ours.reg_pts, theirs: Number(cr.PTS) },
    { label: "playoff games played",          ours: ours.po_gp,   theirs: Number(cp.GP) },
    { label: "playoff minutes",               ours: ours.po_min,  theirs: Number(cp.MIN), tolerancePct: 2 },
    { label: "playoff points",                ours: ours.po_pts,  theirs: Number(cp.PTS) },
  ];
  printDiff(careerDiffs, "Career totals");

  // --- Per-season --------------------------------------------------------
  // Map season-id like "2003-04" -> our row totals from the DB.
  const ourSeasons = db
    .prepare(
      `SELECT g.season,
              g.game_type,
              SUM(CASE WHEN a.minutes>0 THEN 1 ELSE 0 END) AS gp,
              COALESCE(ROUND(SUM(a.minutes)), 0) AS min,
              COALESCE(SUM(a.points), 0) AS pts
       FROM appearances a JOIN games g ON g.id=a.game_id
       WHERE a.player_id=? AND g.game_type IN ('Regular Season','Playoffs')
       GROUP BY g.season, g.game_type`,
    )
    .all(LEBRON_ID) as { season: string; game_type: string; gp: number; min: number; pts: number }[];

  const ourMap = new Map<string, { reg?: typeof ourSeasons[number]; po?: typeof ourSeasons[number] }>();
  for (const s of ourSeasons) {
    const slot = ourMap.get(s.season) ?? {};
    if (s.game_type === "Regular Season") slot.reg = s;
    else if (s.game_type === "Playoffs") slot.po = s;
    ourMap.set(s.season, slot);
  }

  console.log("\n" + bold("Per-season — Regular"));
  console.log(dim("─".repeat(20)));
  printPerSeason(seasonReg, ourMap, "reg");

  console.log("\n" + bold("Per-season — Playoffs"));
  console.log(dim("─".repeat(21)));
  printPerSeason(seasonPo, ourMap, "po");

  // Season-by-season highest score and highest minute count compared to API
  // SeasonHighs would let us validate "highest game" too, but the SeasonHighs
  // table is small and idiosyncratic — skipping for now.

  console.log("\n" + dim("✓ exact   ≈ within tolerance   ✗ mismatch"));
  console.log(dim("Tolerance: minutes ±2% (NBA API stores fractional, our seed CSV is integer-ish)\n"));

  db.close();
}

function printPerSeason(
  rs: ResultSet,
  ourMap: Map<string, { reg?: { gp: number; min: number; pts: number }; po?: { gp: number; min: number; pts: number } }>,
  kind: "reg" | "po",
) {
  type Row = { season: string; gp: number; min: number; pts: number };
  const apiRows: Row[] = rs.rowSet.map((r) => {
    const o = rowAsObject(rs, r);
    return {
      season: String(o.SEASON_ID),
      gp: Number(o.GP),
      min: Number(o.MIN),
      pts: Number(o.PTS),
    };
  });

  let ok = 0;
  let drift = 0;
  let bad = 0;
  for (const a of apiRows) {
    const o = ourMap.get(a.season)?.[kind];
    if (!o) {
      console.log(`  ${red("✗")} ${a.season}  ${dim("missing in DB")}`);
      bad++;
      continue;
    }
    const dGp = o.gp - a.gp;
    const dMin = o.min - a.min;
    const dPts = o.pts - a.pts;
    const minPct = a.min ? Math.abs(dMin / a.min) * 100 : 0;
    const minOk = dMin === 0 || minPct <= 2;
    const allOk = dGp === 0 && dPts === 0 && minOk;
    const flagged = dGp !== 0 || dPts !== 0 || !minOk;
    if (!flagged) {
      ok++;
      continue;
    }
    if (allOk) drift++;
    else bad++;
    const flag = !allOk ? red("✗") : yel("≈");
    const parts: string[] = [];
    if (dGp !== 0) parts.push(`gp ${o.gp}/${a.gp} (${dGp > 0 ? "+" : ""}${dGp})`);
    if (dMin !== 0) parts.push(`min ${o.min}/${a.min} (${dMin > 0 ? "+" : ""}${dMin}, ${minPct.toFixed(1)}%)`);
    if (dPts !== 0) parts.push(`pts ${o.pts}/${a.pts} (${dPts > 0 ? "+" : ""}${dPts})`);
    console.log(`  ${flag} ${a.season}  ${parts.join("  ·  ")}`);
  }
  // Find seasons in our DB that aren't in the API (extras we shouldn't have).
  for (const [season, slot] of ourMap) {
    if (!slot[kind]) continue;
    if (!apiRows.find((a) => a.season === season)) {
      console.log(`  ${red("✗")} ${season}  ${dim("present in DB but not in API")}`);
      bad++;
    }
  }
  console.log(dim(`  → ${ok} exact, ${drift} within tolerance, ${bad} mismatched`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
