import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bad_cases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      problem TEXT NOT NULL DEFAULT '',
      expected_outcome TEXT NOT NULL DEFAULT '',
      delivery_ref TEXT,
      capture_source TEXT NOT NULL DEFAULT 'manual',
      user_feedback TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      source_session_id TEXT,
      source_path TEXT,
      task_summary TEXT NOT NULL DEFAULT '',
      skill_names TEXT NOT NULL DEFAULT '[]',
      signal_types TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      attribution TEXT,
      attribution_note TEXT NOT NULL DEFAULT '',
      evidence_path TEXT,
      confirmed_at TEXT,
      attributed_at TEXT,
      rejected_at TEXT,
      assetized_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const columns = new Set(
    (database.prepare("PRAGMA table_info(bad_cases)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const migrations: Array<[string, string]> = [
    ["confirmed_at", "TEXT"],
    ["attributed_at", "TEXT"],
    ["rejected_at", "TEXT"],
    ["assetized_at", "TEXT"],
    ["delivery_ref", "TEXT"],
    ["capture_source", "TEXT NOT NULL DEFAULT 'manual'"],
    ["user_feedback", "TEXT NOT NULL DEFAULT ''"],
    ["failure_reason", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [column, definition] of migrations) {
    if (!columns.has(column)) database.exec(`ALTER TABLE bad_cases ADD COLUMN ${column} ${definition}`);
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS bad_cases_delivery_ref_unique
      ON bad_cases(delivery_ref)
      WHERE delivery_ref IS NOT NULL;

    CREATE TABLE IF NOT EXISTS capture_events (
      id TEXT PRIMARY KEY,
      delivery_ref TEXT NOT NULL,
      capture_source TEXT NOT NULL,
      status TEXT NOT NULL,
      user_feedback TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      association_error TEXT,
      bad_case_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS capture_events_delivery_ref_index
      ON capture_events(delivery_ref, created_at DESC);
  `);
  return database;
}
