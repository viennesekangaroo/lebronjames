/**
 * Seeds (or re-seeds) data/nba.db from stats.nba.com — replaces the Kaggle CSV
 * pipeline for everything LeBron-adjacent.
 *
 *   Run: npm run seed:nba
 *
 * Two-phase fetch:
 *   1. playergamelog for LeBron across all season-types we care about → list
 *      of every game he played, with our local game_id (= NBA game_id).
 *   2. boxscoretraditionalv2 for each game → all participants' box scores
 *      (minutes/points/assists/team/opponent/home/win). One call per game.
 *
 * Resume-friendly: a checkpoint file at data/raw/seed-nba.checkpoint.json
 * tracks completed game_ids so re-running picks up where it left off.
 *
 * Pacing: ~1 req/s to stay under stats.nba.com's unofficial rate limit.
 *
 * Game-ID format: stats.nba.com returns "0022300042" (10-digit, leading zeros).
 * We strip the leading zeros to match the rest of the codebase ("22300042").
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../src/lib/db";
import { TEAMS } from "../src/lib/teams";

const LEBRON_ID = 2544;
const RAW_DIR = path.join(process.cwd(), "data", "raw");
const CHECKPOINT = path.join(RAW_DIR, "seed-nba.checkpoint.json");

const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

// stats.nba.com season-type strings → our game_type label.
// "Regular Season" includes Cup group-stage games (per NBA's official accounting).
// Pre Season is intentionally excluded — it's not part of any career stat.
const SEASON_TYPES: { api: string; label: string }[] = [
  { api: "Regular Season", label: "Regular Season" },
  { api: "Playoffs", label: "Playoffs" },
  { api: "PlayIn", label: "Play-in Tournament" },
  { api: "IST", label: "NBA Cup Final" }, // championship game only; group stage is in RS
];

const SEASONS = Array.from({ length: 23 }, (_, i) => 2003 + i); // 2003..2025

type StatsResponse = {
  resultSets: { name: string; headers: string[]; rowSet: (string | number | null)[][] }[];
};

function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

async function fetchJson(url: string, attempt = 1): Promise<StatsResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url, { headers: NBA_HEADERS, signal: ac.signal });
    if (res.status === 429) throw new Error("rate-limited (429)");
    if (!res.ok) throw new Error(`stats.nba.com ${res.status} ${res.statusText}`);
    return (await res.json()) as StatsResponse;
  } catch (err) {
    if (attempt >= 5) throw err;
    const wait = 1500 * Math.pow(2, attempt - 1);
    console.warn(`    retry ${attempt} after ${wait}ms (${(err as Error).message})`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchJson(url, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

function gameLogUrl(season: string, seasonType: string): string {
  const u = new URL("https://stats.nba.com/stats/playergamelog");
  u.searchParams.set("PlayerID", String(LEBRON_ID));
  u.searchParams.set("Season", season);
  u.searchParams.set("SeasonType", seasonType);
  u.searchParams.set("LeagueID", "00");
  return u.toString();
}

function boxscoreUrl(gameId: string): string {
  // boxscoretraditionalv2 needs the 10-digit padded ID.
  const padded = gameId.padStart(10, "0");
  const u = new URL("https://stats.nba.com/stats/boxscoretraditionalv2");
  u.searchParams.set("GameID", padded);
  u.searchParams.set("StartPeriod", "0");
  u.searchParams.set("EndPeriod", "10");
  u.searchParams.set("StartRange", "0");
  u.searchParams.set("EndRange", "55800");
  u.searchParams.set("RangeType", "0");
  return u.toString();
}

type GameStub = { gameId: string; gameDate: string; season: string; gameType: string };

function parseNbaDate(s: string): string {
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) throw new Error(`bad NBA date: ${s}`);
  return `${m[3]}-${months[m[1].toUpperCase()]}-${m[2].padStart(2, "0")}`;
}

async function discoverGames(): Promise<GameStub[]> {
  const out: GameStub[] = [];
  const seen = new Set<string>();
  for (const sy of SEASONS) {
    const season = seasonLabel(sy);
    for (const st of SEASON_TYPES) {
      try {
        const json = await fetchJson(gameLogUrl(season, st.api));
        const set = json.resultSets.find((s) => s.name === "PlayerGameLog");
        if (!set || set.rowSet.length === 0) continue;
        const idx = Object.fromEntries(set.headers.map((h, i) => [h, i]));
        for (const row of set.rowSet) {
          const gameId = String(row[idx.Game_ID]).replace(/^0+/, "");
          if (seen.has(gameId)) continue;
          seen.add(gameId);
          out.push({
            gameId,
            gameDate: parseNbaDate(String(row[idx.GAME_DATE])),
            season,
            gameType: st.label,
          });
        }
        console.log(`  ${season} ${st.label}: ${set.rowSet.length} games`);
      } catch (err) {
        console.warn(`  ${season} ${st.label}: skipped (${(err as Error).message})`);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  out.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  return out;
}

type BoxscoreRow = {
  playerId: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  teamAbbr: string;
  minutes: number | null;
  points: number;
  assists: number;
};

type Boxscore = {
  rows: BoxscoreRow[];
  // home team abbr (from LineScore) so we can derive opponent + home flag.
  homeAbbr: string;
  awayAbbr: string;
  // win flag per team abbr
  winnerAbbr: string | null;
};

// Parse "MM:SS" or just "M" or "" → fractional minutes, null if blank.
function parseMinutes(raw: string | number | null): number | null {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  const m = s.match(/^(\d+):(\d+)$/);
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: null, last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function fetchBoxscore(gameId: string): Promise<Boxscore> {
  const json = await fetchJson(boxscoreUrl(gameId));
  const players = json.resultSets.find((s) => s.name === "PlayerStats");
  const lineScore = json.resultSets.find((s) => s.name === "TeamStats" || s.name === "LineScore");
  if (!players) throw new Error(`no PlayerStats for ${gameId}`);
  const idx = Object.fromEntries(players.headers.map((h, i) => [h, i]));

  const rows: BoxscoreRow[] = [];
  const teamHomeFromBox = new Map<string, number>(); // not exposed by PlayerStats, fall back below
  for (const row of players.rowSet) {
    const playerId = Number(row[idx.PLAYER_ID]);
    if (!Number.isFinite(playerId)) continue;
    const fullName = String(row[idx.PLAYER_NAME] ?? "").trim();
    const { first, last } = splitName(fullName);
    rows.push({
      playerId,
      fullName: fullName || `Player ${playerId}`,
      firstName: first,
      lastName: last,
      teamAbbr: String(row[idx.TEAM_ABBREVIATION] ?? ""),
      minutes: parseMinutes(row[idx.MIN]),
      points: Number(row[idx.PTS]) || 0,
      assists: Number(row[idx.AST]) || 0,
    });
  }

  // Home/winner from TeamStats (boxscoretraditionalv2 returns it as "TeamStats").
  let homeAbbr = "";
  let awayAbbr = "";
  let winnerAbbr: string | null = null;
  if (lineScore && lineScore.rowSet.length === 2) {
    const li = Object.fromEntries(lineScore.headers.map((h, i) => [h, i]));
    const teamRows = lineScore.rowSet.map((r) => ({
      abbr: String(r[li.TEAM_ABBREVIATION]),
      pts: Number(r[li.PTS]) || 0,
    }));
    // boxscoretraditionalv2's TeamStats is ordered [away, home] historically.
    awayAbbr = teamRows[0].abbr;
    homeAbbr = teamRows[1].abbr;
    if (teamRows[0].pts !== teamRows[1].pts) {
      winnerAbbr = teamRows[0].pts > teamRows[1].pts ? teamRows[0].abbr : teamRows[1].abbr;
    }
  }

  return { rows, homeAbbr, awayAbbr, winnerAbbr };
}

type Checkpoint = { completedGameIds: string[]; updatedAt: string };

function loadCheckpoint(): Set<string> {
  if (!fs.existsSync(CHECKPOINT)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")) as Checkpoint;
    return new Set(data.completedGameIds);
  } catch {
    return new Set();
  }
}

function saveCheckpoint(done: Set<string>) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const payload: Checkpoint = {
    completedGameIds: [...done],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CHECKPOINT, JSON.stringify(payload));
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");
  const onlyDiscover = args.includes("--discover-only");

  const db = openDb();

  // Seed teams from our local registry — stats.nba.com uses the same abbrs.
  const insertTeam = db.prepare(
    `INSERT OR IGNORE INTO teams (abbr, city, name, full_name, primary_color, secondary_color)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const teamTx = db.transaction(() => {
    for (const t of TEAMS) {
      insertTeam.run(t.abbr, t.city, t.name, t.fullName, t.primary, t.secondary);
    }
  });
  teamTx();
  const teamIdByAbbr = new Map(
    (db.prepare(`SELECT id, abbr FROM teams`).all() as { id: number; abbr: string }[]).map((t) => [t.abbr, t.id]),
  );

  // 1) Discover all LeBron games.
  console.log("phase 1: discovering LeBron games via playergamelog...");
  const games = await discoverGames();
  console.log(`  discovered ${games.length} unique games\n`);

  if (reset) {
    console.log("--reset: wiping appearances + games + checkpoint");
    db.exec("DELETE FROM appearances; DELETE FROM games;");
    if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
  }

  // Insert game shells (date/season/game_type). Upsert game_type so any seed-CSV
  // mislabels (e.g. Cup group games tagged "NBA Emirates Cup") get rewritten to
  // what the API says they are.
  const upsertGame = db.prepare(
    `INSERT INTO games (id, game_date, season, game_type) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       game_date = excluded.game_date,
       season    = excluded.season,
       game_type = excluded.game_type`,
  );
  db.transaction(() => {
    for (const g of games) upsertGame.run(g.gameId, g.gameDate, g.season, g.gameType);
  })();

  if (onlyDiscover) {
    console.log("--discover-only: stopping after game discovery.");
    db.close();
    return;
  }

  // 2) Fetch each game's boxscore.
  console.log("phase 2: fetching boxscores...");
  const done = loadCheckpoint();
  console.log(`  ${done.size}/${games.length} already done from checkpoint\n`);

  const insertPlayer = db.prepare(
    `INSERT OR IGNORE INTO players (id, full_name, first_name, last_name) VALUES (?, ?, ?, ?)`,
  );
  const upsertAppearance = db.prepare(
    `INSERT INTO appearances (game_id, player_id, team_id, opponent_team_id, is_home, win, minutes, points, assists)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id, player_id) DO UPDATE SET
       team_id          = excluded.team_id,
       opponent_team_id = excluded.opponent_team_id,
       is_home          = excluded.is_home,
       win              = excluded.win,
       minutes          = excluded.minutes,
       points           = excluded.points,
       assists          = excluded.assists`,
  );

  let completed = 0;
  let failed = 0;
  for (const g of games) {
    if (done.has(g.gameId)) continue;
    completed++;
    if (completed % 25 === 0 || completed === 1) {
      const remaining = games.length - done.size;
      console.log(`  [${done.size}/${games.length}] ${g.gameDate} ${g.gameId} (${g.gameType})`);
      if (remaining > 0) {
        const etaMin = Math.round((remaining * 1.1) / 60);
        if (etaMin > 0 && completed === 1) console.log(`  est. ${etaMin} min remaining`);
      }
    }

    let box: Boxscore;
    try {
      box = await fetchBoxscore(g.gameId);
    } catch (err) {
      console.warn(`    ! ${g.gameId} failed: ${(err as Error).message}`);
      failed++;
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    db.transaction(() => {
      for (const r of box.rows) {
        if (!r.teamAbbr) continue;
        const teamId = teamIdByAbbr.get(r.teamAbbr);
        if (!teamId) continue;
        const oppAbbr = r.teamAbbr === box.homeAbbr ? box.awayAbbr : box.homeAbbr;
        const oppId = teamIdByAbbr.get(oppAbbr) ?? null;
        const isHome = box.homeAbbr ? (r.teamAbbr === box.homeAbbr ? 1 : 0) : null;
        const win = box.winnerAbbr ? (r.teamAbbr === box.winnerAbbr ? 1 : 0) : null;
        insertPlayer.run(r.playerId, r.fullName, r.firstName, r.lastName);
        upsertAppearance.run(g.gameId, r.playerId, teamId, oppId, isHome, win, r.minutes, r.points, r.assists);
      }
    })();

    done.add(g.gameId);
    if (done.size % 20 === 0) saveCheckpoint(done);

    // ~1 req/s to be polite.
    await new Promise((r) => setTimeout(r, 1000));
  }
  saveCheckpoint(done);

  // Stash LeBron's id in meta so the API routes can look him up.
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('lebron_id', ?)`).run(String(LEBRON_ID));

  // Verify against canonical totals.
  const careerRsAst = db
    .prepare(
      `SELECT COALESCE(SUM(a.assists),0) AS n
       FROM appearances a JOIN games g ON g.id=a.game_id
       WHERE a.player_id=? AND a.minutes>0 AND g.game_type='Regular Season'`,
    )
    .get(LEBRON_ID) as { n: number };

  console.log(`\ndone. ${done.size}/${games.length} games processed, ${failed} failed`);
  console.log(`LeBron career RS assists: ${careerRsAst.n}`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
