/**
 * Seeds data/nba.db from a Kaggle CSV of player-game box scores.
 *
 * Recommended source: "NBA, ABA, BAA Stats" — file `PlayerStatistics.csv`.
 *   Drop the file at: data/raw/PlayerStatistics.csv
 *   Run:               npm run seed
 *
 * The script auto-detects column names (case-insensitive). Expected columns
 * (any reasonable variant works):
 *   personId | playerId
 *   firstName, lastName  (or playerName / fullName)
 *   gameId
 *   gameDate
 *   gameType (optional)
 *   playerteamCity, playerteamName  (or playerTeam / teamName)
 *   opponentteamCity, opponentteamName (or opponentTeam)
 *   home (0/1), win (0/1)
 *   numMinutes (or minutes / mp)
 *   points (or pts)
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { openDb } from "../src/lib/db";
import { TEAMS, findTeamByCityAndName, findTeam, LEBRON_NAME } from "../src/lib/teams";

const RAW_DIR = path.join(process.cwd(), "data", "raw");
const DB_PATH = path.join(process.cwd(), "data", "nba.db");

const CSV_CANDIDATES = [
  "PlayerStatistics.csv",
  "player_statistics.csv",
  "playerstatistics.csv",
];

function findCsv(): string {
  for (const name of CSV_CANDIDATES) {
    const p = path.join(RAW_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  // fall back to any csv in data/raw
  const all = fs.existsSync(RAW_DIR) ? fs.readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith(".csv")) : [];
  if (all.length === 1) return path.join(RAW_DIR, all[0]);
  throw new Error(
    `Could not find a CSV at data/raw/. Looked for: ${CSV_CANDIDATES.join(", ")}.\n` +
      `Found: ${all.length === 0 ? "(nothing)" : all.join(", ")}.\n` +
      `Download "NBA, ABA, BAA Stats" → PlayerStatistics.csv from Kaggle and place it at data/raw/.`,
  );
}

type ColMap = {
  personId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  gameId: string;
  gameDate: string;
  gameType?: string;
  teamCity?: string;
  teamName?: string;
  team?: string;
  oppCity?: string;
  oppName?: string;
  opp?: string;
  home?: string;
  win?: string;
  minutes?: string;
  points?: string;
  assists?: string;
};

const NAME_VARIANTS: Record<keyof ColMap, string[]> = {
  personId: ["personId", "playerId", "player_id", "person_id"],
  firstName: ["firstName", "first_name"],
  lastName: ["lastName", "last_name"],
  fullName: ["playerName", "fullName", "name"],
  gameId: ["gameId", "game_id"],
  gameDate: ["gameDate", "game_date", "date"],
  gameType: ["gameType", "game_type"],
  teamCity: ["playerteamCity", "playerTeamCity", "teamCity"],
  teamName: ["playerteamName", "playerTeamName", "teamName"],
  team: ["playerTeam", "team"],
  oppCity: ["opponentteamCity", "opponentTeamCity"],
  oppName: ["opponentteamName", "opponentTeamName", "opponentTeam"],
  opp: ["opponent"],
  home: ["home", "isHome"],
  win: ["win", "result"],
  minutes: ["numMinutes", "minutes", "mp", "minutesPlayed"],
  points: ["points", "pts"],
  assists: ["assists", "ast"],
};

function pickColumn(headers: string[], variants: string[]): string | undefined {
  const lower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  for (const v of variants) {
    const hit = lower.get(v.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function detectColumns(headers: string[]): ColMap {
  const map = {} as ColMap;
  (Object.keys(NAME_VARIANTS) as Array<keyof ColMap>).forEach((key) => {
    const col = pickColumn(headers, NAME_VARIANTS[key]);
    if (col) (map as Record<string, string>)[key] = col;
  });
  if (!map.personId || !map.gameId || !map.gameDate) {
    throw new Error(
      `Required columns missing. Detected headers:\n  ${headers.join(", ")}\n` +
        `Need at least personId/playerId, gameId, gameDate.`,
    );
  }
  return map;
}

function safeNum(x: unknown): number | null {
  if (x === undefined || x === null || x === "") return null;
  const n = typeof x === "number" ? x : Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}

function safeInt(x: unknown): number | null {
  const n = safeNum(x);
  return n === null ? null : Math.round(n);
}

function teamFromRow(row: Record<string, unknown>, cols: ColMap, side: "team" | "opp"): ReturnType<typeof findTeam> {
  if (side === "team") {
    if (cols.teamCity && cols.teamName) {
      const t = findTeamByCityAndName(row[cols.teamCity] as string, row[cols.teamName] as string);
      if (t) return t;
    }
    if (cols.team) return findTeam(row[cols.team] as string);
  } else {
    if (cols.oppCity && cols.oppName) {
      const t = findTeamByCityAndName(row[cols.oppCity] as string, row[cols.oppName] as string);
      if (t) return t;
    }
    if (cols.opp) return findTeam(row[cols.opp] as string);
  }
  return undefined;
}

async function streamCsv(filePath: string, onHeaders: (headers: string[]) => void, onRow: (row: Record<string, unknown>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    let headersDone = false;
    Papa.parse<Record<string, unknown>>(stream as unknown as NodeJS.ReadableStream, {
      header: true,
      skipEmptyLines: true,
      step: (result, parser) => {
        if (!headersDone && result.meta?.fields) {
          headersDone = true;
          try {
            onHeaders(result.meta.fields as string[]);
          } catch (err) {
            parser.abort();
            reject(err);
            return;
          }
        }
        try {
          onRow(result.data);
        } catch (err) {
          parser.abort();
          reject(err);
        }
      },
      complete: () => resolve(),
      error: (err) => reject(err),
    });
  });
}

async function main() {
  const csv = findCsv();
  console.log(`[seed] reading ${csv}`);

  if (fs.existsSync(DB_PATH)) {
    console.log(`[seed] removing existing ${DB_PATH}`);
    fs.unlinkSync(DB_PATH);
  }
  const db = openDb(DB_PATH);

  // Seed teams (idempotent).
  const insertTeam = db.prepare(
    `INSERT OR IGNORE INTO teams (abbr, city, name, full_name, primary_color, secondary_color) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const teamIdByAbbr = new Map<string, number>();
  db.transaction(() => {
    for (const t of TEAMS) {
      insertTeam.run(t.abbr, t.city, t.name, t.fullName, t.primary, t.secondary);
    }
    const rows = db.prepare(`SELECT id, abbr FROM teams`).all() as { id: number; abbr: string }[];
    for (const r of rows) teamIdByAbbr.set(r.abbr, r.id);
  })();

  const insertPlayer = db.prepare(
    `INSERT OR IGNORE INTO players (id, full_name, first_name, last_name) VALUES (?, ?, ?, ?)`,
  );
  const insertGame = db.prepare(
    `INSERT OR IGNORE INTO games (id, game_date, season, game_type) VALUES (?, ?, ?, ?)`,
  );
  const insertAppearance = db.prepare(
    `INSERT OR REPLACE INTO appearances (game_id, player_id, team_id, opponent_team_id, is_home, win, minutes, points, assists)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let cols: ColMap | null = null;
  let processed = 0;
  let inserted = 0;
  let skippedNoTeam = 0;
  let lebronId: number | null = null;
  let lebronName: string | null = null;

  // Buffer rows and flush in transactions for speed.
  const BUF_SIZE = 5000;
  type Buffered = {
    player: [number, string, string | null, string | null];
    game: [string, string, string | null, string | null];
    appearance: [string, number, number, number | null, number | null, number | null, number | null, number | null, number | null];
  };
  let buf: Buffered[] = [];

  function seasonFromDate(d: string): string | null {
    const m = d.match(/(\d{4})-(\d{2})/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    // NBA season starts in October. Oct–Dec = year/year+1. Jan–Sep = year-1/year.
    return month >= 9 ? `${year}-${String((year + 1) % 100).padStart(2, "0")}` : `${year - 1}-${String(year % 100).padStart(2, "0")}`;
  }

  function flush() {
    if (!buf.length) return;
    db.transaction((rows: Buffered[]) => {
      for (const r of rows) {
        insertPlayer.run(...r.player);
        insertGame.run(...r.game);
        insertAppearance.run(...r.appearance);
      }
    })(buf);
    inserted += buf.length;
    buf = [];
  }

  await streamCsv(
    csv,
    (headers) => {
      cols = detectColumns(headers);
      console.log(`[seed] detected columns:`, cols);
    },
    (row) => {
      if (!cols) return;
      processed++;

      const personId = safeInt(row[cols.personId]);
      const gameId = row[cols.gameId];
      const gameDate = row[cols.gameDate];
      if (personId === null || !gameId || !gameDate) return;

      const team = teamFromRow(row, cols, "team");
      const opp = teamFromRow(row, cols, "opp");
      if (!team) {
        skippedNoTeam++;
        return; // unknown franchise — historical / dev-league / international team
      }
      const teamId = teamIdByAbbr.get(team.abbr)!;
      const oppId = opp ? teamIdByAbbr.get(opp.abbr) ?? null : null;

      const firstName = cols.firstName ? (row[cols.firstName] as string | null) : null;
      const lastName = cols.lastName ? (row[cols.lastName] as string | null) : null;
      const fullName = cols.fullName
        ? (row[cols.fullName] as string)
        : `${firstName ?? ""} ${lastName ?? ""}`.trim();

      if (lebronId === null && firstName?.trim() === LEBRON_NAME.firstName && lastName?.trim() === LEBRON_NAME.lastName) {
        lebronId = personId;
        lebronName = fullName;
        console.log(`[seed] found LeBron James — personId=${personId}`);
      }

      const date = String(gameDate).slice(0, 10);
      const season = seasonFromDate(date);
      const gameType = cols.gameType ? (row[cols.gameType] as string | null) : null;

      const home = cols.home ? safeInt(row[cols.home]) : null;
      const win = cols.win ? safeInt(row[cols.win]) : null;
      const minutes = cols.minutes ? safeNum(row[cols.minutes]) : null;
      const points = cols.points ? safeInt(row[cols.points]) : null;
      const assists = cols.assists ? safeInt(row[cols.assists]) : null;

      buf.push({
        player: [personId, fullName || `Player ${personId}`, firstName ?? null, lastName ?? null],
        game: [String(gameId), date, season, gameType],
        appearance: [String(gameId), personId, teamId, oppId, home, win, minutes, points, assists],
      });

      if (buf.length >= BUF_SIZE) flush();
      if (processed % 50000 === 0) {
        console.log(`[seed] ${processed.toLocaleString()} rows read, ${inserted.toLocaleString()} inserted`);
      }
    },
  );

  flush();

  console.log(`[seed] done. ${processed.toLocaleString()} rows read, ${inserted.toLocaleString()} appearances inserted, ${skippedNoTeam.toLocaleString()} skipped (unknown team).`);

  if (lebronId === null) {
    console.warn(`[seed] WARNING: did not encounter LeBron James in CSV. Graph will be empty until you find a CSV that includes him.`);
  } else {
    const opponentCount = db
      .prepare(
        `SELECT COUNT(DISTINCT a2.player_id) AS n
         FROM appearances a1
         JOIN appearances a2 ON a1.game_id = a2.game_id AND a2.team_id != a1.team_id
         WHERE a1.player_id = ?`,
      )
      .get(lebronId) as { n: number };
    console.log(`[seed] LeBron (${lebronName}) faced ${opponentCount.n} distinct players across his games.`);
  }

  // Persist a tiny meta table for the app.
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  if (lebronId !== null) {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run("lebron_id", String(lebronId));
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
