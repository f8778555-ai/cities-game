/**
 * Игровая логика и UI-связка.
 *
 * Правила:
 *   • Первый ход — за игроком, с любой буквы.
 *   • Следующий город должен начинаться на последнюю «игровую» букву предыдущего
 *     (буквы ъ ь ы й на конце пропускаются).
 *   • Повторять города нельзя.
 *   • Если сторона не может ответить — поражение.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const feedEl      = $("feed");
  const introEl     = $("intro");
  const inputEl     = $("input");
  const formEl      = $("form");
  const sendBtn     = $("sendBtn");
  const hintBtn     = $("hintBtn");
  const restartBtn  = $("restart");
  const diffEl      = $("difficulty");
  const messageEl   = $("message");
  const nextLetterEl = $("nextLetter");
  const scoreYouEl  = $("scoreYou");
  const scoreAiEl   = $("scoreAi");

  const state = {
    used: new Set(),       // нормализованные названия
    lastLetter: null,      // какая буква нужна следующему ходу
    turn: "you",           // "you" | "ai"
    finished: false,
    scoreYou: 0,
    scoreAi: 0,
    difficulty: "medium",
    thinking: false,
  };

  // ── UI helpers ──────────────────────────────────────────────
  function scrollFeed() {
    requestAnimationFrame(() => {
      feedEl.scrollTop = feedEl.scrollHeight;
    });
  }

  function addBubble(text, who, meta) {
    const el = document.createElement("div");
    el.className = `bubble ${who}`;
    if (meta) {
      const m = document.createElement("span");
      m.className = "meta";
      m.textContent = meta;
      el.appendChild(m);
    }
    const t = document.createElement("span");
    t.textContent = text;
    el.appendChild(t);
    feedEl.appendChild(el);
    scrollFeed();
  }

  function addSystem(text) {
    const el = document.createElement("div");
    el.className = "bubble system";
    el.textContent = text;
    feedEl.appendChild(el);
    scrollFeed();
  }

  function setMessage(text, tone = "") {
    messageEl.textContent = text || "";
    messageEl.className = "message" + (tone ? " " + tone : "");
  }

  function updateHeader() {
    nextLetterEl.textContent = state.lastLetter ? state.lastLetter.toUpperCase() : "—";
    scoreYouEl.textContent = String(state.scoreYou);
    scoreAiEl.textContent = String(state.scoreAi);
  }

  function setInputEnabled(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    hintBtn.disabled = !enabled;
  }

  // ── Game logic ──────────────────────────────────────────────
  function resetGame() {
    state.used = new Set();
    state.lastLetter = null;
    state.turn = "you";
    state.finished = false;
    state.thinking = false;
    state.difficulty = diffEl.value;

    feedEl.innerHTML = "";
    feedEl.appendChild(introEl);
    updateHeader();
    setMessage("Ваш ход — назовите любой город.");
    setInputEnabled(true);
    inputEl.value = "";
    inputEl.focus();
  }

  function endGame(winner, reason) {
    state.finished = true;
    setInputEnabled(false);
    if (winner === "you") {
      state.scoreYou += 1;
      updateHeader();
      addSystem(`🏆 Победа! ${reason}`);
      setMessage("Вы выиграли. Нажмите ↻ для новой игры.", "ok");
    } else {
      state.scoreAi += 1;
      updateHeader();
      addSystem(`💀 Поражение. ${reason}`);
      setMessage("Нажмите ↻ для новой игры.", "error");
    }
  }

  function validatePlayerMove(raw) {
    const input = (raw || "").trim();
    if (!input) return { ok: false, reason: "Введите название города." };

    if (!CitiesDB.has(input)) {
      return { ok: false, reason: `Города «${input}» нет в словаре.` };
    }

    const n = CitiesDB.norm(input);

    if (state.used.has(n)) {
      return { ok: false, reason: `Город «${CitiesDB.canonical(n)}» уже называли.` };
    }

    if (state.lastLetter) {
      const first = n[0];
      if (first !== state.lastLetter) {
        return {
          ok: false,
          reason: `Нужен город на букву «${state.lastLetter.toUpperCase()}».`,
        };
      }
    }

    return { ok: true, normalized: n };
  }

  function playerMove(raw) {
    if (state.finished || state.thinking || state.turn !== "you") return;

    const check = validatePlayerMove(raw);
    if (!check.ok) {
      setMessage(check.reason, "error");
      return;
    }

    const n = check.normalized;
    const canonical = CitiesDB.canonical(n);
    state.used.add(n);
    state.lastLetter = CitiesAI.lastPlayableLetter(n);
    addBubble(canonical, "you", "Вы");

    inputEl.value = "";
    setMessage("");

    // спрячем интро после первого хода
    if (introEl.parentNode) introEl.remove();

    // проверим, может ли ИИ ответить
    if (!state.lastLetter) {
      // крайне маловероятно: слово состоит только из служебных букв
      endGame("you", "ИИ не может продолжить — нет игровой буквы.");
      return;
    }

    updateHeader();
    state.turn = "ai";
    aiMove();
  }

  function aiMove() {
    if (state.finished) return;
    state.thinking = true;
    setInputEnabled(false);
    setMessage("ИИ думает…");

    const delay = 400 + Math.random() * 500;
    setTimeout(() => {
      const pick = CitiesAI.chooseMove(state.lastLetter, state.used, state.difficulty);

      if (!pick) {
        endGame("you", `ИИ не знает города на букву «${state.lastLetter.toUpperCase()}».`);
        return;
      }

      state.used.add(pick);
      state.lastLetter = CitiesAI.lastPlayableLetter(pick);
      addBubble(CitiesDB.canonical(pick), "ai", "ИИ");

      if (!state.lastLetter) {
        endGame("ai", "Нет буквы для ответа.");
        return;
      }

      // если у игрока не осталось вариантов — конец
      const replies = CitiesAI.remainingCountFor(state.lastLetter, state.used);
      if (replies === 0) {
        endGame("ai", `В словаре не осталось городов на букву «${state.lastLetter.toUpperCase()}».`);
        return;
      }

      state.turn = "you";
      state.thinking = false;
      setInputEnabled(true);
      updateHeader();
      setMessage(`Ваш ход — город на букву «${state.lastLetter.toUpperCase()}».`);
      inputEl.focus();
    }, delay);
  }

  function giveHint() {
    if (state.finished || state.turn !== "you") return;

    const letter = state.lastLetter;
    if (!letter) {
      setMessage("Назовите любой город для первого хода.");
      return;
    }
    const suggestion = CitiesAI.suggestForPlayer(letter, state.used);
    if (!suggestion) {
      setMessage(`В словаре не осталось городов на «${letter.toUpperCase()}».`, "error");
      return;
    }
    inputEl.value = CitiesDB.canonical(suggestion);
    inputEl.focus();
    setMessage("Подсказка: нажмите «Ход», чтобы принять.");
  }

  // ── Events ──────────────────────────────────────────────────
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    playerMove(inputEl.value);
  });

  restartBtn.addEventListener("click", resetGame);

  diffEl.addEventListener("change", () => {
    state.difficulty = diffEl.value;
    setMessage(`Сложность: ${diffEl.options[diffEl.selectedIndex].text}. Нажмите ↻ для новой партии.`);
  });

  hintBtn.addEventListener("click", giveHint);

  inputEl.addEventListener("input", () => {
    if (messageEl.classList.contains("error")) setMessage("");
  });

  // init
  resetGame();
  console.log(`Cities DB loaded: ${CitiesDB.size()} entries`);
})();
