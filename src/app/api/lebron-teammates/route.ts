import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeammateRow = {
  player_id: number;
  full_name: string;
  team_id: number;
  team_abbr: string;
  team_full_name: string;
  games_together: number;
  teammate_points: number;
  first_together: string;
  last_together: string;
};

export async function GET() {
  try {
    const db = getDb();
    const meta = db.prepare(`SELECT value FROM meta WHERE key = 'lebron_id'`).get() as { value: string } | undefined;
    if (!meta) {
      return NextResponse.json(
        { error: "DB_NOT_SEEDED", message: "Database not seeded yet. Run `npm run seed`." },
        { status: 503 },
      );
    }
    const lebronId = Number(meta.value);

    // Find teammates: players on the SAME team as LeBron who scored points in the same games.
    const rows = db
      .prepare<[number, number], TeammateRow>(
        `WITH lebron_games AS (
           SELECT game_id, team_id AS lebron_team_id
           FROM appearances
           WHERE player_id = ? AND minutes > 0
         )
         SELECT a.player_id,
                p.full_name,
                a.team_id,
                t.abbr                                         AS team_abbr,
                t.full_name                                    AS team_full_name,
                COUNT(*)                                       AS games_together,
                SUM(COALESCE(a.points, 0))                     AS teammate_points,
                MIN(g.game_date)                               AS first_together,
                MAX(g.game_date)                               AS last_together
         FROM appearances a
         JOIN games   g  ON g.id = a.game_id
         JOIN players p  ON p.id = a.player_id
         JOIN teams   t  ON t.id = a.team_id
         JOIN lebron_games lg ON lg.game_id = a.game_id
         WHERE a.team_id = lg.lebron_team_id
           AND a.minutes > 0
           AND a.player_id != ?
         GROUP BY a.player_id, a.team_id
         HAVING games_together > 0
         ORDER BY teammate_points DESC`,
      )
      .all(lebronId, lebronId);

    // Collapse multi-team rows per player.
    type Agg = {
      playerId: number;
      name: string;
      games: number;
      points: number;
      first: string;
      last: string;
      teams: { teamId: number; abbr: string; fullName: string; games: number; points: number }[];
    };
    const byPlayer = new Map<number, Agg>();
    for (const r of rows) {
      const a = byPlayer.get(r.player_id) ?? {
        playerId: r.player_id,
        name: r.full_name,
        games: 0,
        points: 0,
        first: r.first_together,
        last: r.last_together,
        teams: [],
      };
      a.games += r.games_together;
      a.points += r.teammate_points;
      if (r.first_together < a.first) a.first = r.first_together;
      if (r.last_together > a.last) a.last = r.last_together;
      a.teams.push({
        teamId: r.team_id,
        abbr: r.team_abbr,
        fullName: r.team_full_name,
        games: r.games_together,
        points: r.teammate_points,
      });
      byPlayer.set(r.player_id, a);
    }
    const teammates = Array.from(byPlayer.values());

    // Per-teammate assists from LeBron, ingested from regular-season PBP.
    // Empty if `npm run ingest:assists` hasn't been run yet.
    const hasAssistsTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='lebron_assists_to'`)
      .get() as { name: string } | undefined;
    const assistsByPlayer = new Map<number, number>();
    if (hasAssistsTable) {
      const rows = db
        .prepare(`SELECT scorer_player_id, assists FROM lebron_assists_to`)
        .all() as { scorer_player_id: number; assists: number }[];
      for (const r of rows) assistsByPlayer.set(r.scorer_player_id, r.assists);
    }

    const nodes = [
      { id: "lebron", kind: "self" as const, name: "LeBron James", radius: 36 },
      ...teammates.map((t) => ({
        id: `p:${t.playerId}`,
        kind: "player" as const,
        playerId: t.playerId,
        name: t.name,
        radius: 1.6 + Math.pow(t.points / 100, 0.55) * 1.5,
        games: t.games,
        points: t.points,
        assistsFromLebron: assistsByPlayer.get(t.playerId) ?? 0,
        firstTogether: t.first,
        lastTogether: t.last,
        teams: t.teams.sort((a, b) => b.points - a.points),
      })),
    ];

    const links = teammates.map((t) => ({
      source: "lebron",
      target: `p:${t.playerId}`,
      points: t.points,
    }));

    const lebronGames = db
      .prepare(`SELECT COUNT(*) AS n FROM appearances WHERE player_id = ? AND minutes > 0`)
      .get(lebronId) as { n: number };

    // Career assists = regular-season only, matching the canonical career stat.
    const lebronAssists = db
      .prepare(
        `SELECT COALESCE(SUM(a.assists), 0) AS n
         FROM appearances a
         JOIN games g ON g.id = a.game_id
         WHERE a.player_id = ? AND a.minutes > 0
           AND g.game_type = 'Regular Season'`,
      )
      .get(lebronId) as { n: number };

    return NextResponse.json({
      nodes,
      links,
      stats: {
        lebronGames: lebronGames.n,
        teammateCount: teammates.length,
        totalPointsFed: teammates.reduce((s, t) => s + t.points, 0),
        lebronAssists: lebronAssists.n,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/lebron-teammates]", err);
    return NextResponse.json({ error: "DB_ERROR", message }, { status: 500 });
  }
}
