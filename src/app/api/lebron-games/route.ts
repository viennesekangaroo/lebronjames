import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GameRow = {
  game_id: string;
  game_date: string;
  season: string;
  game_type: string;
  team_abbr: string | null;
  opp_abbr: string | null;
  minutes: number | null;
  points: number | null;
  win: number | null;
  is_home: number | null;
};

export type GameCell = {
  gameId: string;
  date: string;
  minutes: number;
  points: number;
  played: boolean;
  win: 0 | 1 | null;
  oppAbbr: string | null;
  isHome: 0 | 1 | null;
};
export type SeasonRow = {
  season: string;
  teamAbbr: string;
  regular: GameCell[];
  playoffs: GameCell[];
  regularMinutes: number;
  playoffsMinutes: number;
};
export type GamesPayload = {
  seasons: SeasonRow[];
  maxRegularGames: number;
  maxPlayoffGames: number;
  maxMinutes: number;
};

export async function GET() {
  try {
    const db = getDb();
    const meta = db.prepare(`SELECT value FROM meta WHERE key='lebron_id'`).get() as { value: string } | undefined;
    if (!meta) {
      return NextResponse.json(
        { error: "DB_NOT_SEEDED", message: "Database not seeded yet. Run `npm run seed`." },
        { status: 503 },
      );
    }

    // Pull LeBron's regular-season + playoff games, joined to team abbrs.
    // Sorted chronologically — same order they were played.
    const rows = db
      .prepare<[number], GameRow>(
        `SELECT g.id            AS game_id,
                g.game_date     AS game_date,
                g.season        AS season,
                g.game_type     AS game_type,
                t.abbr          AS team_abbr,
                ot.abbr         AS opp_abbr,
                a.minutes       AS minutes,
                a.points        AS points,
                a.win           AS win,
                a.is_home       AS is_home
         FROM appearances a
         JOIN games g       ON g.id = a.game_id
         LEFT JOIN teams t  ON t.id = a.team_id
         LEFT JOIN teams ot ON ot.id = a.opponent_team_id
         WHERE a.player_id = ?
           AND g.game_type IN ('Regular Season', 'Playoffs')
         ORDER BY g.season, g.game_type DESC, g.game_date`,
      )
      .all(Number(meta.value));

    // Group into seasons. Regular season comes first (DESC order puts 'Regular
    // Season' before 'Playoffs' — alphabetically), then playoffs.
    const bySeason = new Map<string, SeasonRow>();
    const teamCounts = new Map<string, Map<string, number>>(); // season -> abbr -> games

    for (const r of rows) {
      let row = bySeason.get(r.season);
      if (!row) {
        row = {
          season: r.season,
          teamAbbr: "?",
          regular: [],
          playoffs: [],
          regularMinutes: 0,
          playoffsMinutes: 0,
        };
        bySeason.set(r.season, row);
      }
      const minutes = r.minutes ?? 0;
      const cell: GameCell = {
        gameId: r.game_id,
        date: r.game_date,
        minutes,
        points: r.points ?? 0,
        played: minutes > 0,
        win: r.win as 0 | 1 | null,
        oppAbbr: r.opp_abbr,
        isHome: r.is_home as 0 | 1 | null,
      };
      if (r.game_type === "Regular Season") {
        row.regular.push(cell);
        row.regularMinutes += minutes;
      } else {
        row.playoffs.push(cell);
        row.playoffsMinutes += minutes;
      }

      // Track team for this season — pick the most-frequent (LeBron has never
      // been mid-season traded, but DNP rows still record his team).
      if (r.team_abbr) {
        let counts = teamCounts.get(r.season);
        if (!counts) {
          counts = new Map();
          teamCounts.set(r.season, counts);
        }
        counts.set(r.team_abbr, (counts.get(r.team_abbr) ?? 0) + 1);
      }
    }
    for (const [season, counts] of teamCounts) {
      let bestAbbr = "?";
      let bestCount = -1;
      for (const [abbr, c] of counts) {
        if (c > bestCount) { bestAbbr = abbr; bestCount = c; }
      }
      const row = bySeason.get(season);
      if (row) row.teamAbbr = bestAbbr;
    }

    const seasons = Array.from(bySeason.values()).sort((a, b) => a.season.localeCompare(b.season));

    let maxReg = 0;
    let maxPo = 0;
    let maxMin = 0;
    for (const s of seasons) {
      if (s.regular.length > maxReg) maxReg = s.regular.length;
      if (s.playoffs.length > maxPo) maxPo = s.playoffs.length;
      for (const c of s.regular) if (c.minutes > maxMin) maxMin = c.minutes;
      for (const c of s.playoffs) if (c.minutes > maxMin) maxMin = c.minutes;
    }

    const payload: GamesPayload = {
      seasons,
      maxRegularGames: maxReg,
      maxPlayoffGames: maxPo,
      maxMinutes: maxMin,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: "DB_ERROR", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
