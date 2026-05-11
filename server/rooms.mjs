/**
 * Менеджер комнат для мультиплеера.
 */
import { randomUUID } from "node:crypto";
import { has, canonical, norm, byLetter } from "./cities_db.mjs";
import { lastPlayableLetter } from "./rules.mjs";

const MAX_PLAYERS_CAP = 8;
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
    this._timerCallbacks = new Set(); // {roomCode, fn} для таймеров
    setInterval(() => this._sweep(), 30_000).unref?.();
  }

  onLobbyChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  notifyLobby() { this._emitLobbyChange(); }
  _emitLobbyChange() { for (const fn of this._listeners) try { fn(); } catch {} }

  onTimerTick(fn) { this._timerCallbacks.add(fn); }

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

  createRoom({ hostName, maxPlayers, isPrivate, password, turnTimer, hints, disconnectTimeout, totalRounds }) {
    const capacity = Math.min(MAX_PLAYERS_CAP, Math.max(MIN_PLAYERS, Number(maxPlayers) || 2));
    const room = new Room({
      code: this._uniqueCode(),
      hostName: String(hostName || "Игрок").slice(0, 24),
      maxPlayers: capacity,
      isPrivate: Boolean(isPrivate),
      password: isPrivate ? String(password || "").slice(0, 32) : "",
      turnTimer: Number(turnTimer) || 0, // 0 = без таймера, иначе секунды
      hints: Boolean(hints),
      disconnectTimeout: Number(disconnectTimeout) || 0, // 0 = бесконечно
      totalRounds: Math.max(1, Math.min(21, Number(totalRounds) || 1)),
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
        totalRounds: r.totalRounds,
        currentRound: r.currentRound,
      });
    }
    return list.sort((a, b) => a.status === "waiting" ? -1 : 1);
  }

  get(code) { return this.rooms.get(String(code || "").toUpperCase()); }
  remove(code) { const r = this.rooms.get(code); if (r) r.clearTimer(); this.rooms.delete(code); this._emitLobbyChange(); }
}

export class Room {
  constructor({ code, hostName, maxPlayers, isPrivate, password, turnTimer, hints, disconnectTimeout, totalRounds }) {
    this.code = code;
    this.hostName = hostName;
    this.maxPlayers = maxPlayers;
    this.isPrivate = isPrivate;
    this.password = password;
    this.turnTimer = turnTimer;
    this.hints = hints;
    this.disconnectTimeout = disconnectTimeout;
    this.totalRounds = totalRounds || 1; // всего партий в серии
    this.currentRound = 0; // 0 = не начато, 1..totalRounds
    /** @type {Map<string, number>} id -> wins (победы в сериии) */
    this.seriesWins = new Map();
    /** @type {Map<string, Player>} */
    this.players = new Map();
    this.history = [];
    this.used = new Set();
    this.lastLetter = null;
    this.currentPlayerId = null;
    this.status = "waiting"; // waiting | playing | finished (серия завершена) | roundEnd (партия завершена, ждём следующую)
    this.winnerId = null; // победитель текущей партии
    this.seriesWinnerId = null; // победитель серии
    this.endReason = "";
    this.lastActivityAt = Date.now();
    this.createdAt = Date.now();
    this.turnStartedAt = null;
    this.turnDeadline = null;
    this._timerInterval = null;
    this._onTimerExpire = null;
    this._disconnectTimers = new Map();
    this.hintGiven = false;
  }

  touch() { this.lastActivityAt = Date.now(); }

  checkPassword(pass) {
    if (!this.isPrivate) return true;
    return String(pass || "") === this.password;
  }

  isFull() { return this.players.size >= this.maxPlayers; }

  addPlayer({ id, name }) {
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      this._clearDisconnectTimer(id);
      this.touch();
      return existing;
    }
    const player = {
      id,
      name: String(name || "Игрок").slice(0, 24),
      score: 0,
      isHost: this.players.size === 0,
      connected: true,
    };
    this.players.set(id, player);
    if (!this.seriesWins.has(id)) this.seriesWins.set(id, 0);
    this.touch();
    return player;
  }

  /** Пометить игрока как отключённого (не удалять). */
  disconnectPlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    this.touch();

    if (this.status === "playing") {
      if (this.disconnectTimeout > 0) {
        // Запустить таймер ожидания
        this._startDisconnectTimer(id);
      }
      // Если это текущий ходящий и нет бесконечного ожидания — пропустить ход
      if (this.currentPlayerId === id && this.disconnectTimeout > 0) {
        // Таймер дисконнекта обработает
      }
    }

    // Если все отключились — не удаляем комнату, ждём
    if (this.status === "waiting") {
      // В ожидании — удалить игрока
      this.players.delete(id);
      if (p.isHost && this.players.size > 0) {
        const next = this.players.values().next().value;
        next.isHost = true;
        this.hostName = next.name;
      }
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
      // Все ушли кроме одного
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
    this.touch();
  }

  _connectedCount() {
    let c = 0;
    for (const p of this.players.values()) if (p.connected) c++;
    return c;
  }

  _startDisconnectTimer(id) {
    this._clearDisconnectTimer(id);
    if (this.disconnectTimeout <= 0) return; // бесконечно
    const timer = setTimeout(() => {
      // Время вышло — удалить игрока
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

  start(byPlayerId) {
    if (this.status !== "waiting") return { error: "Игра уже запущена." };
    const starter = this.players.get(byPlayerId);
    if (!starter || !starter.isHost) return { error: "Начать может только хост." };
    if (this.players.size < MIN_PLAYERS) return { error: "Нужно минимум 2 игрока." };
    // Сброс серии
    this.seriesWins = new Map();
    for (const id of this.players.keys()) this.seriesWins.set(id, 0);
    this.currentRound = 0;
    this.seriesWinnerId = null;
    this._startRound();
    this.touch();
    return { ok: true };
  }

  /** Начать следующую партию в серии. */
  _startRound() {
    this.currentRound++;
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
  }

  /** Начать следующую партию (по команде хоста). */
  nextRound(byPlayerId) {
    if (this.status !== "roundEnd") return { error: "Партия ещё не завершена." };
    const starter = this.players.get(byPlayerId);
    if (!starter || !starter.isHost) return { error: "Начать может только хост." };
    if (this.currentRound >= this.totalRounds) return { error: "Серия завершена." };
    this._startRound();
    this.touch();
    return { ok: true };
  }

  /** Реванш — начать новую серию. */
  rematch(byPlayerId) {
    if (this.status !== "finished") return { error: "Серия ещё не завершена." };
    const starter = this.players.get(byPlayerId);
    if (!starter || !starter.isHost) return { error: "Начать может только хост." };
    // Сброс серии
    this.seriesWins = new Map();
    for (const id of this.players.keys()) this.seriesWins.set(id, 0);
    this.currentRound = 0;
    this.seriesWinnerId = null;
    this._startRound();
    this.touch();
    return { ok: true };
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

  /** Получить подсказку — первые 2 буквы случайного подходящего города. */
  getHint() {
    if (!this.hints || !this.lastLetter) return null;
    const available = byLetter(this.lastLetter).filter(n => !this.used.has(n));
    if (available.length === 0) return null;
    const pick = available[Math.floor(Math.random() * available.length)];
    const display = canonical(pick) || pick;
    this.hintGiven = true;
    // Показать первые 2 буквы + длину
    const hint = display.slice(0, 2) + "…" + ` (${display.length} букв)`;
    return hint;
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
    // Пропускаем отключённых (если disconnectTimeout = 0, не пропускаем)
    let next = (idx + 1) % ids.length;
    let attempts = 0;
    while (attempts < ids.length) {
      const p = this.players.get(ids[next]);
      if (p && p.connected) break;
      if (this.disconnectTimeout === 0) break; // бесконечное ожидание — не пропускаем
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
      // Время вышло — текущий игрок проигрывает
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
    // Записываем победу в серии
    if (winnerId) {
      const wins = (this.seriesWins.get(winnerId) || 0) + 1;
      this.seriesWins.set(winnerId, wins);
    }
    this.winnerId = winnerId;
    this.endReason = reason;
    this.clearTimer();

    // Проверяем, завершена ли серия
    const maxWins = Math.max(...this.seriesWins.values(), 0);
    const winsToClinch = Math.ceil(this.totalRounds / 2); // Чтобы выиграть серию из N нужно >N/2 побед (но не больше N)
    const allRoundsPlayed = this.currentRound >= this.totalRounds;

    if (maxWins >= winsToClinch && this.totalRounds > 1 || allRoundsPlayed || this.totalRounds === 1) {
      // Серия завершена
      // Найдём победителя серии (с наибольшим числом побед)
      let best = null, bestWins = -1;
      for (const [id, wins] of this.seriesWins) {
        if (wins > bestWins) { bestWins = wins; best = id; }
      }
      this.seriesWinnerId = best;
      this.status = "finished";
    } else {
      // Ещё есть партии — ждём следующую
      this.status = "roundEnd";
    }
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
      seriesWinnerId: this.seriesWinnerId,
      endReason: this.endReason,
      turnTimer: this.turnTimer,
      turnDeadline: this.turnDeadline,
      hints: this.hints,
      hintGiven: this.hintGiven,
      disconnectTimeout: this.disconnectTimeout,
      totalRounds: this.totalRounds,
      currentRound: this.currentRound,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id, name: p.name, score: p.score, isHost: p.isHost, connected: p.connected,
        seriesWins: this.seriesWins.get(p.id) || 0,
      })),
      history: this.history,
    };
  }
}
