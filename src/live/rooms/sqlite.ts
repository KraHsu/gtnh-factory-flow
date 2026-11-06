import { createRequire } from "node:module";

type Value = string | number | null;
export interface Statement {
  get(...values: Value[]): Record<string, unknown> | undefined;
  all(...values: Value[]): Array<Record<string, unknown>>;
  run(...values: Value[]): { changes: number | bigint };
}
export interface RoomDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

/** The room process requires Node 24; the rest of the app still supports Node 20. */
export function openRoomDatabase(filename: string): RoomDatabase {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (filename: string) => RoomDatabase;
  };
  return new DatabaseSync(filename);
}
