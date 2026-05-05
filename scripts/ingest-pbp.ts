/**
 * Ingests LeBron James's per-event scoring from NBA Stats play-by-play CSVs
 * (shufinskiy/nba_data on GitHub) into a `lebron_scoring_events` table.
 *
 * Source: https://github.com/shufinskiy/nba_data — `nbastats_<season>.tar.xz`
 *   (one CSV per season, full PBP from stats.nba.com).
 *
 *   Run: npm run ingest:pbp
 *
 * Output table columns: game_id, season, period, game_minute, team_abbr, points,
 * is_playoff, is_home (derived).
 *
 * Game-minute convention: 1..48 for regulation, 49..53 for OT1, etc. Computed
 * from PERIOD + clock-elapsed (12 - PCTIMESTRING for Q1-4, 5 - clock for OT).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync, spawn } from "node:child_process";
import { openDb } from "../src/lib/db";
import { TEAMS } from "../src/lib/teams";

const RAW_DIR = path.join(process.cwd(), "data", "raw", "pbp");
const DB_PATH = path.join(process.cwd(), "data", "nba.db");
const LEBRON_PERSON_ID = "2544";

// Seasons to ingest. shufinskiy uses the season's start year.
// LeBron's career: 2003-04 → 2024-25. 2025-26 PBP is not yet published upstream.
const SEASONS = Array.from({ length: 22 }, (_, i) => 2003 + i); // 2003..2024

const URL_FOR = (season: number) =>
  `https://github.com/shufinskiy/nba_data/raw/main/datasets/nbastats_${season}.tar.xz`;

// NBA's internal team_id → our local team_abbr.
const TEAM_ID_TO_ABBR: Record<string, string> = {
  "1610612737": "ATL", "1610612738": "BOS", "1610612751": "BKN", "1610612766": "CHA",
  "1610612741": "CHI", "1610612739": "CLE", "1610612742": "DAL", "1610612743": "DEN",
  "1610612765": "DET", "1610612744": "GSW", "1610612745": "HOU", "1610612754": "IND",
  "1610612746": "LAC", "1610612747": "LAL", "1610612763": "MEM", "1610612748": "MIA",
  "1610612749": "MIL", "1610612750": "MIN", "1610612740": "NOP", "1610612752": "NYK",
  "1610612760": "OKC", "1610612753": "ORL", "1610612755": "PHI", "1610612756": "PHX",
  "1610612757": "POR", "1610612758": "SAC", "1610612759": "SAS", "1610612761": "TOR",
  "1610612762": "UTA", "1610612764": "WAS",
};

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function downloadIfMissing(season: number): Promise<string> {
  ensureDir(RAW_DIR);
  const archive = path.join(RAW_DIR, `nbastats_${season}.tar.xz`);
  const csv = path.join(RAW_DIR, `nbastats_${season}.csv`);
  if (fs.existsSync(csv)) return csv;
  if (!fs.existsSync(archive)) {
    process.stdout.write(`  ↓ downloading ${season}... `);
    const res = spawnSync("curl", ["-sSL", "-o", archive, URL_FOR(season)], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`curl failed for ${season}`);
    process.stdout.write("done\n");
  }
  process.stdout.write(`  ↳ extracting ${season}... `);
  const res = spawnSync("tar", ["-xJf", archive, "-C", RAW_DIR], { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`tar failed for ${season}`);
  process.stdout.write("done\n");
  return csv;
}

// Season label like "2003-04" given start year.
function seasonLabel(start: number): string {
  const yy = String((start + 1) % 100).padStart(2, "0");
  return `${start}-${yy}`;
}

// Game-minute (1-indexed) from PERIOD + clock string (M:SS, e.g. "12:00").
// Returns the minute *during which* the play happened.
//   PERIOD 1, clock 12:00 → minute 1; clock 0:01 → minute 12.
//   PERIOD 5 (OT1), clock 5:00 → minute 49; clock 0:01 → minute 53.
function gameMinute(period: number, clock: string): number | null {
  const m = clock.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const sec = parseFloat(m[2]);
  const elapsed = (period <= 4 ? 12 : 5) - min - sec / 60;
  if (elapsed < 0) return null;
  // 1-indexed: minute 1 is [0, 1).
  const minuteIndex = Math.min(Math.floor(elapsed), period <= 4 ? 11 : 4);
  const base = period <= 4 ? (period - 1) * 12 : 48 + (period - 5) * 5;
  return base + minuteIndex + 1;
}

// Parse "(N PTS)" from event description; returns N or null.
function parseRunningPts(desc: string): number | null {
  const m = desc.match(/\((\d+)\s*PTS\)/);
  return m ? parseInt(m[1], 10) : null;
}

// Build the team_id → numeric local team_id map (DB-side).
function loadTeamLookup(db: ReturnType<typeof openDb>): Map<string, number> {
  const rows = db.prepare("SELECT id, abbr FROM teams").all() as { id: number; abbr: string }[];
  const byAbbr = new Map(rows.map((r) => [r.abbr, r.id]));
  const out = new Map<string, number>();
  for (const [nbaId, abbr] of Object.entries(TEAM_ID_TO_ABBR)) {
    const localId = byAbbr.get(abbr);
    if (localId !== undefined) out.set(nbaId, localId);
  }
  return out;
}

// Parse a single CSV line respecting double-quoted fields.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

type Event = {
  gameId: string;
  season: string;
  period: number;
  gameMinute: number;
  teamId: number | null;
  points: number;
  isHome: 0 | 1 | null;
};

async function processSeason(
  csvPath: string,
  startYear: number,
  teamLookup: Map<string, number>,
): Promise<Event[]> {
  const season = seasonLabel(startYear);
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const events: Event[] = [];

  let header: string[] | null = null;
  let idx: Record<string, number> = {};
  // Track running PTS per game so we can derive points-on-this-event.
  const runningByGame = new Map<string, number>();

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      continue;
    }
    // Quick filter: must contain LeBron's id to bother parsing.
    if (!line.includes(LEBRON_PERSON_ID)) continue;
    const cols = parseCsvLine(line);
    if (cols[idx.PLAYER1_ID] !== LEBRON_PERSON_ID) continue;

    const eventMsgType = cols[idx.EVENTMSGTYPE];
    // 1 = made FG, 3 = free throw (made or missed). Skip everything else.
    if (eventMsgType !== "1" && eventMsgType !== "3") continue;

    const home = cols[idx.HOMEDESCRIPTION] ?? "";
    const visitor = cols[idx.VISITORDESCRIPTION] ?? "";
    const desc = home || visitor;
    if (!desc) continue;
    // Skip missed FTs: "MISS James Free Throw 1 of 2". Made FGs are always "(N PTS)".
    if (/^MISS\b/.test(desc)) continue;

    const running = parseRunningPts(desc);
    if (running == null) continue; // safety: every made play should have it.

    const gameId = cols[idx.GAME_ID];
    const prev = runningByGame.get(gameId) ?? 0;
    const points = running - prev;
    runningByGame.set(gameId, running);
    if (points <= 0 || points > 4) continue; // sanity guard

    const period = parseInt(cols[idx.PERIOD], 10);
    const minute = gameMinute(period, cols[idx.PCTIMESTRING]);
    if (!minute) continue;

    const nbaTeamId = cols[idx.PLAYER1_TEAM_ID];
    const teamId = teamLookup.get(nbaTeamId) ?? null;
    const isHome = home ? 1 : visitor ? 0 : null;

    events.push({ gameId, season, period, gameMinute: minute, teamId, points, isHome });
  }

  return events;
}

async function main() {
  const onlyArg = process.argv.slice(2).find((a) => a.startsWith("--season="));
  const seasons = onlyArg ? [parseInt(onlyArg.slice("--season=".length), 10)] : SEASONS;

  const db = openDb(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lebron_scoring_events (
      game_id      TEXT NOT NULL,
      season       TEXT NOT NULL,
      period       INTEGER NOT NULL,
      game_minute  INTEGER NOT NULL,
      team_id      INTEGER REFERENCES teams(id),
      points       INTEGER NOT NULL,
      is_home      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lse_season ON lebron_scoring_events(season);
    CREATE INDEX IF NOT EXISTS idx_lse_minute ON lebron_scoring_events(game_minute);
  `);
  const teamLookup = loadTeamLookup(db);

  const insert = db.prepare(
    "INSERT INTO lebron_scoring_events (game_id, season, period, game_minute, team_id, points, is_home) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const deleteSeason = db.prepare("DELETE FROM lebron_scoring_events WHERE season = ?");
  const insertMany = db.transaction((rows: Event[]) => {
    for (const e of rows) {
      insert.run(e.gameId, e.season, e.period, e.gameMinute, e.teamId, e.points, e.isHome);
    }
  });

  let total = 0;
  for (const startYear of seasons) {
    const label = seasonLabel(startYear);
    console.log(`\nseason ${label}`);
    const csv = await downloadIfMissing(startYear);
    const events = await processSeason(csv, startYear, teamLookup);
    deleteSeason.run(label);
    insertMany(events);
    const seasonPts = events.reduce((s, e) => s + e.points, 0);
    console.log(`  → ${events.length} scoring events, ${seasonPts} points`);
    total += events.length;
  }
  console.log(`\ntotal: ${total} events across ${seasons.length} seasons`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
