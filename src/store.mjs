import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const initial = () => ({
  users: {}, sessions: {}, objects: {}, devices: {}, pairs: {}, runs: {},
});

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL
      );
    `);
    this.select = this.database.prepare('SELECT data FROM workspace WHERE id = 1');
    this.save = this.database.prepare('INSERT INTO workspace VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
  }

  read() {
    const row = this.select.get();
    return row ? JSON.parse(row.data) : initial();
  }

  mutate(action) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = action(state);
      this.save.run(JSON.stringify(state));
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
