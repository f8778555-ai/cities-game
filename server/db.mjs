/**
 * Простая JSON-база для пользователей, достижений и статистики.
 * Атомарная запись через временный файл.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const DB_FILE = resolve(DATA_DIR, "db.json");

function ensureDir() { mkdirSync(DATA_DIR, { recursive: true }); }

// ── XP curve ──────────────────────────────────────────
const XP_CURVE = (lvl) => Math.floor(100 * Math.pow(lvl, 1.5));
export function xpToNextLevel(level) { return XP_CURVE(level); }

function loadDB() {
  ensureDir();
  if (!existsSync(DB_FILE)) {
    return { users: {}, googleIndex: {}, sessions: {} };
  }
  try {
    const raw = readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    db.users ||= {};
    db.googleIndex ||= {};
    db.sessions ||= {};
    // Миграция
    for (const u of Object.values(db.users)) {
      u.xp ||= 0;
      u.level ||= 1;
      u.theme ||= "dark";
      u.friends ||= {};
      u.unlockedAvatars ||= {};
      u.achievements ||= {};
      u.stats ||= {};
      u.stats.games ||= 0;
      u.stats.wins ||= 0;
    }
    return db;
  } catch (e) {
    console.error("DB load error:", e);
    return { users: {}, googleIndex: {}, sessions: {} };
  }
}

let db = loadDB();
let saveTimer = null;

function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureDir();
      const tmp = DB_FILE + ".tmp";
      writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
      renameSync(tmp, DB_FILE);
    } catch (e) { console.error("DB save error:", e); }
  }, 200);
}

function newUser({ googleSub = null, email = null, name, avatar = "🙂", color = "#6ea8ff" } = {}) {
  const id = "u_" + randomUUID().slice(0, 16);
  const user = {
    id,
    googleSub,
    email,
    name: name || "Игрок",
    avatar,
    color,
    theme: "dark",
    xp: 0,
    level: 1,
    friends: {}, // { userId: { addedAt } }
    unlockedAvatars: {}, // { emoji: true }
    createdAt: Date.now(),
    stats: {
      games: 0,
      wins: 0,
      losses: 0,
      streak: 0,
      maxStreak: 0,
      totalCities: 0,
      uniqueCities: {},
      longestCity: "",
      fastestMoveMs: null,
      lettersUsed: {},
      playedWithPlayers: {},
      lastGameAt: null,
    },
    achievements: {},
  };
  db.users[id] = user;
  if (googleSub) db.googleIndex[googleSub] = id;
  saveDB();
  return user;
}

export function getUserById(id) { return db.users[id] || null; }
export function getUserByGoogleSub(sub) {
  const id = db.googleIndex[sub];
  return id ? db.users[id] : null;
}

export function createGuestUser(profile = {}) {
  return newUser({ googleSub: null, name: profile.name || "Игрок", avatar: profile.avatar, color: profile.color });
}

export function linkOrCreateGoogleUser({ sub, email, name, picture }) {
  const existing = getUserByGoogleSub(sub);
  if (existing) {
    // Обновим email/name если пустые
    if (!existing.email) existing.email = email;
    if (!existing.name || existing.name === "Игрок") existing.name = name;
    saveDB();
    return existing;
  }
  return newUser({ googleSub: sub, email, name });
}

export function updateUserProfile(userId, { name, avatar, color, theme }) {
  const u = db.users[userId];
  if (!u) return null;
  if (name) u.name = String(name).slice(0, 24);
  if (avatar) u.avatar = String(avatar).slice(0, 4);
  if (color) u.color = String(color).slice(0, 16);
  if (theme) u.theme = String(theme).slice(0, 20);
  saveDB();
  return u;
}

// ── XP / Level ──────────────────────────────────────────

export function addXP(userId, amount) {
  const u = db.users[userId];
  if (!u) return null;
  u.xp = (u.xp || 0) + amount;
  u.level = u.level || 1;
  let leveledUp = false;
  while (u.xp >= XP_CURVE(u.level)) {
    u.xp -= XP_CURVE(u.level);
    u.level++;
    leveledUp = true;
  }
  saveDB();
  return { user: u, leveledUp };
}

// ── Avatars unlock ──────────────────────────────────────
export function unlockAvatar(userId, emoji) {
  const u = db.users[userId];
  if (!u) return false;
  u.unlockedAvatars = u.unlockedAvatars || {};
  if (u.unlockedAvatars[emoji]) return false;
  u.unlockedAvatars[emoji] = true;
  saveDB();
  return true;
}

// ── Friends ─────────────────────────────────────────────
export function addFriend(userId, friendId) {
  const u = db.users[userId];
  const f = db.users[friendId];
  if (!u || !f || u.id === f.id) return { error: "not found" };
  u.friends = u.friends || {};
  if (u.friends[friendId]) return { error: "already friend" };
  u.friends[friendId] = { addedAt: Date.now() };
  // Взаимно
  f.friends = f.friends || {};
  f.friends[userId] = { addedAt: Date.now() };
  saveDB();
  return { ok: true };
}

export function removeFriend(userId, friendId) {
  const u = db.users[userId];
  const f = db.users[friendId];
  if (!u || !f) return { error: "not found" };
  delete (u.friends || {})[friendId];
  delete (f.friends || {})[userId];
  saveDB();
  return { ok: true };
}

export function listFriends(userId) {
  const u = db.users[userId];
  if (!u) return [];
  const result = [];
  for (const fid of Object.keys(u.friends || {})) {
    const f = db.users[fid];
    if (f) result.push({ id: f.id, name: f.name, avatar: f.avatar, color: f.color, level: f.level || 1 });
  }
  return result;
}

export function searchUsers(query, limit = 20) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const result = [];
  for (const u of Object.values(db.users)) {
    if (u.name.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)) {
      result.push({ id: u.id, name: u.name, avatar: u.avatar, color: u.color, level: u.level || 1, email: u.email });
      if (result.length >= limit) break;
    }
  }
  return result;
}

// ── Leaderboard ─────────────────────────────────────────
export function getLeaderboard(sortBy = "wins", limit = 50) {
  const users = Object.values(db.users);
  const sorters = {
    wins: (a, b) => (b.stats?.wins || 0) - (a.stats?.wins || 0),
    games: (a, b) => (b.stats?.games || 0) - (a.stats?.games || 0),
    streak: (a, b) => (b.stats?.maxStreak || 0) - (a.stats?.maxStreak || 0),
    level: (a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0),
    cities: (a, b) => (b.stats?.totalCities || 0) - (a.stats?.totalCities || 0),
  };
  const cmp = sorters[sortBy] || sorters.wins;
  users.sort(cmp);
  return users.slice(0, limit).map(u => ({
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    color: u.color,
    level: u.level || 1,
    wins: u.stats?.wins || 0,
    games: u.stats?.games || 0,
    maxStreak: u.stats?.maxStreak || 0,
    totalCities: u.stats?.totalCities || 0,
    winRate: u.stats?.games ? Math.round((u.stats.wins / u.stats.games) * 100) : 0,
    isGoogle: !!u.googleSub,
  }));
}

export function createSession(userId) {
  const token = randomBytes(24).toString("base64url");
  db.sessions[token] = { userId, createdAt: Date.now() };
  saveDB();
  return token;
}

export function getSessionUser(token) {
  if (!token) return null;
  const s = db.sessions[token];
  if (!s) return null;
  return db.users[s.userId] || null;
}

export function deleteSession(token) {
  if (db.sessions[token]) { delete db.sessions[token]; saveDB(); }
}

/** Обновить статистику пользователя результатом игры. Возвращает { user, xpGained, leveledUp }. */
export function recordGameResult(userId, result) {
  const u = db.users[userId];
  if (!u) return null;
  const s = u.stats;
  s.games++;
  s.lastGameAt = Date.now();
  if (result.won) {
    s.wins++;
    s.streak++;
    if (s.streak > s.maxStreak) s.maxStreak = s.streak;
  } else {
    s.losses++;
    s.streak = 0;
  }
  if (result.citiesPlayed) {
    for (const city of result.citiesPlayed) {
      s.totalCities++;
      s.uniqueCities[city] = (s.uniqueCities[city] || 0) + 1;
      if (city.length > (s.longestCity?.length || 0)) s.longestCity = city;
      const ch = city[0]?.toLowerCase();
      if (ch) s.lettersUsed[ch] = true;
    }
  }
  if (result.fastestMoveMs) {
    if (!s.fastestMoveMs || result.fastestMoveMs < s.fastestMoveMs) s.fastestMoveMs = result.fastestMoveMs;
  }
  if (result.opponents) {
    for (const id of result.opponents) s.playedWithPlayers[id] = true;
  }
  // XP
  const basePlayXP = 10;
  const winBonus = result.won ? 25 : 0;
  const cityBonus = Math.min(20, (result.citiesPlayed?.length || 0) * 2);
  const xpGained = basePlayXP + winBonus + cityBonus;
  u.xp = (u.xp || 0) + xpGained;
  u.level = u.level || 1;
  let leveledUp = false;
  while (u.xp >= XP_CURVE(u.level)) {
    u.xp -= XP_CURVE(u.level);
    u.level++;
    leveledUp = true;
  }
  saveDB();
  return { user: u, xpGained, leveledUp };
}

export function unlockAchievement(userId, achId) {
  const u = db.users[userId];
  if (!u) return false;
  if (u.achievements[achId]) return false;
  u.achievements[achId] = { unlockedAt: Date.now() };
  saveDB();
  return true;
}
