import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { LivePlan } from "@/lib/live/ops";
import { docKey } from "@/lib/live/protocol";
import {
  ROOM_SESSION_MS,
  type RoomAdmission,
  type RoomIdentity,
  type RoomInfo,
} from "@/lib/rooms/types";
import type { PlanStore, LeaseOutcome } from "../store";
import { openRoomDatabase } from "./sqlite";

const derive = promisify(scrypt);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class RoomError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function roomNickname(value: unknown): string {
  if (typeof value !== "string") throw new RoomError(400, "Enter a nickname of 1–24 characters.");
  const name = value.normalize("NFKC").trim();
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name))
    throw new RoomError(400, "Enter a nickname of 1–24 characters.");
  return name;
}

export class RoomStore {
  readonly db;
  private passwordWork = 0;

  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = openRoomDatabase(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS room_owners (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY, design_id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES room_owners(id),
        name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        plan TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS room_guests (
        id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms(code), nickname TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS room_guests_code ON room_guests(code, expires_at);
      CREATE INDEX IF NOT EXISTS rooms_owner ON rooms(owner_id, closed);
    `);
  }

  close(): void {
    this.db.close();
  }

  private owner(identity: RoomIdentity): string {
    this.db
      .prepare(
        `INSERT INTO room_owners(id,username,name) VALUES(?,?,?)
      ON CONFLICT(username) DO UPDATE SET name=excluded.name`,
      )
      .run(randomUUID(), identity.username, identity.name);
    return this.db.prepare("SELECT id FROM room_owners WHERE username=?").get(identity.username)!
      .id as string;
  }

  private row(code: string) {
    return this.db
      .prepare(
        `SELECT r.*, o.name AS owner_name FROM rooms r
      JOIN room_owners o ON o.id=r.owner_id WHERE r.code=? AND r.closed=0`,
      )
      .get(code);
  }

  private info(row: Record<string, unknown>): RoomInfo {
    return {
      code: row.code as string,
      name: row.name as string,
      ownerId: row.owner_id as string,
      ownerName: row.owner_name as string,
      designId: row.design_id as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  list(identity: RoomIdentity): RoomInfo[] {
    return this.db
      .prepare(
        `SELECT r.*,o.name AS owner_name FROM rooms r
      JOIN room_owners o ON o.id=r.owner_id WHERE o.username=? AND r.closed=0
      ORDER BY r.updated_at DESC LIMIT 100`,
      )
      .all(identity.username)
      .map((row) => this.info(row));
  }

  private async key(password: string, salt: string): Promise<Buffer> {
    if (this.passwordWork >= 4)
      throw new RoomError(429, "The room service is busy. Try again shortly.");
    this.passwordWork++;
    try {
      return (await derive(password, salt, 64)) as Buffer;
    } finally {
      this.passwordWork--;
    }
  }

  async create(
    identity: RoomIdentity,
    name: string,
    password: string,
    nickname: string,
    plan: LivePlan,
  ): Promise<RoomAdmission> {
    if (this.list(identity).length >= 100)
      throw new RoomError(429, "You have reached the room limit.");
    if (typeof password !== "string" || password.length < 8 || password.length > 128)
      throw new RoomError(400, "Use a room password of 8–128 characters.");
    const salt = randomBytes(16).toString("hex");
    const hash = (await this.key(password, salt)).toString("hex");
    let code: string;
    do {
      code = String(randomInt(10_000_000, 100_000_000));
    } while (this.db.prepare("SELECT code FROM rooms WHERE code=?").get(code));
    const ownerId = this.owner(identity);
    const stamp = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO rooms(code,design_id,owner_id,name,password_hash,password_salt,plan,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(code, randomUUID(), ownerId, name, hash, salt, JSON.stringify(plan), stamp, stamp);
    return this.admit(this.row(code)!, nickname);
  }

  async join(code: string, password: string, nickname: string): Promise<RoomAdmission> {
    const row = this.row(code);
    // An unknown room performs the same password work and returns the same answer.
    const key = await this.key(password, (row?.password_salt as string) ?? "unavailable-room-salt");
    const expected = row ? Buffer.from(row.password_hash as string, "hex") : Buffer.alloc(64);
    if (!timingSafeEqual(key, expected) || !row)
      throw new RoomError(403, "Room number or password is incorrect.");
    if (
      (this.db
        .prepare("SELECT count(*) AS n FROM room_guests WHERE code=? AND expires_at>?")
        .get(code, Date.now())!.n as number) >= 100
    )
      throw new RoomError(429, "This room has reached its participant limit.");
    return this.admit(row, nickname);
  }

  private admit(row: Record<string, unknown>, nickname: string): RoomAdmission {
    this.db.prepare("DELETE FROM room_guests WHERE expires_at<=?").run(Date.now());
    const token = randomBytes(32).toString("base64url");
    const user = { id: randomUUID(), username: roomNickname(nickname) };
    const expiresAt = Date.now() + ROOM_SESSION_MS;
    this.db
      .prepare("INSERT INTO room_guests(id,code,nickname,token_hash,expires_at) VALUES(?,?,?,?,?)")
      .run(user.id, row.code as string, user.username, digest(token), expiresAt);
    return { room: this.info(row), token, user, expiresAt, plan: JSON.parse(row.plan as string) };
  }

  resume(token: string): RoomAdmission {
    const guest = this.guest(token);
    const row = guest && this.row(guest.code as string);
    if (!guest || !row)
      throw new RoomError(401, "Your room session expired. Join again with your nickname.");
    return {
      room: this.info(row),
      token,
      user: { id: guest.id as string, username: guest.nickname as string },
      expiresAt: guest.expires_at as number,
      plan: JSON.parse(row.plan as string),
    };
  }

  guest(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return this.db
      .prepare(
        `SELECT g.* FROM room_guests g JOIN rooms r ON r.code=g.code
      WHERE g.token_hash=? AND g.expires_at>? AND r.closed=0`,
      )
      .get(digest(token), Date.now());
  }

  leave(token: string): string | undefined {
    const guest = this.guest(token);
    if (!guest) return undefined;
    this.db.prepare("DELETE FROM room_guests WHERE id=?").run(guest.id as string);
    const row = this.row(guest.code as string)!;
    return docKey(row.owner_id as string, row.design_id as string);
  }

  closeRoom(identity: RoomIdentity, code: string): string {
    const row = this.db
      .prepare(
        `SELECT r.* FROM rooms r JOIN room_owners o ON o.id=r.owner_id
      WHERE r.code=? AND r.closed=0 AND o.username=?`,
      )
      .get(code, identity.username);
    if (!row) throw new RoomError(404, "Room not found.");
    this.db
      .prepare("UPDATE rooms SET closed=1,updated_at=? WHERE code=?")
      .run(new Date().toISOString(), code);
    return docKey(row.owner_id as string, row.design_id as string);
  }

  planStore(): PlanStore {
    const exists = (owner: string, design: string) =>
      this.db
        .prepare("SELECT lease_token FROM rooms WHERE owner_id=? AND design_id=? AND closed=0")
        .get(owner, design);
    const outcome = (changes: number | bigint, owner: string, design: string): LeaseOutcome =>
      Number(changes) ? "held" : exists(owner, design) ? "lost" : "gone";
    return {
      account: async (id) => {
        const owner = this.db
          .prepare("SELECT id,name AS username FROM room_owners WHERE id=?")
          .get(id);
        if (owner) return owner as { id: string; username: string };
        const guest = this.db
          .prepare("SELECT id,nickname AS username FROM room_guests WHERE id=? AND expires_at>?")
          .get(id, Date.now());
        return guest as { id: string; username: string } | undefined;
      },
      role: async (id, owner, design) => {
        const row = this.db
          .prepare(
            `SELECT g.id FROM room_guests g JOIN rooms r ON r.code=g.code
          WHERE g.id=? AND g.expires_at>? AND r.owner_id=? AND r.design_id=? AND r.closed=0`,
          )
          .get(id, Date.now(), owner, design);
        return row ? "editor" : null;
      },
      lease: async (owner, design, token, until) => {
        this.db
          .prepare(
            "UPDATE rooms SET lease_token=?,lease_until=? WHERE owner_id=? AND design_id=? AND closed=0",
          )
          .run(token, until.getTime(), owner, design);
        const row = this.db
          .prepare("SELECT plan,seq FROM rooms WHERE owner_id=? AND design_id=? AND closed=0")
          .get(owner, design);
        return row
          ? { plan: JSON.parse(row.plan as string) as LivePlan, seq: row.seq as number }
          : undefined;
      },
      renew: async (owner, design, token, until) =>
        outcome(
          this.db
            .prepare(
              `UPDATE rooms SET lease_until=?
        WHERE owner_id=? AND design_id=? AND lease_token=? AND closed=0`,
            )
            .run(until.getTime(), owner, design, token).changes,
          owner,
          design,
        ),
      flush: async (owner, design, token, plan, seq, until) =>
        outcome(
          this.db
            .prepare(
              `UPDATE rooms
        SET plan=?,seq=?,updated_at=?,lease_until=?,lease_token=? WHERE owner_id=? AND design_id=? AND lease_token=? AND closed=0`,
            )
            .run(
              JSON.stringify(plan),
              seq,
              new Date().toISOString(),
              until?.getTime() ?? null,
              until ? token : null,
              owner,
              design,
              token,
            ).changes,
          owner,
          design,
        ),
      release: async (owner, design, token) => {
        this.db
          .prepare(
            `UPDATE rooms SET lease_token=NULL,lease_until=NULL
        WHERE owner_id=? AND design_id=? AND lease_token=? AND closed=0`,
          )
          .run(owner, design, token);
      },
      members: async (owner, design) =>
        this.db
          .prepare(
            `SELECT g.id,g.nickname AS username FROM room_guests g
        JOIN rooms r ON r.code=g.code WHERE r.owner_id=? AND r.design_id=? AND r.closed=0 AND g.expires_at>?`,
          )
          .all(owner, design, Date.now()) as Array<{ id: string; username: string }>,
      usernames: async (ids) => {
        const names = new Map<string, string>();
        for (const id of ids) {
          const row = this.db
            .prepare(
              `SELECT name AS username FROM room_owners WHERE id=?
            UNION ALL SELECT nickname AS username FROM room_guests WHERE id=?`,
            )
            .get(id, id);
          if (row) names.set(id, row.username as string);
        }
        return names;
      },
    };
  }
}
