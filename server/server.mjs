/**
 * HTTP + WebSocket сервер для игры «Города».
 *
 * Маршруты HTTP:
 *   GET  /              — главная (выбор режима)
 *   GET  /solo          — одиночная игра с ИИ
 *   GET  /multi         — мультиплеер (лобби/комната)
 *   GET  /api/rooms     — JSON-список публичных комнат
 *   статика /public
 *
 * WebSocket: /ws  — см. сообщения ниже.
 *
 * Зависимости: только пакет `ws` (установить: `npm install`).
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, dirname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { RoomManager } from "./rooms.mjs";
import { size as citiesSize } from "./cities_db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
};

const rooms = new RoomManager();

// ── HTTP ─────────────────────────────────────────────────────────────
async function serveFile(res, absPath) {
  try {
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error("not a file");
    const body = await readFile(absPath);
    const ext = extname(absPath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
}

function safeResolve(urlPath) {
  // убираем query, декодируем, защищаемся от /../
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const joined = normalize(resolve(PUBLIC_DIR, "." + clean));
  if (!joined.startsWith(PUBLIC_DIR + sep) && joined !== PUBLIC_DIR) return null;
  return joined;
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  // роуты
  if (url === "/" || url.startsWith("/?")) return serveFile(res, resolve(PUBLIC_DIR, "index.html"));
  if (url === "/solo")  return serveFile(res, resolve(PUBLIC_DIR, "solo.html"));
  if (url === "/multi") return serveFile(res, resolve(PUBLIC_DIR, "multi.html"));

  if (url === "/api/rooms") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ rooms: rooms.publicList() }));
    return;
  }
  if (url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, cities: citiesSize(), rooms: rooms.rooms.size }));
    return;
  }

  // статика
  const abs = safeResolve(url);
  if (abs) return serveFile(res, abs);
  res.writeHead(404).end("404");
});

// ── WebSocket ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

/** @type {Map<import('ws').WebSocket, {playerId:string, name:string, roomCode?:string}>} */
const clients = new Map();

function send(ws, type, payload = {}) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastRoom(room, type, payload = {}) {
  for (const [ws, ctx] of clients) {
    if (ctx.roomCode === room.code) send(ws, type, payload);
  }
}

function pushRoomState(room) {
  broadcastRoom(room, "room:state", { room: room.snapshot() });
}

function broadcastLobby() {
  const list = rooms.publicList();
  for (const [ws, ctx] of clients) {
    if (!ctx.roomCode) send(ws, "lobby:update", { rooms: list });
  }
}
rooms.onLobbyChange(broadcastLobby);

function leaveRoom(ws) {
  const ctx = clients.get(ws);
  if (!ctx || !ctx.roomCode) return;
  const room = rooms.get(ctx.roomCode);
  const wasCode = ctx.roomCode;
  ctx.roomCode = undefined;
  if (!room) return;
  room.removePlayer(ctx.playerId);
  if (room.players.size === 0) {
    rooms.remove(wasCode);
  } else {
    pushRoomState(room);
    rooms.notifyLobby();
  }
}

wss.on("connection", (ws) => {
  const playerId = randomUUID();
  clients.set(ws, { playerId, name: "Игрок" });
  send(ws, "hello", { playerId });
  send(ws, "lobby:update", { rooms: rooms.publicList() });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    leaveRoom(ws);
    clients.delete(ws);
  });
});

function handleMessage(ws, msg) {
  const ctx = clients.get(ws);
  if (!ctx) return;
  const { type } = msg || {};

  switch (type) {
    case "lobby:list": {
      send(ws, "lobby:update", { rooms: rooms.publicList() });
      break;
    }

    case "room:create": {
      if (ctx.roomCode) return send(ws, "error", { message: "Вы уже в комнате." });
      const room = rooms.createRoom({
        hostName: msg.name,
        maxPlayers: msg.maxPlayers,
        isPrivate: !!msg.isPrivate,
        password: msg.password,
      });
      ctx.name = String(msg.name || "Игрок").slice(0, 24);
      room.addPlayer({ id: ctx.playerId, name: ctx.name });
      ctx.roomCode = room.code;
      send(ws, "room:joined", { room: room.snapshot(), you: ctx.playerId });
      rooms.notifyLobby();
      break;
    }

    case "room:join": {
      if (ctx.roomCode) return send(ws, "error", { message: "Вы уже в комнате." });
      const room = rooms.get(msg.code);
      if (!room) return send(ws, "error", { message: "Комната не найдена." });
      if (room.status !== "waiting") return send(ws, "error", { message: "Игра уже идёт." });
      if (room.isFull()) return send(ws, "error", { message: "В комнате нет свободных мест." });
      if (!room.checkPassword(msg.password)) return send(ws, "error", { message: "Неверный пароль." });
      ctx.name = String(msg.name || "Игрок").slice(0, 24);
      room.addPlayer({ id: ctx.playerId, name: ctx.name });
      ctx.roomCode = room.code;
      send(ws, "room:joined", { room: room.snapshot(), you: ctx.playerId });
      pushRoomState(room);
      rooms.notifyLobby();
      break;
    }

    case "room:leave": {
      leaveRoom(ws);
      send(ws, "room:left");
      send(ws, "lobby:update", { rooms: rooms.publicList() });
      break;
    }

    case "room:start": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const res = room.start(ctx.playerId);
      if (res.error) return send(ws, "error", { message: res.error });
      pushRoomState(room);
      rooms.notifyLobby();
      break;
    }

    case "room:move": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const result = room.playMove(ctx.playerId, msg.city);
      if (result.error) {
        // ошибку видит только автор хода — ход остаётся у него
        send(ws, "move:invalid", { message: result.error });
        return;
      }
      pushRoomState(room);
      if (room.status === "finished") rooms.notifyLobby();
      break;
    }

    case "room:surrender": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const result = room.surrender(ctx.playerId);
      if (result.error) return send(ws, "error", { message: result.error });
      pushRoomState(room);
      rooms.notifyLobby();
      break;
    }

    case "ping": send(ws, "pong"); break;

    default:
      send(ws, "error", { message: "Неизвестный тип сообщения." });
  }
}

// ── start ───────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`Cities game server → http://${HOST}:${PORT}`);
  console.log(`   солo:        http://${HOST}:${PORT}/solo`);
  console.log(`   мультиплеер: http://${HOST}:${PORT}/multi`);
  console.log(`Городов в базе: ${citiesSize()}`);
});
