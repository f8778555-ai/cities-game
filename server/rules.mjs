/**
 * Общие правила игры «Города».
 */
import { norm } from "./cities_db.mjs";

const SKIP_END = new Set(["ъ", "ь", "ы", "й"]);

/** Последняя «игровая» буква слова: ъ/ь/ы/й на конце пропускаются. */
export function lastPlayableLetter(name) {
  const s = norm(name);
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (!/[а-яё]/i.test(ch)) continue;
    if (SKIP_END.has(ch)) continue;
    return ch;
  }
  return null;
}
