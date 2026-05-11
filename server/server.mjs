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
  // Сохраняем системные и эмодзи сообщения в лог
  if (type === "chat:system") {
    room.chatLog = room.chatLog || [];
    room.chatLog.push({ kind: "system", text: payload.text, at: Date.now() });
    if (room.chatLog.length > 200) room.chatLog.shift();
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

function ensureRoomCallbacks(room) {
  if (!room._onTimerExpire) {
    room._onTimerExpire = () => { pushRoomState(room); rooms.notifyLobby(); };
  }
  if (!room._onAutoStart) {
    room._onAutoStart = (reason) => {
      broadcastRoom(room, "chat:system", { text: reason === "full" ? "🎮 Все собрались — игра началась!" : "⏱ Время ожидания истекло — игра началась!" });
      pushRoomState(room);
      rooms.notifyLobby();
    };
  }
}

function leaveRoom(ws) {
  const ctx = clients.get(ws);
  if (!ctx || !ctx.roomCode) return;
  const room = rooms.get(ctx.roomCode);
  const wasCode = ctx.roomCode;
  const wasName = ctx.name;
  ctx.roomCode = undefined;
  if (!room) return;
  // При дисконнекте (закрытие вкладки) — пометить как отключённого, не удалять
  room.disconnectPlayer(ctx.playerId);
  if (room.players.size === 0) {
    rooms.remove(wasCode);
  } else {
    broadcastRoom(room, "chat:system", { text: `${wasName} отключился` });
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
        turnTimer: msg.turnTimer || 0,
        hints: !!msg.hints,
        disconnectTimeout: msg.disconnectTimeout || 0,
      });
      ctx.name = String(msg.name || "Игрок").slice(0, 24);
      ctx.avatar = String(msg.avatar || "🙂").slice(0, 4);
      ctx.color = String(msg.color || "#6ea8ff").slice(0, 16);
      room.addPlayer({ id: ctx.playerId, name: ctx.name, avatar: ctx.avatar, color: ctx.color });
      ctx.roomCode = room.code;
      room._onTimerExpire = () => { pushRoomState(room); rooms.notifyLobby(); };
      room._onAutoStart = (reason) => {
        broadcastRoom(room, "chat:system", { text: reason === "full" ? "🎮 Все собрались — игра началась!" : "⏱ Время ожидания истекло — игра началась!" });
        pushRoomState(room);
        rooms.notifyLobby();
      };
      send(ws, "room:joined", { room: room.snapshot(), you: ctx.playerId, chatLog: room.chatLog });
      rooms.notifyLobby();
      break;
    }

    case "room:join": {
      if (ctx.roomCode) return send(ws, "error", { message: "Вы уже в комнате." });
      const room = rooms.get(msg.code);
      if (!room) return send(ws, "error", { message: "Комната не найдена." });
      if (room.isKicked(ctx.playerId)) return send(ws, "error", { message: "Вы были исключены из этой комнаты." });
      if (!room.checkPassword(msg.password)) return send(ws, "error", { message: "Неверный пароль." });
      ensureRoomCallbacks(room);
      ctx.name = String(msg.name || "Игрок").slice(0, 24);
      ctx.avatar = String(msg.avatar || "🙂").slice(0, 4);
      ctx.color = String(msg.color || "#6ea8ff").slice(0, 16);
      // Реконнект — если игрок уже есть в комнате (вернулся)
      const existingPlayer = room.players.get(ctx.playerId);
      if (existingPlayer) {
        existingPlayer.connected = true;
        existingPlayer.name = ctx.name;
        existingPlayer.avatar = ctx.avatar;
        existingPlayer.color = ctx.color;
        room._clearDisconnectTimer(ctx.playerId);
        ctx.roomCode = room.code;
        send(ws, "room:joined", { room: room.snapshot(), you: ctx.playerId, chatLog: room.chatLog });
        broadcastRoom(room, "chat:system", { text: `${ctx.name} вернулся в игру` });
        pushRoomState(room);
        return;
      }
      // Новый игрок
      if (room.status !== "waiting") return send(ws, "error", { message: "Игра уже идёт." });
      if (room.isFull()) return send(ws, "error", { message: "В комнате нет свободных мест." });
      room.addPlayer({ id: ctx.playerId, name: ctx.name, avatar: ctx.avatar, color: ctx.color });
      ctx.roomCode = room.code;
      send(ws, "room:joined", { room: room.snapshot(), you: ctx.playerId, chatLog: room.chatLog });
      pushRoomState(room);
      broadcastRoom(room, "chat:system", { text: `${ctx.name} присоединился к комнате` });
      rooms.notifyLobby();
      break;
    }

    case "room:leave": {
      // Явный выход — удалить из комнаты полностью
      const room = rooms.get(ctx.roomCode);
      const wasName = ctx.name;
      ctx.roomCode = undefined;
      if (room) {
        room.removePlayer(ctx.playerId);
        if (room.players.size === 0) {
          rooms.remove(room.code);
        } else {
          broadcastRoom(room, "chat:system", { text: `${wasName} покинул комнату` });
          pushRoomState(room);
          rooms.notifyLobby();
        }
      }
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

    case "room:extendAutoStart": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const result = room.extendAutoStart(ctx.playerId, msg.seconds || 60);
      if (result.error) return send(ws, "error", { message: result.error });
      broadcastRoom(room, "chat:system", { text: `⏱ Хост добавил ещё время ожидания (+${msg.seconds || 60}с)` });
      pushRoomState(room);
      break;
    }

    case "chat:message": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const text = String(msg.text || "").trim().slice(0, 500);
      if (!text) return;
      const entry = { kind: "text", name: ctx.name, playerId: ctx.playerId, text, at: Date.now() };
      room.chatLog.push(entry);
      if (room.chatLog.length > 200) room.chatLog.shift();
      broadcastRoom(room, "chat:message", entry);
      break;
    }

    case "chat:voice": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      // msg.data — base64 аудио (ограничим ~500KB)
      const data = String(msg.data || "");
      if (!data || data.length > 700000) return send(ws, "error", { message: "Файл слишком большой." });
      const duration = Math.max(0, Math.min(60, Number(msg.duration) || 0));
      const entry = { kind: "voice", name: ctx.name, playerId: ctx.playerId, data, duration, at: Date.now() };
      room.chatLog.push(entry);
      if (room.chatLog.length > 200) room.chatLog.shift();
      broadcastRoom(room, "chat:voice", entry);
      break;
    }

    case "chat:video": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const data = String(msg.data || "");
      if (!data || data.length > 2000000) return send(ws, "error", { message: "Файл слишком большой." });
      const duration = Math.max(0, Math.min(30, Number(msg.duration) || 0));
      const entry = { kind: "video", name: ctx.name, playerId: ctx.playerId, data, duration, at: Date.now() };
      room.chatLog.push(entry);
      if (room.chatLog.length > 200) room.chatLog.shift();
      broadcastRoom(room, "chat:video", entry);
      break;
    }

    case "chat:emoji": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const emoji = String(msg.emoji || "").slice(0, 4);
      if (!emoji) return;
      broadcastRoom(room, "chat:emoji", { name: ctx.name, emoji, playerId: ctx.playerId });
      break;
    }

    case "room:rematch": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const result = room.rematch(ctx.playerId);
      if (result.error) return send(ws, "error", { message: result.error });
      broadcastRoom(room, "chat:system", { text: "🔄 Новая партия!" });
      pushRoomState(room);
      rooms.notifyLobby();
      break;
    }

    case "room:kick": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      const result = room.kickPlayer(ctx.playerId, msg.targetId);
      if (result.error) return send(ws, "error", { message: result.error });
      // Найти сокет игрока и закрыть/удалить
      for (const [clientWs, clientCtx] of clients) {
        if (clientCtx.playerId === msg.targetId && clientCtx.roomCode === room.code) {
          send(clientWs, "room:kicked", { message: "Вас исключили из комнаты." });
          clientCtx.roomCode = undefined;
          break;
        }
      }
      room.removePlayer(msg.targetId);
      broadcastRoom(room, "chat:system", { text: `${result.targetName} исключён хостом` });
      pushRoomState(room);
      rooms.notifyLobby();
      break;
    }

    case "chat:typing": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return;
      // Рассылаем всем кроме отправителя
      for (const [otherWs, otherCtx] of clients) {
        if (otherCtx.roomCode === room.code && otherWs !== ws) {
          send(otherWs, "chat:typing", { name: ctx.name, playerId: ctx.playerId });
        }
      }
      break;
    }

    case "room:hint": {
      const room = rooms.get(ctx.roomCode);
      if (!room) return send(ws, "error", { message: "Вы не в комнате." });
      if (ctx.playerId !== room.currentPlayerId) return send(ws, "error", { message: "Подсказка только для ходящего." });
      const hint = room.getHint();
      if (!hint) return send(ws, "error", { message: "Подсказка недоступна." });
      send(ws, "room:hint", { hint });
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
