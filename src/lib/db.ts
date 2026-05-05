import path from "node:path";
import fs from "node:fs";
import Database, { type Database as DB } from "better-sqlite3";

const DB_PATH = path.join(process.cwd(), "data", "nba.db");

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  abbr        TEXT UNIQUE NOT NULL,
  city        TEXT NOT NULL,
  name        TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  primary_color   TEXT,
  secondary_color TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  full_name   TEXT NOT NULL,
  first_name  TEXT,
  last_name   TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  game_date   TEXT NOT NULL,
  season      TEXT,
  game_type   TEXT
);

CREATE TABLE IF NOT EXISTS appearances (
  game_id          TEXT NOT NULL REFERENCES games(id),
  player_id        INTEGER NOT NULL REFERENCES players(id),
  team_id          INTEGER NOT NULL REFERENCES teams(id),
  opponent_team_id INTEGER REFERENCES teams(id),
  is_home          INTEGER,
  win              INTEGER,
  minutes          REAL,
  points           INTEGER,
  assists          INTEGER,
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_app_player ON appearances(player_id);
CREATE INDEX IF NOT EXISTS idx_app_game   ON appearances(game_id);
CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);

CREATE TABLE IF NOT EXISTS shots (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id          INTEGER NOT NULL REFERENCES players(id),
  game_id            TEXT REFERENCES games(id),
  game_date          TEXT,
  season             TEXT,
  period             INTEGER,
  minutes_remaining  INTEGER,
  seconds_remaining  INTEGER,
  event_type         TEXT,
  action_type        TEXT,
  shot_type          TEXT,
  shot_zone_basic    TEXT,
  shot_distance      INTEGER,
  loc_x              INTEGER,
  loc_y              INTEGER,
  opponent_team_id   INTEGER REFERENCES teams(id)
);
CREATE INDEX IF NOT EXISTS idx_shots_player ON shots(player_id);
CREATE INDEX IF NOT EXISTS idx_shots_game   ON shots(game_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(SCHEMA);
  _db = db;
  return db;
}

export function openDb(targetPath: string = DB_PATH, opts: { create?: boolean } = {}): DB {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const db = new Database(targetPath);
  if (opts.create !== false) db.exec(SCHEMA);
  return db;
}

export const DB_FILE = DB_PATH;
