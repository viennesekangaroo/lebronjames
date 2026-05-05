/**
 * Pulls every LeBron shot (regular season + playoffs) from the NBA stats
 * shotchartdetail endpoint and writes a single CSV at data/raw/lebron-shots.csv.
 *
 * Public endpoint, no auth — but stats.nba.com requires browser-like headers
 * and a small delay between requests or it returns 403/timeouts.
 *
 *   npm run fetch-shots
 */

import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LEBRON_PLAYER_ID = 2544;
// LeBron debuted 2003-04. We pull through whatever the current season is.
const FIRST_SEASON_START = 2003;
const CURRENT_SEASON_START = (() => {
  const now = new Date();
  // NBA season "2025-26" starts in October 2025. If month >= October, the
  // current season is this year-yearPlus1; otherwise prevYear-thisYear.
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
})();

const SEASON_TYPES = ["Regular Season", "Playoffs"] as const;

const BASE = "https://stats.nba.com/stats/shotchartdetail";

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Host: "stats.nba.com",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

function seasonString(start: number): string {
  const end = String(start + 1).slice(2);
  return `${start}-${end}`;
}

function buildUrl(season: string, seasonType: string): string {
  const params = new URLSearchParams({
    PlayerID: String(LEBRON_PLAYER_ID),
    Season: season,
    SeasonType: seasonType,
    LeagueID: "00",
    TeamID: "0",
    GameID: "",
    Outcome: "",
    Location: "",
    Month: "0",
    SeasonSegment: "",
    DateFrom: "",
    DateTo: "",
    OpponentTeamID: "0",
    VsConference: "",
    VsDivision: "",
    Position: "",
    RookieYear: "",
    GameSegment: "",
    Period: "0",
    LastNGames: "0",
    ContextMeasure: "FGA",
    PlayerPosition: "",
  });
  return `${BASE}?${params.toString()}`;
}

type Row = (string | number | null)[];
type ResultSet = { name: string; headers: string[]; rowSet: Row[] };
type Response = { resultSets: ResultSet[] };

async function fetchSeason(season: string, seasonType: string): Promise<{ headers: string[]; rows: Row[] } | null> {
  const url = buildUrl(season, seasonType);
  // Single retry with backoff — the endpoint blips occasionally.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        if (attempt === 2) {
          console.warn(`[${season} ${seasonType}] HTTP ${res.status} after retries — skipping`);
          return null;
        }
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const body = (await res.json()) as Response;
      const set = body.resultSets.find((s) => s.name === "Shot_Chart_Detail");
      if (!set) {
        console.warn(`[${season} ${seasonType}] no Shot_Chart_Detail set`);
        return null;
      }
      return { headers: set.headers, rows: set.rowSet };
    } catch (err) {
      if (attempt === 2) {
        console.warn(`[${season} ${seasonType}] fetch failed: ${(err as Error).message}`);
        return null;
      }
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const outPath = resolve(process.cwd(), "data/raw/lebron-shots.csv");
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  const out = createWriteStream(outPath);

  const seasons: string[] = [];
  for (let y = FIRST_SEASON_START; y <= CURRENT_SEASON_START; y++) {
    seasons.push(seasonString(y));
  }

  let wroteHeader = false;
  let totalRows = 0;
  for (const season of seasons) {
    for (const type of SEASON_TYPES) {
      process.stdout.write(`fetching ${season} · ${type} … `);
      const res = await fetchSeason(season, type);
      if (!res) {
        process.stdout.write("0\n");
        await sleep(900);
        continue;
      }
      if (!wroteHeader) {
        // Add SEASON_TYPE so downstream can split reg-season vs playoffs.
        out.write(["SEASON_TYPE", ...res.headers].map(csvEscape).join(",") + "\n");
        wroteHeader = true;
      }
      for (const row of res.rows) {
        out.write([type, ...row].map(csvEscape).join(",") + "\n");
      }
      totalRows += res.rows.length;
      process.stdout.write(`${res.rows.length}\n`);
      // Be polite — stats.nba.com rate-limits anything aggressive.
      await sleep(900);
    }
  }
  await new Promise<void>((resolveClose, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolveClose())));
  console.log(`\nwrote ${totalRows.toLocaleString()} shots → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
