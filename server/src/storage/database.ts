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
  for (const column of ["confirmed_at", "attributed_at", "rejected_at", "assetized_at"]) {
    if (!columns.has(column)) database.exec(`ALTER TABLE bad_cases ADD COLUMN ${column} TEXT`);
  }
  return database;
}
