import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface CharacterRow {
  id: number;
  accountId: number;
  name: string;
  classId: number;
  x: number;
  y: number;
  hp: number;
  level: number;
  xp: number;
}

export interface AccountRepository {
  createAccount(username: string, passwordHash: string): { id: number; username: string };
  findAccountByUsername(username: string): { id: number; username: string; passwordHash: string } | null;
  createSession(accountId: number, tokenHash: string, expiresAt: number): void;
  revokeSession(tokenHash: string): void;
  getSession(tokenHash: string): { accountId: number; username: string } | null;
  listCharacters(accountId: number): CharacterRow[];
  findCharacter(id: number): CharacterRow | null;
  createCharacter(input: Omit<CharacterRow, 'id'>): CharacterRow;
  saveCharacter(row: Pick<CharacterRow, 'id' | 'x' | 'y' | 'hp' | 'level' | 'xp'>): void;
}

interface AccountRec {
  id: number;
  username: string;
  password_hash: string;
}
interface SessionRec {
  account_id: number;
  username: string;
}
interface CharRec {
  id: number;
  account_id: number;
  name: string;
  class_id: number;
  x: number;
  y: number;
  hp: number;
  level: number;
  xp: number;
}

function mapChar(r: CharRec): CharacterRow {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    classId: r.class_id,
    x: r.x,
    y: r.y,
    hp: r.hp,
    level: r.level,
    xp: r.xp,
  };
}

export class SqliteAccountRepository implements AccountRepository {
  private db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        class_id INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        hp INTEGER NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        region_id TEXT NOT NULL DEFAULT 'overworld',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);
    `);
  }

  createAccount(username: string, passwordHash: string): { id: number; username: string } {
    const info = this.db
      .prepare('INSERT INTO accounts (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, Date.now());
    return { id: Number(info.lastInsertRowid), username };
  }

  findAccountByUsername(username: string): { id: number; username: string; passwordHash: string } | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash FROM accounts WHERE username = ?')
      .get(username) as AccountRec | undefined;
    if (!row) return null;
    return { id: row.id, username: row.username, passwordHash: row.password_hash };
  }

  createSession(accountId: number, tokenHash: string, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, accountId, Date.now(), expiresAt);
  }

  revokeSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  getSession(tokenHash: string): { accountId: number; username: string } | null {
    const row = this.db
      .prepare(
        `SELECT s.account_id, a.username FROM sessions s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, Date.now()) as SessionRec | undefined;
    if (!row) return null;
    return { accountId: row.account_id, username: row.username };
  }

  listCharacters(accountId: number): CharacterRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, account_id, name, class_id, x, y, hp, level, xp FROM characters WHERE account_id = ? ORDER BY id',
      )
      .all(accountId) as unknown as CharRec[];
    return rows.map(mapChar);
  }

  findCharacter(id: number): CharacterRow | null {
    const row = this.db
      .prepare('SELECT id, account_id, name, class_id, x, y, hp, level, xp FROM characters WHERE id = ?')
      .get(id) as CharRec | undefined;
    return row ? mapChar(row) : null;
  }

  createCharacter(input: Omit<CharacterRow, 'id'>): CharacterRow {
    const info = this.db
      .prepare(
        `INSERT INTO characters (account_id, name, class_id, x, y, hp, level, xp, region_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'overworld', ?)`,
      )
      .run(input.accountId, input.name, input.classId, input.x, input.y, input.hp, input.level, input.xp, Date.now());
    return { ...input, id: Number(info.lastInsertRowid) };
  }

  saveCharacter(row: Pick<CharacterRow, 'id' | 'x' | 'y' | 'hp' | 'level' | 'xp'>): void {
    this.db
      .prepare('UPDATE characters SET x = ?, y = ?, hp = ?, level = ?, xp = ?, updated_at = ? WHERE id = ?')
      .run(row.x, row.y, row.hp, row.level, row.xp, Date.now(), row.id);
  }
}
