import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two stories on the playoffs page:
//   1. Every NBA Finals (1947–2025) and which ones LeBron played in.
//   2. LeBron's career playoff wins compared to every active franchise's
//      all-time playoff wins.
//
// LeBron's playoff wins come from the DB. Finals history and franchise wins
// are static — full league history isn't in our seed.

export type FinalsEntry = {
  year: number;          // ending year of the season (e.g. 2016 = 2015-16)
  champion: string;      // full team name
  championAbbr: string;  // matches teams.ts abbr
  runnerUp: string;
  runnerUpAbbr: string;
  result: string;        // e.g. "4-3"
  // LeBron-specific (derived). Only present for the 10 Finals he played in.
  lebron?: {
    team: "champion" | "runnerUp";
    teamAbbr: string;    // his team's abbr that season
  };
};

export type FranchiseWins = {
  abbr: string;
  fullName: string;
  playoffWins: number;
};

export type PlayoffsPayload = {
  // Career playoff wins for LeBron — DB-derived. minutes>0 to drop DNPs.
  lebronPlayoffWins: number;
  lebronPlayoffLosses: number;
  lebronFinalsCount: number;     // computed from finals[] where lebron is set
  lebronFinalsWins: number;      // championships
  totalFinalsInHistory: number;  // finals.length
  finalsParticipationPct: number; // lebronFinalsCount / totalFinalsInHistory * 100

  finals: FinalsEntry[];
  franchiseWins: FranchiseWins[];

  source: "sqlite-derived + static";
  generatedAt: string;
};

// Every NBA Finals, 1947 (BAA) → 2025. LeBron's 10 Finals are flagged inline.
// `championAbbr` and `runnerUpAbbr` use modern franchise codes from teams.ts
// where applicable — older defunct franchises (PSW, MNL, ROC, SYR, FTW, STL)
// keep their historical abbreviations and aren't expected to match teams.ts.
const FINALS: FinalsEntry[] = [
  { year: 1947, champion: "Philadelphia Warriors",   championAbbr: "PSW", runnerUp: "Chicago Stags",          runnerUpAbbr: "CHS", result: "4-1" },
  { year: 1948, champion: "Baltimore Bullets",       championAbbr: "BLB", runnerUp: "Philadelphia Warriors",  runnerUpAbbr: "PSW", result: "4-2" },
  { year: 1949, champion: "Minneapolis Lakers",      championAbbr: "MNL", runnerUp: "Washington Capitols",    runnerUpAbbr: "WAC", result: "4-2" },
  { year: 1950, champion: "Minneapolis Lakers",      championAbbr: "MNL", runnerUp: "Syracuse Nationals",     runnerUpAbbr: "SYR", result: "4-2" },
  { year: 1951, champion: "Rochester Royals",        championAbbr: "ROC", runnerUp: "New York Knicks",        runnerUpAbbr: "NYK", result: "4-3" },
  { year: 1952, champion: "Minneapolis Lakers",      championAbbr: "MNL", runnerUp: "New York Knicks",        runnerUpAbbr: "NYK", result: "4-3" },
  { year: 1953, champion: "Minneapolis Lakers",      championAbbr: "MNL", runnerUp: "New York Knicks",        runnerUpAbbr: "NYK", result: "4-1" },
  { year: 1954, champion: "Minneapolis Lakers",      championAbbr: "MNL", runnerUp: "Syracuse Nationals",     runnerUpAbbr: "SYR", result: "4-3" },
  { year: 1955, champion: "Syracuse Nationals",      championAbbr: "SYR", runnerUp: "Fort Wayne Pistons",     runnerUpAbbr: "FTW", result: "4-3" },
  { year: 1956, champion: "Philadelphia Warriors",   championAbbr: "PSW", runnerUp: "Fort Wayne Pistons",     runnerUpAbbr: "FTW", result: "4-1" },
  { year: 1957, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "St. Louis Hawks",        runnerUpAbbr: "STL", result: "4-3" },
  { year: 1958, champion: "St. Louis Hawks",         championAbbr: "STL", runnerUp: "Boston Celtics",         runnerUpAbbr: "BOS", result: "4-2" },
  { year: 1959, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Minneapolis Lakers",     runnerUpAbbr: "MNL", result: "4-0" },
  { year: 1960, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "St. Louis Hawks",        runnerUpAbbr: "STL", result: "4-3" },
  { year: 1961, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "St. Louis Hawks",        runnerUpAbbr: "STL", result: "4-1" },
  { year: 1962, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-3" },
  { year: 1963, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-2" },
  { year: 1964, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "San Francisco Warriors", runnerUpAbbr: "GSW", result: "4-1" },
  { year: 1965, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-1" },
  { year: 1966, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-3" },
  { year: 1967, champion: "Philadelphia 76ers",      championAbbr: "PHI", runnerUp: "San Francisco Warriors", runnerUpAbbr: "GSW", result: "4-2" },
  { year: 1968, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-2" },
  { year: 1969, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-3" },
  { year: 1970, champion: "New York Knicks",         championAbbr: "NYK", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-3" },
  { year: 1971, champion: "Milwaukee Bucks",         championAbbr: "MIL", runnerUp: "Baltimore Bullets",      runnerUpAbbr: "WAS", result: "4-0" },
  { year: 1972, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "New York Knicks",        runnerUpAbbr: "NYK", result: "4-1" },
  { year: 1973, champion: "New York Knicks",         championAbbr: "NYK", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-1" },
  { year: 1974, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Milwaukee Bucks",        runnerUpAbbr: "MIL", result: "4-3" },
  { year: 1975, champion: "Golden State Warriors",   championAbbr: "GSW", runnerUp: "Washington Bullets",     runnerUpAbbr: "WAS", result: "4-0" },
  { year: 1976, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Phoenix Suns",           runnerUpAbbr: "PHX", result: "4-2" },
  { year: 1977, champion: "Portland Trail Blazers",  championAbbr: "POR", runnerUp: "Philadelphia 76ers",     runnerUpAbbr: "PHI", result: "4-2" },
  { year: 1978, champion: "Washington Bullets",      championAbbr: "WAS", runnerUp: "Seattle SuperSonics",    runnerUpAbbr: "OKC", result: "4-3" },
  { year: 1979, champion: "Seattle SuperSonics",     championAbbr: "OKC", runnerUp: "Washington Bullets",     runnerUpAbbr: "WAS", result: "4-1" },
  { year: 1980, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Philadelphia 76ers",     runnerUpAbbr: "PHI", result: "4-2" },
  { year: 1981, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Houston Rockets",        runnerUpAbbr: "HOU", result: "4-2" },
  { year: 1982, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Philadelphia 76ers",     runnerUpAbbr: "PHI", result: "4-2" },
  { year: 1983, champion: "Philadelphia 76ers",      championAbbr: "PHI", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-0" },
  { year: 1984, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-3" },
  { year: 1985, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Boston Celtics",         runnerUpAbbr: "BOS", result: "4-2" },
  { year: 1986, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Houston Rockets",        runnerUpAbbr: "HOU", result: "4-2" },
  { year: 1987, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Boston Celtics",         runnerUpAbbr: "BOS", result: "4-2" },
  { year: 1988, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Detroit Pistons",        runnerUpAbbr: "DET", result: "4-3" },
  { year: 1989, champion: "Detroit Pistons",         championAbbr: "DET", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-0" },
  { year: 1990, champion: "Detroit Pistons",         championAbbr: "DET", runnerUp: "Portland Trail Blazers", runnerUpAbbr: "POR", result: "4-1" },
  { year: 1991, champion: "Chicago Bulls",           championAbbr: "CHI", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-1" },
  { year: 1992, champion: "Chicago Bulls",           championAbbr: "CHI", runnerUp: "Portland Trail Blazers", runnerUpAbbr: "POR", result: "4-2" },
  { year: 1993, champion: "Chicago Bulls",           championAbbr: "CHI", runnerUp: "Phoenix Suns",           runnerUpAbbr: "PHX", result: "4-2" },
  { year: 1994, champion: "Houston Rockets",         championAbbr: "HOU", runnerUp: "New York Knicks",        runnerUpAbbr: "NYK", result: "4-3" },
  { year: 1995, champion: "Houston Rockets",         championAbbr: "HOU", runnerUp: "Orlando Magic",          runnerUpAbbr: "ORL", result: "4-0" },
  { year: 1996, champion: "Chicago Bulls",           championAbbr: "CHI", runnerUp: "Seattle SuperSonics",    runnerUpAbbr: "OKC", result: "4-2" },
  { year: 1997, champion: "Chicago Bulls",           championAbbr: "CHI", runnerUp: "Utah Jazz",              runnerUpAbbr: "UTA", result: "4-2" },
  { year: 1998, champion: "Chicago Bulls",           championAbbr: "CHI", runnerUp: "Utah Jazz",              runnerUpAbbr: "UTA", result: "4-2" },
  { year: 1999, champion: "San Antonio Spurs",       championAbbr: "SAS", runnerUp: "New York Knicks",        runnerUpAbbr: "NYK", result: "4-1" },
  { year: 2000, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Indiana Pacers",         runnerUpAbbr: "IND", result: "4-2" },
  { year: 2001, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Philadelphia 76ers",     runnerUpAbbr: "PHI", result: "4-1" },
  { year: 2002, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "New Jersey Nets",        runnerUpAbbr: "BKN", result: "4-0" },
  { year: 2003, champion: "San Antonio Spurs",       championAbbr: "SAS", runnerUp: "New Jersey Nets",        runnerUpAbbr: "BKN", result: "4-2" },
  { year: 2004, champion: "Detroit Pistons",         championAbbr: "DET", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-1" },
  { year: 2005, champion: "San Antonio Spurs",       championAbbr: "SAS", runnerUp: "Detroit Pistons",        runnerUpAbbr: "DET", result: "4-3" },
  { year: 2006, champion: "Miami Heat",              championAbbr: "MIA", runnerUp: "Dallas Mavericks",       runnerUpAbbr: "DAL", result: "4-2" },
  { year: 2007, champion: "San Antonio Spurs",       championAbbr: "SAS", runnerUp: "Cleveland Cavaliers",    runnerUpAbbr: "CLE", result: "4-0",
    lebron: { team: "runnerUp", teamAbbr: "CLE" } },
  { year: 2008, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Los Angeles Lakers",     runnerUpAbbr: "LAL", result: "4-2" },
  { year: 2009, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Orlando Magic",          runnerUpAbbr: "ORL", result: "4-1" },
  { year: 2010, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Boston Celtics",         runnerUpAbbr: "BOS", result: "4-3" },
  { year: 2011, champion: "Dallas Mavericks",        championAbbr: "DAL", runnerUp: "Miami Heat",             runnerUpAbbr: "MIA", result: "4-2",
    lebron: { team: "runnerUp", teamAbbr: "MIA" } },
  { year: 2012, champion: "Miami Heat",              championAbbr: "MIA", runnerUp: "Oklahoma City Thunder",  runnerUpAbbr: "OKC", result: "4-1",
    lebron: { team: "champion", teamAbbr: "MIA" } },
  { year: 2013, champion: "Miami Heat",              championAbbr: "MIA", runnerUp: "San Antonio Spurs",      runnerUpAbbr: "SAS", result: "4-3",
    lebron: { team: "champion", teamAbbr: "MIA" } },
  { year: 2014, champion: "San Antonio Spurs",       championAbbr: "SAS", runnerUp: "Miami Heat",             runnerUpAbbr: "MIA", result: "4-1",
    lebron: { team: "runnerUp", teamAbbr: "MIA" } },
  { year: 2015, champion: "Golden State Warriors",   championAbbr: "GSW", runnerUp: "Cleveland Cavaliers",    runnerUpAbbr: "CLE", result: "4-2",
    lebron: { team: "runnerUp", teamAbbr: "CLE" } },
  { year: 2016, champion: "Cleveland Cavaliers",     championAbbr: "CLE", runnerUp: "Golden State Warriors",  runnerUpAbbr: "GSW", result: "4-3",
    lebron: { team: "champion", teamAbbr: "CLE" } },
  { year: 2017, champion: "Golden State Warriors",   championAbbr: "GSW", runnerUp: "Cleveland Cavaliers",    runnerUpAbbr: "CLE", result: "4-1",
    lebron: { team: "runnerUp", teamAbbr: "CLE" } },
  { year: 2018, champion: "Golden State Warriors",   championAbbr: "GSW", runnerUp: "Cleveland Cavaliers",    runnerUpAbbr: "CLE", result: "4-0",
    lebron: { team: "runnerUp", teamAbbr: "CLE" } },
  { year: 2019, champion: "Toronto Raptors",         championAbbr: "TOR", runnerUp: "Golden State Warriors",  runnerUpAbbr: "GSW", result: "4-2" },
  { year: 2020, champion: "Los Angeles Lakers",      championAbbr: "LAL", runnerUp: "Miami Heat",             runnerUpAbbr: "MIA", result: "4-2",
    lebron: { team: "champion", teamAbbr: "LAL" } },
  { year: 2021, champion: "Milwaukee Bucks",         championAbbr: "MIL", runnerUp: "Phoenix Suns",           runnerUpAbbr: "PHX", result: "4-2" },
  { year: 2022, champion: "Golden State Warriors",   championAbbr: "GSW", runnerUp: "Boston Celtics",         runnerUpAbbr: "BOS", result: "4-2" },
  { year: 2023, champion: "Denver Nuggets",          championAbbr: "DEN", runnerUp: "Miami Heat",             runnerUpAbbr: "MIA", result: "4-1" },
  { year: 2024, champion: "Boston Celtics",          championAbbr: "BOS", runnerUp: "Dallas Mavericks",       runnerUpAbbr: "DAL", result: "4-1" },
  { year: 2025, champion: "Oklahoma City Thunder",   championAbbr: "OKC", runnerUp: "Indiana Pacers",         runnerUpAbbr: "IND", result: "4-3" },
];

// All-time playoff wins per active franchise. Source: Basketball-Reference
// franchise pages, through the 2025 playoffs. Includes pre-relocation/rename
// history (e.g. Lakers includes Minneapolis era). The 21 franchises LeBron has
// surpassed are the bottom 21 — anyone with fewer than his career playoff wins.
const FRANCHISE_WINS: FranchiseWins[] = [
  { abbr: "LAL", fullName: "Los Angeles Lakers",      playoffWins: 467 },
  { abbr: "BOS", fullName: "Boston Celtics",          playoffWins: 397 },
  { abbr: "GSW", fullName: "Golden State Warriors",   playoffWins: 245 },
  { abbr: "SAS", fullName: "San Antonio Spurs",       playoffWins: 234 },
  { abbr: "PHI", fullName: "Philadelphia 76ers",      playoffWins: 226 },
  { abbr: "CHI", fullName: "Chicago Bulls",           playoffWins: 195 },
  { abbr: "MIA", fullName: "Miami Heat",              playoffWins: 175 },
  { abbr: "DET", fullName: "Detroit Pistons",         playoffWins: 168 },
  { abbr: "OKC", fullName: "Oklahoma City Thunder",   playoffWins: 153 }, // incl. Sonics
  { abbr: "PHX", fullName: "Phoenix Suns",            playoffWins: 144 },
  { abbr: "HOU", fullName: "Houston Rockets",         playoffWins: 144 },
  { abbr: "NYK", fullName: "New York Knicks",         playoffWins: 137 },
  { abbr: "DAL", fullName: "Dallas Mavericks",        playoffWins: 122 },
  { abbr: "POR", fullName: "Portland Trail Blazers",  playoffWins: 119 },
  { abbr: "MIL", fullName: "Milwaukee Bucks",         playoffWins: 117 },
  { abbr: "UTA", fullName: "Utah Jazz",               playoffWins: 110 },
  { abbr: "CLE", fullName: "Cleveland Cavaliers",     playoffWins: 107 },
  { abbr: "IND", fullName: "Indiana Pacers",          playoffWins: 100 },
  { abbr: "DEN", fullName: "Denver Nuggets",          playoffWins: 88 },
  { abbr: "WAS", fullName: "Washington Wizards",      playoffWins: 84 },
  { abbr: "ATL", fullName: "Atlanta Hawks",           playoffWins: 82 },
  { abbr: "BKN", fullName: "Brooklyn Nets",           playoffWins: 71 },
  { abbr: "ORL", fullName: "Orlando Magic",           playoffWins: 56 },
  { abbr: "TOR", fullName: "Toronto Raptors",         playoffWins: 56 },
  { abbr: "SAC", fullName: "Sacramento Kings",        playoffWins: 51 },
  { abbr: "MEM", fullName: "Memphis Grizzlies",       playoffWins: 24 },
  { abbr: "NOP", fullName: "New Orleans Pelicans",    playoffWins: 21 },
  { abbr: "LAC", fullName: "LA Clippers",             playoffWins: 36 },
  { abbr: "MIN", fullName: "Minnesota Timberwolves",  playoffWins: 33 },
  { abbr: "CHA", fullName: "Charlotte Hornets",       playoffWins: 14 },
];

export async function GET() {
  try {
    const db = getDb();
    const meta = db.prepare(`SELECT value FROM meta WHERE key='lebron_id'`).get() as { value: string } | undefined;
    if (!meta) {
      return NextResponse.json(
        { error: "DB_NOT_SEEDED", message: "Run `npm run seed` first." },
        { status: 503 },
      );
    }
    const lebronId = Number(meta.value);

    const wlRow = db
      .prepare<[number], { wins: number; losses: number }>(
        `SELECT
           SUM(CASE WHEN a.win=1 AND a.minutes>0 THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN a.win=0 AND a.minutes>0 THEN 1 ELSE 0 END) AS losses
         FROM appearances a JOIN games g ON g.id=a.game_id
         WHERE a.player_id=? AND g.game_type='Playoffs'`,
      )
      .get(lebronId);

    const lebronPlayoffWins = wlRow?.wins ?? 0;
    const lebronPlayoffLosses = wlRow?.losses ?? 0;

    const lebronFinalsCount = FINALS.filter((f) => f.lebron).length;
    const lebronFinalsWins = FINALS.filter((f) => f.lebron?.team === "champion").length;

    const payload: PlayoffsPayload = {
      lebronPlayoffWins,
      lebronPlayoffLosses,
      lebronFinalsCount,
      lebronFinalsWins,
      totalFinalsInHistory: FINALS.length,
      finalsParticipationPct: (lebronFinalsCount / FINALS.length) * 100,
      finals: FINALS,
      franchiseWins: FRANCHISE_WINS,
      source: "sqlite-derived + static",
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: "DB_ERROR", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
