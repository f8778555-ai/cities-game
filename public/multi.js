/**
 * Клиент мультиплеера. Общается с сервером по WebSocket.
 * Сервер — источник истины: при любом :state от сервера просто перерисовываем UI.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // ── элементы UI ─────────────────────────────────────────────
  const lobbyScreen = $("lobbyScreen");
  const roomScreen  = $("roomScreen");
  const connStatus  = $("connStatus");

  const nameInput   = $("nameInput");
  const maxPlayers  = $("maxPlayers");
  const isPrivate   = $("isPrivate");
  const passwordInput = $("passwordInput");
  const createBtn   = $("createBtn");
  const refreshBtn  = $("refreshBtn");
  const roomsList   = $("roomsList");
  const codeInput   = $("codeInput");
  const codePassword = $("codePassword");
  const joinByCodeBtn = $("joinByCodeBtn");
  const lobbyMsg    = $("lobbyMsg");

  const roomCode    = $("roomCode");
  const roomStatus  = $("roomStatus");
  const mpLetter    = $("mpLetter");
  const turnIndicator = $("turnIndicator");
  const playersList = $("playersList");
  const mpFeed      = $("mpFeed");
  const mpForm      = $("mpForm");
  const mpInput     = $("mpInput");
  const mpSendBtn   = $("mpSendBtn");
  const mpMessage   = $("mpMessage");
  const startBtn    = $("startBtn");
  const surrenderBtn= $("surrenderBtn");
  const leaveBtn    = $("leaveBtn");

  // ── state ──────────────────────────────────────────────────
  const state = {
    ws: null,
    playerId: null,
    room: null,       // последний снапшот комнаты от сервера
    connected: false,
    reconnectAttempts: 0,
  };

  // загружаем имя из localStorage
  try {
    const saved = localStorage.getItem("cities:name");
    if (saved) nameInput.value = saved;
  } catch {}

  // ── helpers ────────────────────────────────────────────────
  function setConnStatus(ok, text) {
    state.connected = !!ok;
    connStatus.textContent = text || (ok ? "● онлайн" : "○ оффлайн");
    connStatus.className = "conn " + (ok ? "ok" : "off");
  }

  function showLobby() {
    lobbyScreen.classList.remove("hidden");
    roomScreen.classList.add("hidden");
  }
  function showRoom() {
    lobbyScreen.classList.add("hidden");
    roomScreen.classList.remove("hidden");
  }

  function setLobbyMsg(text, tone = "") {
    lobbyMsg.textContent = text || "";
    lobbyMsg.className = "message" + (tone ? " " + tone : "");
  }
  function setRoomMsg(text, tone = "") {
    mpMessage.textContent = text || "";
    mpMessage.className = "message" + (tone ? " " + tone : "");
  }

  function playerName() {
    return (nameInput.value || "").trim() || "Игрок";
  }

  // ── WebSocket ─────────────────────────────────────────────
  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws`;
    const ws = new WebSocket(url);
    state.ws = ws;
    setConnStatus(false, "соединение…");

    ws.onopen = () => {
      state.reconnectAttempts = 0;
      setConnStatus(true);
      send("lobby:list");
    };
    ws.onclose = () => {
      setConnStatus(false);
      state.reconnectAttempts += 1;
      const delay = Math.min(8000, 500 * 2 ** state.reconnectAttempts);
      setTimeout(connect, delay);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleServerMessage(msg);
    };
  }

  function send(type, payload = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ type, ...payload }));
  }

  // ── server messages ───────────────────────────────────────
  function handleServerMessage(msg) {
    switch (msg.type) {
      case "hello":
        state.playerId = msg.playerId;
        break;

      case "lobby:update":
        renderRooms(msg.rooms);
        break;

      case "room:joined":
        state.room = msg.room;
        state.playerId = msg.you || state.playerId;
        showRoom();
        setRoomMsg("");
        renderRoom();
        break;

      case "room:state":
        state.room = msg.room;
        renderRoom();
        break;

      case "move:invalid":
        setRoomMsg(msg.message, "error");
        break;

      case "room:left":
        state.room = null;
        showLobby();
        setLobbyMsg("Вы покинули комнату.");
        send("lobby:list");
        break;

      case "error":
        // в лобби или в комнате — показываем там, где актуально
        if (!roomScreen.classList.contains("hidden")) setRoomMsg(msg.message, "error");
        else setLobbyMsg(msg.message, "error");
        break;

      case "chat:message":
        addChatMessage(msg.name, msg.text, false);
        break;

      case "chat:system":
        addChatMessage("", msg.text, true);
        break;
    }
  }

  // ── lobby rendering ───────────────────────────────────────
  function renderRooms(list) {
    roomsList.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "hint-card";
      empty.textContent = "Пока нет открытых игр. Создайте первую!";
      roomsList.appendChild(empty);
      return;
    }
    for (const r of list) {
      const item = document.createElement("div");
      item.className = "room-item";
      item.innerHTML = `
        <div class="room-item-main">
          <div class="room-item-title">${escapeHtml(r.hostName)}</div>
          <div class="room-item-sub">
            <span class="pill">${r.players}/${r.maxPlayers}</span>
            <span class="pill ${r.status === 'waiting' ? 'ok' : ''}">
              ${r.status === 'waiting' ? 'Ожидание' : r.status === 'playing' ? 'Идёт' : 'Завершена'}
            </span>
            <span class="muted">код ${r.code}</span>
          </div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Войти";
      btn.disabled = r.status !== "waiting" || r.players >= r.maxPlayers;
      btn.addEventListener("click", () => {
        send("room:join", { code: r.code, name: playerName(), password: "" });
      });
      item.appendChild(btn);
      roomsList.appendChild(item);
    }
  }

  // ── room rendering ────────────────────────────────────────
  function renderRoom() {
    const r = state.room;
    if (!r) return;
    roomCode.textContent = r.code;

    const me = r.players.find((p) => p.id === state.playerId);
    const isMyTurn = r.status === "playing" && r.currentPlayerId === state.playerId;
    const current = r.players.find((p) => p.id === r.currentPlayerId);

    // статус
    if (r.status === "waiting") {
      roomStatus.textContent = `Ожидаем игроков — ${r.players.length}/${r.maxPlayers}`;
    } else if (r.status === "playing") {
      roomStatus.textContent = "Игра идёт";
    } else {
      const winner = r.players.find((p) => p.id === r.winnerId);
      roomStatus.textContent = winner
        ? `Победил ${winner.name}. ${r.endReason || ""}`
        : `Игра завершена. ${r.endReason || ""}`;
    }

    mpLetter.textContent = r.lastLetter ? r.lastLetter.toUpperCase() : "—";
    turnIndicator.textContent = r.status === "playing"
      ? (isMyTurn ? "Ваш ход" : `Ход: ${current ? current.name : "…"}`)
      : (r.status === "waiting" ? "Ожидание" : "Игра окончена");
    turnIndicator.className = "turn-indicator" + (isMyTurn ? " active" : "");

    // список игроков
    playersList.innerHTML = "";
    for (const p of r.players) {
      const el = document.createElement("div");
      el.className = "player-item" +
        (p.id === r.currentPlayerId && r.status === "playing" ? " current" : "") +
        (p.id === state.playerId ? " you" : "");
      el.innerHTML = `
        <span class="p-name">${escapeHtml(p.name)}${p.isHost ? " 👑" : ""}${p.id === state.playerId ? " (вы)" : ""}</span>
        <span class="p-score">${p.score}</span>
      `;
      playersList.appendChild(el);
    }

    // история ходов
    mpFeed.innerHTML = "";
    for (const h of r.history) {
      const b = document.createElement("div");
      const mine = h.playerId === state.playerId;
      b.className = "bubble " + (mine ? "you" : "ai");
      b.innerHTML = `<span class="meta">${escapeHtml(h.name)}</span><span>${escapeHtml(h.city)}</span>`;
      mpFeed.appendChild(b);
    }
    mpFeed.scrollTop = mpFeed.scrollHeight;

    // управление инпутом
    const canPlay = r.status === "playing" && isMyTurn;
    mpInput.disabled = !canPlay;
    mpSendBtn.disabled = !canPlay;
    if (canPlay) {
      setRoomMsg(r.lastLetter
        ? `Ваш ход — город на букву «${r.lastLetter.toUpperCase()}».`
        : "Ваш ход — назовите любой город.");
      setTimeout(() => mpInput.focus(), 0);
    } else if (r.status === "playing") {
      setRoomMsg("");
    }

    // кнопки
    const canStart = r.status === "waiting" && me && me.isHost && r.players.length >= 2;
    startBtn.classList.toggle("hidden", !canStart);
    surrenderBtn.classList.toggle("hidden", r.status !== "playing");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ── events: lobby ─────────────────────────────────────────
  isPrivate.addEventListener("change", () => {
    passwordInput.disabled = !isPrivate.checked;
    if (!isPrivate.checked) passwordInput.value = "";
    else passwordInput.focus();
  });

  nameInput.addEventListener("change", () => {
    try { localStorage.setItem("cities:name", playerName()); } catch {}
  });

  createBtn.addEventListener("click", () => {
    const name = playerName();
    if (isPrivate.checked && !passwordInput.value.trim()) {
      setLobbyMsg("Укажите пароль для закрытой комнаты.", "error");
      passwordInput.focus();
      return;
    }
    try { localStorage.setItem("cities:name", name); } catch {}
    send("room:create", {
      name,
      maxPlayers: Number(maxPlayers.value),
      isPrivate: isPrivate.checked,
      password: passwordInput.value.trim(),
    });
    setLobbyMsg("");
  });

  refreshBtn.addEventListener("click", () => send("lobby:list"));

  joinByCodeBtn.addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { setLobbyMsg("Введите код комнаты.", "error"); return; }
    send("room:join", {
      code,
      name: playerName(),
      password: codePassword.value.trim(),
    });
  });

  // ── events: room ──────────────────────────────────────────
  startBtn.addEventListener("click", () => send("room:start"));
  surrenderBtn.addEventListener("click", () => {
    if (confirm("Сдаться в этой партии?")) send("room:surrender");
  });
  leaveBtn.addEventListener("click", () => send("room:leave"));

  mpForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const city = mpInput.value.trim();
    if (!city) return;
    send("room:move", { city });
    mpInput.value = "";
    setRoomMsg("");
  });

  mpInput.addEventListener("input", () => {
    if (mpMessage.classList.contains("error")) setRoomMsg("");
  });

  // ── chat ──────────────────────────────────────────────────
  const chatToggle   = $("chatToggle");
  const chatBody     = $("chatBody");
  const chatMessages = $("chatMessages");
  const chatForm     = $("chatForm");
  const chatInput    = $("chatInput");
  const chatBadge    = $("chatBadge");
  const chatArrow    = $("chatArrow");

  let chatOpen = false;
  let unreadCount = 0;

  chatToggle.addEventListener("click", () => {
    chatOpen = !chatOpen;
    chatBody.classList.toggle("hidden", !chatOpen);
    chatArrow.textContent = chatOpen ? "▲" : "▼";
    if (chatOpen) {
      unreadCount = 0;
      chatBadge.classList.add("hidden");
      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.focus();
    }
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    send("chat:message", { text });
    chatInput.value = "";
  });

  function addChatMessage(name, text, isSystem) {
    const el = document.createElement("div");
    el.className = "chat-msg" + (isSystem ? " system" : "");
    if (isSystem) {
      el.textContent = text;
    } else {
      el.innerHTML = `<b>${escapeHtml(name)}</b>: ${escapeHtml(text)}`;
    }
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (!chatOpen) {
      unreadCount++;
      chatBadge.textContent = unreadCount > 99 ? "99+" : unreadCount;
      chatBadge.classList.remove("hidden");
    }
  }

  // ── init ──────────────────────────────────────────────────
  setConnStatus(false, "соединение…");
  connect();
})();
