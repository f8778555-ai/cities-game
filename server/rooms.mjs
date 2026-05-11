/**
 * Менеджер комнат для мультиплеера.
 */
import { randomUUID } from "node:crypto";
import { has, canonical, norm, byLetter } from "./cities_db.mjs";
import { lastPlayableLetter } from "./rules.mjs";

const MAX_PLAYERS_CAP = 32;
const MIN_PLAYERS = 2;
const CODE_LEN = 4;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;

function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this._listeners = new Set();
    setInterval(() => this._sweep(), 30_000).unref?.();
  }

  onLobbyChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  notifyLobby() { this._emitLobbyChange(); }
  _emitLobbyChange() { for (const fn of this._listeners) try { fn(); } catch {} }

  _uniqueCode() {
    for (let i = 0; i < 10; i++) {
      const code = newCode();
      if (!this.rooms.has(code)) return code;
    }
    return randomUUID().slice(0, 6).toUpperCase();
  }

  _sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.players.size === 0 && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS) {
        room.clearTimer();
        this.rooms.delete(code);
      } else if (now - room.lastActivityAt > IDLE_ROOM_TTL_MS) {
        room.clearTimer();
        this.rooms.delete(code);
      }
    }
    this._emitLobbyChange();
  }

  createRoom({ hostName, maxPlayers, isPrivate, password, turnTimer, hints, disconnectTimeout }) {
    const capacity = Math.min(MAX_PLAYERS_CAP, Math.max(MIN_PLAYERS, Number(maxPlayers) || 2));
    const room = new Room({
      code: this._uniqueCode(),
      hostName: String(hostName || "Игрок").slice(0, 24),
      maxPlayers: capacity,
      isPrivate: Boolean(isPrivate),
      password: isPrivate ? String(password || "").slice(0, 32) : "",
      turnTimer: Number(turnTimer) || 0,
      hints: Boolean(hints),
      disconnectTimeout: Number(disconnectTimeout) || 0,
    });
    this.rooms.set(room.code, room);
    this._emitLobbyChange();
    return room;
  }

  publicList() {
    const list = [];
    for (const r of this.rooms.values()) {
      if (r.isPrivate) continue;
      list.push({
        code: r.code,
        hostName: r.hostName,
        players: r.players.size,
        maxPlayers: r.maxPlayers,
        status: r.status,
        turnTimer: r.turnTimer,
        hints: r.hints,
      });
    }
    return list.sort((a, b) => a.status === "waiting" ? -1 : 1);
  }

  get(code) { return this.rooms.get(String(code || "").toUpperCase()); }
  remove(code) { const r = this.rooms.get(code); if (r) r.clearTimer(); this.rooms.delete(code); this._emitLobbyChange(); }
}

export class Room {
  constructor({ code, hostName, maxPlayers, isPrivate, password, turnTimer, hints, disconnectTimeout }) {
    this.code = code;
    this.hostName = hostName;
    this.maxPlayers = maxPlayers;
    this.isPrivate = isPrivate;
    this.password = password;
    this.turnTimer = turnTimer;
    this.hints = hints;
    this.disconnectTimeout = disconnectTimeout;
    /** @type {Map<string, Player>} */
    this.players = new Map();
    /** @type {Set<string>} */
    this.kickedIds = new Set();
    /** @type {Array} chat log (media messages too) */
    this.chatLog = [];
    this.history = [];
    this.used = new Set();
    this.lastLetter = null;
    this.currentPlayerId = null;
    this.status = "waiting";
    this.winnerId = null;
    this.endReason = "";
    this.lastActivityAt = Date.now();
    this.createdAt = Date.now();
    this.turnStartedAt = null;
    this.turnDeadline = null;
    this._timerInterval = null;
    this._onTimerExpire = null;
    this._disconnectTimers = new Map();
    this.hintGiven = false;
    // Auto-start countdown
    this.autoStartDeadline = null; // timestamp, когда партия стартует автоматически
    this._autoStartTimer = null;
    this._onAutoStart = null; // callback для автостарта
  }

  touch() { this.lastActivityAt = Date.now(); }

  checkPassword(pass) {
    if (!this.isPrivate) return true;
    return String(pass || "") === this.password;
  }

  isFull() { return this.players.size >= this.maxPlayers; }

  isKicked(id) { return this.kickedIds.has(id); }

  addPlayer({ id, name, avatar, color }) {
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      if (avatar) existing.avatar = avatar;
      if (color) existing.color = color;
      this._clearDisconnectTimer(id);
      this.touch();
      this._checkAutoStart();
      return existing;
    }
    const player = {
      id,
      name: String(name || "Игрок").slice(0, 24),
      avatar: String(avatar || "🙂").slice(0, 4),
      color: String(color || "#6ea8ff").slice(0, 16),
      score: 0,
      isHost: this.players.size === 0,
      connected: true,
    };
    this.players.set(id, player);
    this.touch();
    this._checkAutoStart();
    return player;
  }

  disconnectPlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    this.touch();

    if (this.status === "playing") {
      // Игра продолжается — передаём ход если был у него
      if (this.currentPlayerId === id) {
        this._advanceTurn();
        this._restartTurnTimer();
      }
      // Если остался 1 живой — победа
      const connectedCount = this._connectedCount();
      if (connectedCount < 2) {
        const connected = Array.from(this.players.values()).find(x => x.connected);
        if (connected) {
          this._finish(connected.id, "Остальные вышли.");
        }
      }
    } else if (this.status === "waiting") {
      // В ожидании — удаляем
      this.players.delete(id);
      if (p.isHost && this.players.size > 0) {
        const next = this.players.values().next().value;
        next.isHost = true;
        this.hostName = next.name;
      }
      this._checkAutoStart();
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this._clearDisconnectTimer(id);
    this.players.delete(id);
    if (p.isHost && this.players.size > 0) {
      const next = this.players.values().next().value;
      next.isHost = true;
      this.hostName = next.name;
    }
    if (this.status === "playing" && this._connectedCount() < 2) {
      const connected = Array.from(this.players.values()).find(x => x.connected);
      if (connected) {
        this._finish(connected.id, `${p.name} покинул игру.`);
      } else if (this.players.size === 1) {
        const last = this.players.values().next().value;
        this._finish(last.id, `${p.name} покинул игру.`);
      }
    } else if (this.status === "playing" && this.currentPlayerId === id) {
      this._advanceTurn();
      this._restartTurnTimer();
    }
    if (this.status === "waiting") this._checkAutoStart();
    this.touch();
  }

  _connectedCount() {
    let c = 0;
    for (const p of this.players.values()) if (p.connected) c++;
    return c;
  }

  _startDisconnectTimer(id) {
    this._clearDisconnectTimer(id);
    if (this.disconnectTimeout <= 0) return;
    const timer = setTimeout(() => {
      this.removePlayer(id);
      if (this._onTimerExpire) this._onTimerExpire("disconnect", id);
    }, this.disconnectTimeout * 1000);
    timer.unref?.();
    this._disconnectTimers.set(id, timer);
  }

  _clearDisconnectTimer(id) {
    const t = this._disconnectTimers.get(id);
    if (t) { clearTimeout(t); this._disconnectTimers.delete(id); }
  }

  /** Проверить, нужно ли запустить авто-старт или начать партию сразу. */
  _checkAutoStart() {
    if (this.status !== "waiting") return;
    const count = this.players.size;
    const cap = this.maxPlayers;

    // Все собрались — стартуем немедленно
    if (count >= cap && count >= MIN_PLAYERS) {
      this._cancelAutoStart();
      // Найдём хоста для старта
      const host = Array.from(this.players.values()).find(p => p.isHost);
      if (host) {
        this.status = "playing";
        const ids = Array.from(this.players.keys());
        this.currentPlayerId = ids[Math.floor(Math.random() * ids.length)];
        this.lastLetter = null;
        this.used = new Set();
        this.history = [];
        this.winnerId = null;
        this.endReason = "";
        this.hintGiven = false;
        for (const p of this.players.values()) p.score = 0;
        this._restartTurnTimer();
        if (this._onAutoStart) this._onAutoStart("full");
      }
      return;
    }

    // Больше половины собралось — запускаем обратный отсчёт (60 сек)
    const halfPlus = Math.floor(cap / 2) + 1;
    if (count >= halfPlus && count >= MIN_PLAYERS) {
      if (!this.autoStartDeadline) {
        this._startAutoStart(60);
      }
    } else {
      // Упали ниже половины — отменяем
      this._cancelAutoStart();
    }
  }

  _startAutoStart(seconds) {
    this._cancelAutoStart();
    this.autoStartDeadline = Date.now() + seconds * 1000;
    this._autoStartTimer = setTimeout(() => {
      this._autoStartTimer = null;
      this.autoStartDeadline = null;
      if (this.status !== "waiting") return;
      if (this.players.size < MIN_PLAYERS) return;
      // Автостарт
      this.status = "playing";
      const ids = Array.from(this.players.keys());
      this.currentPlayerId = ids[Math.floor(Math.random() * ids.length)];
      this.lastLetter = null;
      this.used = new Set();
      this.history = [];
      this.winnerId = null;
      this.endReason = "";
      this.hintGiven = false;
      for (const p of this.players.values()) p.score = 0;
      this._restartTurnTimer();
      if (this._onAutoStart) this._onAutoStart("timer");
    }, seconds * 1000);
    this._autoStartTimer.unref?.();
  }

  _cancelAutoStart() {
    if (this._autoStartTimer) { clearTimeout(this._autoStartTimer); this._autoStartTimer = null; }
    this.autoStartDeadline = null;
  }

  /** Хост продлевает время ожидания на N секунд. */
  extendAutoStart(hostId, seconds) {
    const host = this.players.get(hostId);
    if (!host || !host.isHost) return { error: "Только хост может продлить ожидание." };
    if (this.status !== "waiting") return { error: "Игра уже началась." };
    seconds = Math.max(10, Math.min(300, Number(seconds) || 60));
    if (this.autoStartDeadline) {
      this.autoStartDeadline += seconds * 1000;
      // Перезапускаем таймер с новым временем
      if (this._autoStartTimer) clearTimeout(this._autoStartTimer);
      const msLeft = this.autoStartDeadline - Date.now();
      this._autoStartTimer = setTimeout(() => {
        this._autoStartTimer = null;
        this.autoStartDeadline = null;
        if (this.status !== "waiting") return;
        if (this.players.size < MIN_PLAYERS) return;
        this.status = "playing";
        const ids = Array.from(this.players.keys());
        this.currentPlayerId = ids[Math.floor(Math.random() * ids.length)];
        this.lastLetter = null;
        this.used = new Set();
        this.history = [];
        this.winnerId = null;
        this.endReason = "";
        this.hintGiven = false;
        for (const p of this.players.values()) p.score = 0;
        this._restartTurnTimer();
        if (this._onAutoStart) this._onAutoStart("timer");
      }, Math.max(0, msLeft));
      this._autoStartTimer.unref?.();
    } else {
      // Ещё не запущен — запустим на seconds
      this._startAutoStart(seconds);
    }
    this.touch();
    return { ok: true };
  }

  start(byPlayerId) {
    if (this.status !== "waiting") return { error: "Игра уже запущена." };
    const starter = this.players.get(byPlayerId);
    if (!starter || !starter.isHost) return { error: "Начать может только хост." };
    if (this.players.size < MIN_PLAYERS) return { error: "Нужно минимум 2 игрока." };
    this._cancelAutoStart();
    this.status = "playing";
    const ids = Array.from(this.players.keys());
    this.currentPlayerId = ids[Math.floor(Math.random() * ids.length)];
    this.lastLetter = null;
    this.used = new Set();
    this.history = [];
    this.winnerId = null;
    this.endReason = "";
    this.hintGiven = false;
    for (const p of this.players.values()) p.score = 0;
    this.touch();
    this._restartTurnTimer();
    return { ok: true };
  }

  rematch(byPlayerId) {
    if (this.status !== "finished") return { error: "Игра ещё не завершена." };
    const starter = this.players.get(byPlayerId);
    if (!starter || !starter.isHost) return { error: "Начать может только хост." };
    for (const p of this.players.values()) p.score = 0;
    this.status = "playing";
    const ids = Array.from(this.players.keys());
    this.currentPlayerId = ids[Math.floor(Math.random() * ids.length)];
    this.lastLetter = null;
    this.used = new Set();
    this.history = [];
    this.winnerId = null;
    this.endReason = "";
    this.hintGiven = false;
    this.touch();
    this._restartTurnTimer();
    return { ok: true };
  }

  kickPlayer(hostId, targetId) {
    const host = this.players.get(hostId);
    if (!host || !host.isHost) return { error: "Только хост может исключать." };
    if (hostId === targetId) return { error: "Нельзя исключить самого себя." };
    const target = this.players.get(targetId);
    if (!target) return { error: "Игрок не найден." };
    this.kickedIds.add(targetId);
    return { ok: true, targetName: target.name };
  }

  playMove(playerId, rawCity) {
    if (this.status !== "playing") return { error: "Игра не идёт." };
    if (playerId !== this.currentPlayerId) return { error: "Сейчас не ваш ход." };
    const input = String(rawCity || "").trim();
    if (!input) return { error: "Введите название города." };

    if (!has(input)) {
      return { error: `Такого города нет в словаре — попробуйте другой.` };
    }

    const n = norm(input);
    if (this.used.has(n)) {
      return { error: `Город «${canonical(n)}» уже называли.` };
    }

    if (this.lastLetter && n[0] !== this.lastLetter) {
      return { error: `Нужен город на букву «${this.lastLetter.toUpperCase()}».` };
    }

    this.used.add(n);
    const pretty = canonical(n);
    const player = this.players.get(playerId);
    player.score += 1;
    this.history.push({ playerId, name: player.name, city: pretty, at: Date.now() });
    this.lastLetter = lastPlayableLetter(n);
    this.hintGiven = false;
    this.touch();

    if (!this.lastLetter) {
      this._finish(playerId, "Нет игровой буквы для ответа.");
      return { ok: true };
    }

    this._advanceTurn();
    this._restartTurnTimer();
    return { ok: true };
  }

  getHint() {
    if (!this.hints || !this.lastLetter) return null;
    const available = byLetter(this.lastLetter).filter(n => !this.used.has(n));
    if (available.length === 0) return null;
    const pick = available[Math.floor(Math.random() * available.length)];
    const display = canonical(pick) || pick;
    this.hintGiven = true;
    return display.slice(0, 2) + "…" + ` (${display.length} букв)`;
  }

  surrender(playerId) {
    if (this.status !== "playing") return { error: "Игра не идёт." };
    const p = this.players.get(playerId);
    if (!p) return { error: "Игрок не найден." };
    const others = Array.from(this.players.values()).filter((x) => x.id !== playerId);
    if (others.length === 0) return { error: "Нет других игроков." };
    const winner = others[0];
    this._finish(winner.id, `${p.name} сдался.`);
    return { ok: true };
  }

  _advanceTurn() {
    const ids = Array.from(this.players.keys());
    if (ids.length === 0) return;
    const idx = ids.indexOf(this.currentPlayerId);
    let next = (idx + 1) % ids.length;
    let attempts = 0;
    while (attempts < ids.length) {
      const p = this.players.get(ids[next]);
      if (p && p.connected) break;
      if (this.disconnectTimeout === 0) break;
      next = (next + 1) % ids.length;
      attempts++;
    }
    this.currentPlayerId = ids[next];
  }

  _restartTurnTimer() {
    this.clearTimer();
    if (this.turnTimer <= 0 || this.status !== "playing") return;
    this.turnStartedAt = Date.now();
    this.turnDeadline = this.turnStartedAt + this.turnTimer * 1000;
    this._timerInterval = setTimeout(() => {
      const p = this.players.get(this.currentPlayerId);
      if (p && this.status === "playing") {
        const others = Array.from(this.players.values()).filter(x => x.id !== this.currentPlayerId);
        if (others.length > 0) {
          this._finish(others[0].id, `У ${p.name} вышло время.`);
        }
      }
      if (this._onTimerExpire) this._onTimerExpire("turn", this.currentPlayerId);
    }, this.turnTimer * 1000);
    this._timerInterval.unref?.();
  }

  clearTimer() {
    if (this._timerInterval) { clearTimeout(this._timerInterval); this._timerInterval = null; }
    this.turnStartedAt = null;
    this.turnDeadline = null;
  }

  _finish(winnerId, reason) {
    this.status = "finished";
    this.winnerId = winnerId;
    this.endReason = reason;
    this.clearTimer();
  }

  snapshot() {
    return {
      code: this.code,
      hostName: this.hostName,
      maxPlayers: this.maxPlayers,
      isPrivate: this.isPrivate,
      status: this.status,
      currentPlayerId: this.currentPlayerId,
      lastLetter: this.lastLetter,
      winnerId: this.winnerId,
      endReason: this.endReason,
      turnTimer: this.turnTimer,
      turnDeadline: this.turnDeadline,
      hints: this.hints,
      hintGiven: this.hintGiven,
      disconnectTimeout: this.disconnectTimeout,
      autoStartDeadline: this.autoStartDeadline,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id, name: p.name, score: p.score, isHost: p.isHost, connected: p.connected,
        avatar: p.avatar || "🙂", color: p.color || "#6ea8ff",
      })),
      history: this.history,
    };
  }
}
