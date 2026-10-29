/**
 * Del (دل) Messenger — API server v0.1.0-alpha.1
 * REST + WebSocket, SQLite storage (portable alpha build).
 *
 * Production target (per docs/02-architecture.md) is NestJS + PostgreSQL;
 * this alpha build ships a single-file portable server for local testing.
 */
import express from "express";
import cors from "cors";
import http from "http";
import jwt from "jsonwebtoken";
import { Server as SocketServer, type Socket } from "socket.io";
import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "del-dev-secret-change-me";
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "del.db");
const VERSION = "0.1.0-alpha.1";

// ---------------------------------------------------------------- database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_a, user_b)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL REFERENCES conversations(id),
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  client_msg_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(conv_id, client_msg_id)
);
CREATE TABLE IF NOT EXISTS reads (
  conv_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_message_id TEXT NOT NULL,
  PRIMARY KEY (conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, created_at);
`);

// seed demo contacts so new users can start chatting immediately
const seedUsers: [string, string, number][] = [
  ["07901112233", "نریمان احمدی", 1],
  ["07902223344", "سارا کریمی", 2],
  ["07903334455", "الیاس صمد", 4],
  ["07900000000", "تیم پشتیبانی دل", 5],
];
const insUser = db.prepare(
  `INSERT OR IGNORE INTO users (id, phone, name, color) VALUES (?, ?, ?, ?)`
);
const nowMs = Date.now();
for (const [phone, name, color] of seedUsers) {
  insUser.run(crypto.randomUUID(), phone, name, color);
}
void nowMs;

// ---------------------------------------------------------------- helpers
type Row = Record<string, unknown>;
const uid = () => crypto.randomUUID();
const sign = (userId: string) =>
  jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });

function auth(req: express.Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  try {
    return (jwt.verify(h.slice(7), JWT_SECRET) as { sub: string }).sub;
  } catch {
    return null;
  }
}

function requireAuth(req: express.Request, res: express.Response): string | null {
  const userId = auth(req);
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return userId;
}

function publicUser(u: Row) {
  return { id: u.id, name: u.name, phone: u.phone, color: u.color };
}

function getOrCreateConv(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  const found = db
    .prepare(`SELECT id FROM conversations WHERE user_a=? AND user_b=?`)
    .get(x, y) as { id: string } | undefined;
  if (found) return found.id;
  const id = uid();
  db.prepare(`INSERT INTO conversations (id, user_a, user_b) VALUES (?,?,?)`).run(id, x, y);
  // welcome message from support for the first conversation of a new user
  return id;
}

function convRowsFor(userId: string) {
  const convs = db
    .prepare(
      `SELECT c.id, c.user_a, c.user_b,
        CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END AS peer_id
       FROM conversations c
       JOIN users mu ON mu.id=?
       WHERE c.user_a=? OR c.user_b=?`
    )
    .all(userId, userId, userId, userId) as (Row & { id: string; peer_id: string })[];
  return convs.map((c) => {
    const peer = db.prepare(`SELECT * FROM users WHERE id=?`).get(c.peer_id) as Row;
    const last = db
      .prepare(
        `SELECT id, sender_id, body, created_at FROM messages WHERE conv_id=? ORDER BY created_at DESC LIMIT 1`
      )
      .get(c.id) as Row | undefined;
    const unread = last
      ? db
          .prepare(
            `SELECT COUNT(*) AS n FROM messages
             WHERE conv_id=? AND sender_id!=?
               AND id > COALESCE((SELECT last_read_message_id FROM reads WHERE conv_id=? AND user_id=?), '')`
          )
          .get(c.id, userId, c.id, userId) as { n: number }
      : { n: 0 };
    return {
      id: c.id,
      peer: peer ? publicUser(peer) : { id: "", name: "کاربر حذف‌شده", phone: "", color: 0 },
      lastMessage: last
        ? { id: last.id, senderId: last.sender_id, body: last.body, createdAt: last.created_at }
        : null,
      unread: unread?.n ?? 0,
    };
  });
}

function msgRows(convId: string, meId: string, beforeId?: string, limit = 60) {
  const rows = beforeId
    ? db
        .prepare(
          `SELECT * FROM messages WHERE conv_id=? AND id < ? ORDER BY created_at DESC, id DESC LIMIT ?`
        )
        .all(convId, beforeId, limit)
    : db
        .prepare(`SELECT * FROM messages WHERE conv_id=? ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(convId, limit);
  return (rows as Row[]).reverse().map((m) => ({
    id: m.id as string,
    senderId: m.sender_id as string,
    body: m.body as string,
    createdAt: m.created_at as string,
    mine: m.sender_id === meId,
  }));
}

// ---------------------------------------------------------------- REST
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ name: "del-api", version: VERSION, ok: true });
});

// --- auth: OTP flow (dev build returns the code in the response)
app.post("/v1/auth/otp/request", (req, res) => {
  const phone = String(req.body?.phone ?? "").replace(/\D/g, "");
  if (phone.length < 7) return res.status(400).json({ error: "invalid_phone" });
  const code = "12345"; // fixed for alpha; production: random + SMS provider (docs/05)
  db.prepare(
    `INSERT INTO otps (phone, code, expires_at) VALUES (?,?,?)
     ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at`
  ).run(phone, code, Date.now() + 5 * 60_000);
  res.json({ ok: true, devCode: code });
});

app.post("/v1/auth/otp/verify", (req, res) => {
  const phone = String(req.body?.phone ?? "").replace(/\D/g, "");
  const code = String(req.body?.code ?? "");
  const row = db.prepare(`SELECT * FROM otps WHERE phone=?`).get(phone) as
    | { code: string; expires_at: number }
    | undefined;
  if (!row || row.code !== code || row.expires_at < Date.now()) {
    return res.status(401).json({ error: "invalid_code" });
  }
  let user = db.prepare(`SELECT * FROM users WHERE phone=?`).get(phone) as Row | undefined;
  if (!user) {
    const id = uid();
    db.prepare(`INSERT INTO users (id, phone, name, color) VALUES (?,?,?,?)`).run(
      id, phone, "", Math.floor(Math.random() * 6)
    );
    user = db.prepare(`SELECT * FROM users WHERE id=?`).get(id) as Row;
  }
  res.json({ token: sign(user.id as string), user: publicUser(user), isNew: !(user.name as string) });
});

// --- users
app.get("/v1/users/me", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(me) as Row | undefined;
  if (!u) return res.status(404).json({ error: "not_found" });
  res.json(publicUser(u));
});

app.patch("/v1/users/me", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 64) : undefined;
  const color = Number.isInteger(req.body?.color) ? req.body.color : undefined;
  if (name !== undefined)
    db.prepare(`UPDATE users SET name=? WHERE id=?`).run(name, me);
  if (color !== undefined)
    db.prepare(`UPDATE users SET color=? WHERE id=?`).run(color, me);
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(me) as Row;
  res.json(publicUser(u));
});

app.get("/v1/users", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const q = String(req.query.q ?? "").trim();
  const rows = q
    ? (db
        .prepare(`SELECT * FROM users WHERE id!=? AND (name LIKE ? OR phone LIKE ?) LIMIT 50`)
        .all(me, `%${q}%`, `%${q}%`) as Row[])
    : (db.prepare(`SELECT * FROM users WHERE id!=? LIMIT 50`).all(me) as Row[]);
  res.json(rows.map(publicUser));
});

// --- conversations
app.get("/v1/conversations", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  res.json(convRowsFor(me));
});

app.post("/v1/conversations", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const peerPhone = String(req.body?.peerPhone ?? "").replace(/\D/g, "");
  const peer = db.prepare(`SELECT * FROM users WHERE phone=?`).get(peerPhone) as Row | undefined;
  if (!peer) return res.status(404).json({ error: "peer_not_found" });
  if (peer.id === me) return res.status(400).json({ error: "self_chat" });
  const convId = getOrCreateConv(me, peer.id as string);
  res.json({ id: convId, peer: publicUser(peer) });
});

app.get("/v1/conversations/:id/messages", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const conv = db.prepare(`SELECT * FROM conversations WHERE id=?`).get(req.params.id) as
    | { user_a: string; user_b: string }
    | undefined;
  if (!conv || (conv.user_a !== me && conv.user_b !== me))
    return res.status(404).json({ error: "not_found" });
  const before = (req.query.cursor as string) || undefined;
  const limit = Math.min(Number(req.query.limit ?? 60), 100);
  res.json(msgRows(req.params.id, me, before, limit));
});

app.post("/v1/conversations/:id/messages", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const conv = db.prepare(`SELECT * FROM conversations WHERE id=?`).get(req.params.id) as
    | { user_a: string; user_b: string }
    | undefined;
  if (!conv || (conv.user_a !== me && conv.user_b !== me))
    return res.status(404).json({ error: "not_found" });
  const body = String(req.body?.body ?? "").trim();
  const clientMsgId = String(req.body?.clientMsgId ?? "");
  if (!body || !clientMsgId) return res.status(400).json({ error: "bad_request" });
  if (body.length > 4096) return res.status(413).json({ error: "too_long" });

  // idempotency: same (conv, clientMsgId) returns the original message
  const existing = db
    .prepare(`SELECT * FROM messages WHERE conv_id=? AND client_msg_id=?`)
    .get(req.params.id, clientMsgId) as Row | undefined;
  if (existing) {
    return res.json({
      id: existing.id as string,
      createdAt: existing.created_at as string,
      duplicate: true,
    });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO messages (id, conv_id, sender_id, body, client_msg_id) VALUES (?,?,?,?,?)`
  ).run(id, req.params.id, me, body, clientMsgId);
  const created = db.prepare(`SELECT * FROM messages WHERE id=?`).get(id) as Row;
  const payload = {
    convId: req.params.id,
    id,
    senderId: me,
    body,
    createdAt: created.created_at as string,
  };
  io.to(`conv:${req.params.id}`).emit("message:new", payload);
  res.status(201).json({ id, createdAt: payload.createdAt });
});

app.post("/v1/conversations/:id/read", (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const lastId = String(req.body?.lastMessageId ?? "");
  db.prepare(
    `INSERT INTO reads (conv_id, user_id, last_read_message_id) VALUES (?,?,?)
     ON CONFLICT(conv_id, user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id`
  ).run(req.params.id, me, lastId);
  io.to(`conv:${req.params.id}`).emit("message:read", { convId: req.params.id, userId: me, lastMessageId: lastId });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- WS
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

const userSockets = new Map<string, Set<string>>(); // userId -> socketIds

io.use((socket: Socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string;
    const sub = (jwt.verify(token, JWT_SECRET) as { sub: string }).sub;
    socket.data.userId = sub;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket: Socket) => {
  const userId = socket.data.userId as string;
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId)!.add(socket.id);

  const convs = db
    .prepare(`SELECT id FROM conversations WHERE user_a=? OR user_b=?`)
    .all(userId, userId) as { id: string }[];
  for (const c of convs) socket.join(`conv:${c.id}`);

  // presence
  const presence = [...userSockets.keys()];
  io.emit("presence", { online: presence });

  socket.on("typing", ({ convId, typing }: { convId: string; typing: boolean }) => {
    socket.to(`conv:${convId}`).emit("typing", { convId, userId, typing });
  });

  socket.on("disconnect", () => {
    userSockets.get(userId)?.delete(socket.id);
    if (userSockets.get(userId)?.size === 0) userSockets.delete(userId);
    io.emit("presence", { online: [...userSockets.keys()] });
  });
});

server.listen(PORT, () => {
  console.log(`
  ╭──────────────────────────────────────────╮
  │   دل — Del API ${VERSION.padEnd(21)}│
  │   listening on http://0.0.0.0:${String(PORT).padEnd(11)}│
  │   db: ${DB_PATH.padEnd(35)}│
  ╰──────────────────────────────────────────╯`);
});
