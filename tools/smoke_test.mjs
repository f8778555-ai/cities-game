/**
 * Smoke-тест серверной логики: ESM-импорт словаря + правил + комнат.
 * Проверяет, что partия из нескольких ходов между двумя игроками валидна.
 */
import { has, canonical, size } from "../server/cities_db.mjs";
import { lastPlayableLetter } from "../server/rules.mjs";
import { RoomManager } from "../server/rooms.mjs";

function assert(cond, msg) {
  if (!cond) { console.error("✗", msg); process.exit(1); }
  console.log("✓", msg);
}

console.log(`Cities DB: ${size()} записей`);
assert(has("Москва"), 'has("Москва") === true');
assert(has("москва"), 'has("москва") — case-insensitive');
assert(!has("Бла-бла-город"), "несуществующий город отбрасывается");
assert(canonical("МОСКВА") === "Москва", "canonical восстанавливает форму");
assert(lastPlayableLetter("Пермь") === "м", "Пермь → м (ь пропускается)");
assert(lastPlayableLetter("Сочи") === "и", "Сочи → и");
assert(lastPlayableLetter("Барнаул") === "л", "Барнаул → л");

// сценарий: 2 игрока
const rm = new RoomManager();
const room = rm.createRoom({ hostName: "Аня", maxPlayers: 2, isPrivate: false });
room.addPlayer({ id: "p1", name: "Аня" });
room.addPlayer({ id: "p2", name: "Боря" });

assert(room.start("p2").error, "начать может только хост");
const started = room.start("p1");
assert(started.ok, "хост начинает игру");

const first = room.currentPlayerId;
assert(first === "p1" || first === "p2", "первый ход — один из игроков");

// первый называет "Москва"
const bad = room.playMove(first, "Неизвестный-город");
assert(bad.error && bad.error.includes("нет в словаре"), "неизвестный город отклонён");

const ok1 = room.playMove(first, "Москва");
assert(ok1.ok, "Москва принята");
assert(room.lastLetter === "а", "последняя буква теперь 'а'");

const wrongLetter = room.playMove(room.currentPlayerId, "Пермь");
assert(wrongLetter.error && wrongLetter.error.includes("букву"), "слово не на ту букву отклоняется");

const ok2 = room.playMove(room.currentPlayerId, "Астрахань");
assert(ok2.ok, "Астрахань принята");

const dup = room.playMove(room.currentPlayerId, "Астрахань");
assert(dup.error && dup.error.includes("уже называли"), "повтор запрещён");

console.log("\nВсе проверки пройдены.");
