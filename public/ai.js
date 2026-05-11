/**
 * ИИ для игры в «Города».
 *
 * Стратегия:
 *   1. Из словаря берём все города, начинающиеся на нужную букву и ещё не использованные.
 *   2. Для каждого кандидата считаем «последнюю игровую букву» (с учётом правил ъ/ь/ы/й).
 *   3. Оценка кандидата = -(сколько ответных вариантов остаётся у соперника на этой букве).
 *      То есть ИИ старается оставить соперника с наименьшим числом ходов.
 *   4. Сложность меняет «жадность» выбора:
 *        easy   — случайный ход,
 *        medium — топ-30% по оценке,
 *        hard   — лучший ход (+ ловушки на «мёртвые» буквы).
 */
(function (global) {
  // Буквы, которые на конце слова не считаются игровыми — берём предпоследнюю.
  const SKIP_END = new Set(["ъ", "ь", "ы", "й"]);

  function lastPlayableLetter(name) {
    const s = CitiesDB.norm(name);
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (!/[а-яё]/i.test(ch)) continue;
      if (SKIP_END.has(ch)) continue;
      return ch;
    }
    return null;
  }

  // Кол-во неиспользованных городов на букву (для оценки хода)
  function remainingCountFor(letter, used) {
    if (!letter) return 0;
    const all = CitiesDB.byLetter(letter);
    let count = 0;
    for (const c of all) if (!used.has(c)) count++;
    return count;
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * @param {string} letter   буква, с которой должен начинаться ход ИИ
   * @param {Set<string>} used нормализованные имена уже сыгранных городов
   * @param {"easy"|"medium"|"hard"} level
   * @returns {string|null}   нормализованное имя выбранного города или null (ИИ сдаётся)
   */
  function chooseMove(letter, used, level = "medium") {
    const candidates = CitiesDB.byLetter(letter).filter((c) => !used.has(c));
    if (candidates.length === 0) return null;

    if (level === "easy") {
      return pickRandom(candidates);
    }

    // Оцениваем каждый вариант: чем меньше ответов у соперника, тем лучше.
    const scored = candidates.map((city) => {
      const next = lastPlayableLetter(city);
      // имитируем использование city
      const simulatedUsed = used; // прокси: одного города достаточно для оценки
      // Размер множества ответов противника (без учёта только что сыгранного — он уже из списка выкинут идентично)
      const replyCount = next ? CitiesDB.byLetter(next).filter(c => c !== city && !simulatedUsed.has(c)).length : 0;
      return { city, next, replyCount };
    });

    // На hard: предпочитаем ходы, заканчивающиеся на «редкую» букву (ловушки).
    if (level === "hard") {
      scored.sort((a, b) => a.replyCount - b.replyCount);
      // немного разнообразия: если есть несколько равноценно хороших — берём случайный из топ-3
      const best = scored[0].replyCount;
      const topTier = scored.filter((s) => s.replyCount === best);
      return pickRandom(topTier).city;
    }

    // medium: берём случайный город из верхних 30% по «коварности»
    scored.sort((a, b) => a.replyCount - b.replyCount);
    const cutoff = Math.max(1, Math.ceil(scored.length * 0.3));
    const top = scored.slice(0, cutoff);
    return pickRandom(top).city;
  }

  /** Подсказка игроку: просто любой город, который ещё не сыгран. */
  function suggestForPlayer(letter, used) {
    const candidates = CitiesDB.byLetter(letter).filter((c) => !used.has(c));
    if (candidates.length === 0) return null;
    return pickRandom(candidates);
  }

  global.CitiesAI = {
    chooseMove,
    suggestForPlayer,
    lastPlayableLetter,
    remainingCountFor,
  };
})(window);
