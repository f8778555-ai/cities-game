/**
 * Менеджер комнат для мультиплеера.
 *
 * Хранит все активные комнаты, валидирует игровые действия и оповещает слушателей
 * (WebSocket-сервер) об изменениях. Без внешних зависимостей.
 */
import { randomUUID } from "node:crypto";
import { has, canonical, norm } from "./cities_db.mjs";
import { lastPlayableLetter } from "./rules.mjs";

const MAX_PLAYERS_CAP = 8;
const MIN_PLAYERS = 2;
const CODE_LEN = 4;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // комната без игроков умирает через 10 минут
const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;   // комната без активности — через час

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
    this._listeners = new Set(); // функции onLobbyChange
    setInterval(() => this._sweep(), 30_000).unref?.();
  }

  onLobbyChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
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
        this.rooms.delete(code);
      } else if (now - room.lastActivityAt > IDLE_ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
    this._emitLobbyChange();
  }

  createRoom({ hostName, maxPlayers, isPrivate, password }) {
    const capacity = Math.min(MAX_PLAYERS_CAP, Math.max(MIN_PLAYERS, Number(maxPlayers) || 2));
    const room = new Room({
      code: this._uniqueCode(),
      hostName: String(hostName || "Игрок").slice(0, 24),
      maxPlayers: capacity,
      isPrivate: Boolean(isPrivate),
      password: isPrivate ? String(password || "").slice(0, 32) : "",
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
      });
    }
    return list.sort((a, b) => a.status === "waiting" ? -1 : 1);
  }

  get(code) { return this.rooms.get(String(code || "").toUpperCase()); }

  remove(code) { this.rooms.delete(code); this._emitLobbyChange(); }

  notifyLobby() { this._emitLobbyChange(); }
}

export class Room {
  constructor({ code, hostName, maxPlayers, isPrivate, password }) {
    this.code = code;
    this.hostName = hostName;
    this.maxPlayers = maxPlayers;
    this.isPrivate = isPrivate;
    this.password = password;
    /** @type {Map<string, Player>} id -> Player */
    this.players = new Map();
    /** @type {Array<{playerId:string,name:string,city:string,at:number}>} */
    this.history = [];
    /** @type {Set<string>} нормализованные имена сыгранных городов */
    this.used = new Set();
    this.lastLetter = null;
    /** @type {string|null} id текущего игрока (чей ход) */
    this.currentPlayerId = null;
    /** @type {"waiting"|"playing"|"finished"} */
    this.status = "waiting";
    this.winnerId = null;
    this.endReason = "";
    this.lastActivityAt = Date.now();
    this.createdAt = Date.now();
  }

  touch() { this.lastActivityAt = Date.now(); }

  checkPassword(pass) {
    if (!this.isPrivate) return true;
    return String(pass || "") === this.password;
  }

  isFull() { return this.players.size >= this.maxPlayers; }

  addPlayer({ id, name }) {
    const player = {
      id,
      name: String(name || "Игрок").slice(0, 24),
      score: 0,
      isHost: this.players.size === 0,
      connected: true,
    };
    this.players.set(id, player);
    this.touch();
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    // если отвалился хост — назначим нового
    if (p.isHost && this.players.size > 0) {
      const next = this.players.values().next().value;
      next.isHost = true;
      this.hostName = next.name;
    }
    // если игра идёт и остался 1 — автопобеда
    if (this.status === "playing" && this.players.size === 1) {
      const last = this.players.values().next().value;
      this._finish(last.id, `${p.name} покинул игру.`);
    } else if (this.status === "playing" && this.currentPlayerId === id) {
      this._advanceTurn();
    }
    this.touch();
  }

  start(byPlayerId) {
    if (this.status !== "waiting") return { error: "Игра уже запущена." };
    const starter = this.players.get(byPlayerId);
    if (!starter || !starter.isHost) return { error: "Начать может только хост." };
    if (this.players.size < MIN_PLAYERS) return { error: "Нужно минимум 2 игрока." };
    this.status = "playing";
    // Первый ход — случайный игрок.
    const ids = Array.from(this.players.keys());
    this.currentPlayerId = ids[Math.floor(Math.random() * ids.length)];
    this.lastLetter = null;
    this.used = new Set();
    this.history = [];
    this.winnerId = null;
    this.endReason = "";
    this.touch();
    return { ok: true };
  }

  /**
   * Попытка походить. Возвращает { ok, error?, letterHint? }.
   * Ошибки валидации возвращаются как { error: "..." }, и ход остаётся у текущего игрока.
   */
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
    this.touch();

    if (!this.lastLetter) {
      this._finish(playerId, "Нет игровой буквы для ответа.");
      return { ok: true };
    }

    this._advanceTurn();
    return { ok: true };
  }

  /** Игрок сдаётся. */
  surrender(playerId) {
    if (this.status !== "playing") return { error: "Игра не идёт." };
    const p = this.players.get(playerId);
    if (!p) return { error: "Игрок не найден." };
    // при сдаче побеждает следующий по очереди
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
    this.currentPlayerId = ids[(idx + 1) % ids.length];
  }

  _finish(winnerId, reason) {
    this.status = "finished";
    this.winnerId = winnerId;
    this.endReason = reason;
  }

  /** Снимок состояния для клиентов. */
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
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id, name: p.name, score: p.score, isHost: p.isHost, connected: p.connected,
      })),
      history: this.history,
    };
  }
}
