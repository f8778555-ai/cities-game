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
import * as DB from "./db.mjs";
import { ACHIEVEMENTS, checkAchievements } from "./achievements.mjs";
import { verifyGoogleIdToken } from "./google_auth.mjs";
import { SHOP_AVATARS, getShopForUser, isAvatarUnlocked } from "./shop.mjs";
import { THEMES, getThemesForUser, isThemeUnlocked } from "./themes.mjs";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

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

// ── HTTP helpers ─────────────────────────────────────────────────────
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const map = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) map[k] = decodeURIComponent(rest.join("="));
  }
  return map;
}

function setSessionCookie(res, token) {
  const cookie = `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
}

async function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 100_000) { req.destroy(); reject(new Error("too large")); return; } chunks.push(c); });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function jsonResponse(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function getUserFromReq(req) {
  const cookies = parseCookies(req);
  return DB.getSessionUser(cookies.session);
}

function userPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    color: u.color,
    theme: u.theme || "dark",
    email: u.email || null,
    isGoogle: !!u.googleSub,
    level: u.level || 1,
    xp: u.xp || 0,
    xpToNext: DB.xpToNextLevel(u.level || 1),
    friends: Object.keys(u.friends || {}).length,
    unlockedAvatars: u.unlockedAvatars || {},
    stats: u.stats,
    achievements: u.achievements,
  };
}

async function handleGoogleAuth(req, res) {
  try {
    const body = await readJSONBody(req);
    const token = body.credential;
    if (!token) return jsonResponse(res, 400, { error: "no token" });
    const payload = await verifyGoogleIdToken(token, GOOGLE_CLIENT_ID || null);
    const user = DB.linkOrCreateGoogleUser({
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.given_name || "Игрок",
      picture: payload.picture,
    });
    // Проверяем достижения после входа через гугл
    const unlocked = checkAchievements(user, DB.unlockAchievement);
    const sessionToken = DB.createSession(user.id);
    setSessionCookie(res, sessionToken);
    jsonResponse(res, 200, { user: userPublic(user), newAchievements: unlocked });
  } catch (e) {
    console.error("google auth error:", e.message);
    jsonResponse(res, 401, { error: "invalid token: " + e.message });
  }
}

function handleLogout(req, res) {
  const cookies = parseCookies(req);
  if (cookies.session) DB.deleteSession(cookies.session);
  clearSessionCookie(res);
  jsonResponse(res, 200, { ok: true });
}

function handleMe(req, res) {
  const u = getUserFromReq(req);
  if (!u) return jsonResponse(res, 200, { user: null });
  jsonResponse(res, 200, { user: userPublic(u) });
}

async function handleUpdateProfile(req, res) {
  const u = getUserFromReq(req);
  if (!u) return jsonResponse(res, 401, { error: "not authenticated" });
  try {
    const body = await readJSONBody(req);
    // Проверяем что аватар разблокирован
    if (body.avatar) {
      const item = SHOP_AVATARS.find(a => a.emoji === body.avatar);
      if (item && !isAvatarUnlocked(u, item)) {
        return jsonResponse(res, 403, { error: "Avatar locked. Требуется уровень " + item.requireLevel });
      }
    }
    if (body.theme) {
      const t = THEMES.find(x => x.id === body.theme);
      if (t && !isThemeUnlocked(u, t)) {
        return jsonResponse(res, 403, { error: "Тема заблокирована (уровень " + t.requireLevel + ")" });
      }
    }
    const updated = DB.updateUserProfile(u.id, body);
    const unlocked = checkAchievements(updated, DB.unlockAchievement);
    jsonResponse(res, 200, { user: userPublic(updated), newAchievements: unlocked });
  } catch (e) {
    jsonResponse(res, 400, { error: "bad request" });
  }
}

function handleLeaderboard(req, res, url) {
  const u = new URL(url, "http://x");
  const sortBy = u.searchParams.get("sort") || "wins";
  const limit = Math.min(100, Number(u.searchParams.get("limit")) || 50);
  const list = DB.getLeaderboard(sortBy, limit);
  jsonResponse(res, 200, { leaderboard: list, sortBy });
}

function handleShop(req, res) {
  const u = getUserFromReq(req);
  const shop = u ? getShopForUser(u) : SHOP_AVATARS.map(a => ({ ...a, unlocked: a.category === "basic" }));
  jsonResponse(res, 200, { shop });
}

function handleThemes(req, res) {
  const u = getUserFromReq(req);
  const themes = u ? getThemesForUser(u) : THEMES.map(t => ({ ...t, unlocked: t.requireLevel <= 1 }));
  jsonResponse(res, 200, { themes });
}

function handleFriendsList(req, res) {
  const u = getUserFromReq(req);
  if (!u) return jsonResponse(res, 401, { error: "not authenticated" });
  jsonResponse(res, 200, { friends: DB.listFriends(u.id) });
}

async function handleFriendAdd(req, res) {
  const u = getUserFromReq(req);
  if (!u) return jsonResponse(res, 401, { error: "not authenticated" });
  try {
    const body = await readJSONBody(req);
    const result = DB.addFriend(u.id, body.userId);
    if (result.error) return jsonResponse(res, 400, { error: result.error });
    jsonResponse(res, 200, { ok: true, friends: DB.listFriends(u.id) });
  } catch {
    jsonResponse(res, 400, { error: "bad request" });
  }
}

async function handleFriendRemove(req, res) {
  const u = getUserFromReq(req);
  if (!u) return jsonResponse(res, 401, { error: "not authenticated" });
  try {
    const body = await readJSONBody(req);
    const result = DB.removeFriend(u.id, body.userId);
    if (result.error) return jsonResponse(res, 400, { error: result.error });
    jsonResponse(res, 200, { ok: true, friends: DB.listFriends(u.id) });
  } catch {
    jsonResponse(res, 400, { error: "bad request" });
  }
}

function handleUserSearch(req, res, url) {
  const u = new URL(url, "http://x");
  const q = u.searchParams.get("q") || "";
  const users = DB.searchUsers(q, 20);
  jsonResponse(res, 200, { users });
}

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
  if (url === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID }));
    return;
  }
  if (url === "/api/achievements") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ achievements: ACHIEVEMENTS.map(a => ({ id: a.id, title: a.title, description: a.description, icon: a.icon })) }));
    return;
  }
  if (url === "/api/auth/google" && req.method === "POST") {
    return handleGoogleAuth(req, res);
  }
  if (url === "/api/auth/logout" && req.method === "POST") {
    return handleLogout(req, res);
  }
  if (url === "/api/me") {
    return handleMe(req, res);
  }
  if (url === "/api/me/profile" && req.method === "POST") {
    return handleUpdateProfile(req, res);
  }
  if (url.startsWith("/api/leaderboard")) {
    return handleLeaderboard(req, res, url);
  }
  if (url === "/api/shop") {
    return handleShop(req, res);
  }
  if (url === "/api/themes") {
    return handleThemes(req, res);
  }
  if (url === "/api/friends") {
    return handleFriendsList(req, res);
  }
  if (url === "/api/friends/add" && req.method === "POST") {
    return handleFriendAdd(req, res);
  }
  if (url === "/api/friends/remove" && req.method === "POST") {
    return handleFriendRemove(req, res);
  }
  if (url.startsWith("/api/users/search")) {
    return handleUserSearch(req, res, url);
  }

  // статика
  const abs = safeResolve(url);
  if (abs) return serveFile(res, abs);
  res.writeHead(404).end("404");
});

// ── WebSocket ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

/** @type {Map<import('ws').WebSocket, {playerId:string, name:string, roomCode?:string, userId?:string}>} */
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
  // Если игра завершилась — обновим БД для всех залогиненных игроков
  if (room.status === "finished" && !room._recorded) {
    room._recorded = true;
    recordRoomFinish(room);
  }
}

function recordRoomFinish(room) {
  const playerIds = Array.from(room.players.keys());
  for (const [ws, ctx] of clients) {
    if (ctx.roomCode !== room.code) continue;
    if (!ctx.userId) continue;
    const user = DB.getUserById(ctx.userId);
    if (!user) continue;
    const won = room.winnerId === ctx.playerId;
    const citiesPlayed = room.history.filter(h => h.playerId === ctx.playerId).map(h => h.city);
    const opponents = playerIds.filter(id => id !== ctx.playerId);
    const result = DB.recordGameResult(ctx.userId, { won, citiesPlayed, opponents });
    if (result) {
      const unlocked = checkAchievements(result.user, DB.unlockAchievement);
      if (unlocked.length > 0) {
        send(ws, "achievements:unlocked", { achievements: unlocked });
      }
      if (result.leveledUp) {
        send(ws, "level:up", { level: result.user.level, xp: result.user.xp, xpToNext: DB.xpToNextLevel(result.user.level) });
      }
      send(ws, "xp:gained", { xpGained: result.xpGained });
      send(ws, "user:update", { user: userPublic(result.user) });
    }
  }
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

wss.on("connection", (ws, req) => {
  const playerId = randomUUID();
  const cookies = parseCookies(req);
  const user = DB.getSessionUser(cookies.session);
  clients.set(ws, { playerId, name: user?.name || "Игрок", userId: user?.id });
  send(ws, "hello", { playerId, user: user ? userPublic(user) : null });
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
      room._recorded = false;
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
