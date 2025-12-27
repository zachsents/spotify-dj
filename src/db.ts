import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_DIR = join(homedir(), ".config")
const DB_PATH = join(CONFIG_DIR, "spotify-dj.sqlite")

/** Ensures the config directory exists and returns a connected database. */
function getDatabase(): Database {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  const db = new Database(DB_PATH)
  db.exec("PRAGMA journal_mode = WAL;")
  return db
}

const db = getDatabase()

/** Initialize database schema. Call once at startup. */
export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      track_name TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      album_name TEXT,
      commentary TEXT NOT NULL,
      announced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_announcements_track_id ON announcements(track_id);
    CREATE INDEX IF NOT EXISTS idx_announcements_announced_at ON announcements(announced_at);
  `)
}

/** Get a state value by key. */
export function getState(key: string): string | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM state WHERE key = ?")
    .get(key)
  return row?.value ?? null
}

/** Set a state value by key. */
export function setState(key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)", [
    key,
    value,
  ])
}

/** Check if the DJ is currently enabled. */
export function isDjEnabled(): boolean {
  return getState("dj_enabled") === "1"
}

/** Enable or disable the DJ. */
export function setDjEnabled(enabled: boolean): void {
  setState("dj_enabled", enabled ? "1" : "0")
}

/** Get the last announced track ID. */
export function getLastTrackId(): string | null {
  return getState("last_track_id")
}

/** Set the last announced track ID. */
export function setLastTrackId(trackId: string): void {
  setState("last_track_id", trackId)
}

export interface Announcement {
  id: number
  trackId: string
  trackName: string
  artistName: string
  albumName: string | null
  commentary: string
  announcedAt: string
}

/** Record a new announcement in history. */
export function recordAnnouncement(data: {
  trackId: string
  trackName: string
  artistName: string
  albumName?: string
  commentary: string
}): void {
  db.run(
    `INSERT INTO announcements (track_id, track_name, artist_name, album_name, commentary)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.trackId,
      data.trackName,
      data.artistName,
      data.albumName ?? null,
      data.commentary,
    ],
  )
}

/** Get recent announcements for context (most recent first). */
export function getRecentAnnouncements(limit = 10): Announcement[] {
  const rows = db
    .query<
      {
        id: number
        track_id: string
        track_name: string
        artist_name: string
        album_name: string | null
        commentary: string
        announced_at: string
      },
      [number]
    >(
      `SELECT id, track_id, track_name, artist_name, album_name, commentary, announced_at
     FROM announcements
     ORDER BY announced_at DESC
     LIMIT ?`,
    )
    .all(limit)

  return rows.map((row) => ({
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    artistName: row.artist_name,
    albumName: row.album_name,
    commentary: row.commentary,
    announcedAt: row.announced_at,
  }))
}

/** Check if a track has been announced recently (within hours). */
export function wasRecentlyAnnounced(trackId: string, hours = 2): boolean {
  const row = db
    .query<{ count: number }, [string, number]>(
      `SELECT COUNT(*) as count FROM announcements 
     WHERE track_id = ? 
     AND datetime(announced_at) > datetime('now', '-' || ? || ' hours')`,
    )
    .get(trackId, hours)
  return (row?.count ?? 0) > 0
}

/** Clean up old announcements (keep last N days). */
export function cleanOldAnnouncements(days = 30): void {
  db.run(
    `DELETE FROM announcements 
     WHERE datetime(announced_at) < datetime('now', '-' || ? || ' days')`,
    [days],
  )
}
