/**
 * Клиент мультиплеера — чат, таймер, подсказки, реванш, эмодзи, звуки.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // ── UI elements ─────────────────────────────────────────
  const lobbyScreen = $("lobbyScreen"), roomScreen = $("roomScreen"), connStatus = $("connStatus");
  const nameInput = $("nameInput"), maxPlayers = $("maxPlayers"), isPrivate = $("isPrivate");
  const passwordInput = $("passwordInput"), createBtn = $("createBtn"), refreshBtn = $("refreshBtn");
  const roomsList = $("roomsList"), codeInput = $("codeInput"), codePassword = $("codePassword");
  const joinByCodeBtn = $("joinByCodeBtn"), lobbyMsg = $("lobbyMsg");
  const turnTimer = $("turnTimer"), hintsCheck = $("hintsCheck"), disconnectTimeout = $("disconnectTimeout");
  const totalRounds = $("totalRounds");
  const roomCode = $("roomCode"), roomStatus = $("roomStatus"), mpLetter = $("mpLetter");
  const roundInfo = $("roundInfo");
  const timerDisplay = $("timerDisplay"), turnIndicator = $("turnIndicator");
  const playersList = $("playersList"), mpFeed = $("mpFeed");
  const mpForm = $("mpForm"), mpInput = $("mpInput"), mpSendBtn = $("mpSendBtn"), mpMessage = $("mpMessage");
  const startBtn = $("startBtn"), rematchBtn = $("rematchBtn"), surrenderBtn = $("surrenderBtn");
  const nextRoundBtn = $("nextRoundBtn");
  const leaveBtn = $("leaveBtn"), shareBtn = $("shareBtn"), hintBtn = $("hintBtn");
  const chatToggle = $("chatToggle"), chatBody = $("chatBody"), chatMessages = $("chatMessages");
  const chatForm = $("chatForm"), chatInput = $("chatInput"), chatBadge = $("chatBadge"), chatArrow = $("chatArrow");
  const emojiFloats = $("emojiFloats");

  // ── state ──────────────────────────────────────────────
  const state = { ws: null, playerId: null, room: null, connected: false, reconnectAttempts: 0 };
  let chatOpen = false, unreadCount = 0, timerInterval = null;

  try { const saved = localStorage.getItem("cities:name"); if (saved) nameInput.value = saved; } catch {}

  // ── sounds ─────────────────────────────────────────────
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  function ensureAudio() { if (!audioCtx) audioCtx = new AudioCtx(); }
  function playTone(freq, dur, type = "sine") {
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  function soundMove() { playTone(600, 0.1); }
  function soundYourTurn() { playTone(880, 0.15); setTimeout(() => playTone(1100, 0.15), 160); }
  function soundWin() { playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 150); setTimeout(() => playTone(784, 0.3), 300); }
  function soundLose() { playTone(300, 0.3, "sawtooth"); }
  function soundTimer() { playTone(440, 0.05); }

  // ── helpers ────────────────────────────────────────────
  function setConnStatus(ok, text) {
    state.connected = !!ok;
    connStatus.textContent = text || (ok ? "● онлайн" : "○ оффлайн");
    connStatus.className = "conn " + (ok ? "ok" : "off");
  }
  function showLobby() { lobbyScreen.classList.remove("hidden"); roomScreen.classList.add("hidden"); stopTimer(); }
  function showRoom() { lobbyScreen.classList.add("hidden"); roomScreen.classList.remove("hidden"); }
  function setLobbyMsg(t, tone = "") { lobbyMsg.textContent = t || ""; lobbyMsg.className = "message" + (tone ? " " + tone : ""); }
  function setRoomMsg(t, tone = "") { mpMessage.textContent = t || ""; mpMessage.className = "message" + (tone ? " " + tone : ""); }
  function playerName() { return (nameInput.value || "").trim() || "Игрок"; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  // ── Timer ──────────────────────────────────────────────
  function startTimer(deadline) {
    stopTimer();
    if (!deadline) { timerDisplay.classList.add("hidden"); return; }
    timerDisplay.classList.remove("hidden");
    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      timerDisplay.textContent = left + "с";
      timerDisplay.classList.toggle("urgent", left <= 10);
      if (left <= 5 && left > 0) soundTimer();
      if (left <= 0) stopTimer();
    };
    update();
    timerInterval = setInterval(update, 1000);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } timerDisplay.classList.add("hidden"); }

  // ── WebSocket ─────────────────────────────────────────
  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    state.ws = ws;
    setConnStatus(false, "соединение…");
    ws.onopen = () => { state.reconnectAttempts = 0; setConnStatus(true); send("lobby:list"); autoJoinFromUrl(); };
    ws.onclose = () => { setConnStatus(false); state.reconnectAttempts++; setTimeout(connect, Math.min(8000, 500 * 2 ** state.reconnectAttempts)); };
    ws.onerror = () => {};
    ws.onmessage = (ev) => { try { handleServerMessage(JSON.parse(ev.data)); } catch {} };
  }
  function send(type, payload = {}) { if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type, ...payload })); }

  // ── Auto-join from URL ─────────────────────────────────
  function autoJoinFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code) {
      send("room:join", { code: code.toUpperCase(), name: playerName(), password: "" });
      history.replaceState(null, "", location.pathname); // clean URL
    }
  }

  // ── server messages ───────────────────────────────────
  function handleServerMessage(msg) {
    switch (msg.type) {
      case "hello": state.playerId = msg.playerId; break;
      case "lobby:update": renderRooms(msg.rooms); break;
      case "room:joined":
        state.room = msg.room; state.playerId = msg.you || state.playerId;
        showRoom(); setRoomMsg(""); renderRoom(); break;
      case "room:state": {
        const wasMyTurn = state.room && state.room.currentPlayerId === state.playerId && state.room.status === "playing";
        const prevStatus = state.room?.status;
        state.room = msg.room;
        renderRoom();
        const isMyTurn = msg.room.currentPlayerId === state.playerId && msg.room.status === "playing";
        if (isMyTurn && !wasMyTurn) soundYourTurn();
        else if (!isMyTurn && wasMyTurn) soundMove();
        // Звуки конца партии/серии
        if (msg.room.status === "finished" && prevStatus !== "finished") {
          if (msg.room.seriesWinnerId === state.playerId) soundWin(); else soundLose();
        } else if (msg.room.status === "roundEnd" && prevStatus === "playing") {
          if (msg.room.winnerId === state.playerId) playTone(700, 0.15); else playTone(400, 0.15);
        }
        break;
      }
      case "move:invalid": setRoomMsg(msg.message, "error"); break;
      case "room:left": state.room = null; showLobby(); setLobbyMsg("Вы покинули комнату."); send("lobby:list"); break;
      case "room:hint": setRoomMsg(`💡 Подсказка: ${msg.hint}`, "ok"); break;
      case "error":
        if (!roomScreen.classList.contains("hidden")) setRoomMsg(msg.message, "error");
        else setLobbyMsg(msg.message, "error");
        break;
      case "chat:message": addChatMessage(msg.name, msg.text, false); break;
      case "chat:system": addChatMessage("", msg.text, true); break;
      case "chat:emoji": showFloatingEmoji(msg.emoji, msg.name); break;
    }
  }

  // ── lobby rendering ───────────────────────────────────
  function renderRooms(list) {
    roomsList.innerHTML = "";
    if (!list.length) { roomsList.innerHTML = '<div class="hint-card">Пока нет открытых игр. Создайте первую!</div>'; return; }
    for (const r of list) {
      const item = document.createElement("div");
      item.className = "room-item";
      const timerLabel = r.turnTimer ? ` ⏱${r.turnTimer}с` : "";
      const roundsLabel = r.totalRounds > 1 ? ` 🏆${r.totalRounds}` : "";
      item.innerHTML = `<div class="room-item-main"><div class="room-item-title">${escapeHtml(r.hostName)}</div><div class="room-item-sub"><span class="pill">${r.players}/${r.maxPlayers}</span><span class="pill ${r.status==='waiting'?'ok':''}">${r.status==='waiting'?'Ожидание':r.status==='playing'?'Идёт':'Завершена'}</span>${timerLabel}${roundsLabel}<span class="muted">код ${r.code}</span></div></div>`;
      const btn = document.createElement("button");
      btn.className = "btn btn-primary"; btn.textContent = "Войти";
      btn.disabled = r.status !== "waiting" || r.players >= r.maxPlayers;
      btn.addEventListener("click", () => send("room:join", { code: r.code, name: playerName(), password: "" }));
      item.appendChild(btn);
      roomsList.appendChild(item);
    }
  }

  // ── room rendering ────────────────────────────────────
  function renderRoom() {
    const r = state.room; if (!r) return;
    roomCode.textContent = r.code;
    const me = r.players.find(p => p.id === state.playerId);
    const isMyTurn = r.status === "playing" && r.currentPlayerId === state.playerId;
    const current = r.players.find(p => p.id === r.currentPlayerId);

    // Round info (серия)
    if (r.totalRounds > 1 && r.currentRound > 0) {
      roundInfo.classList.remove("hidden");
      roundInfo.textContent = `Партия ${r.currentRound} из ${r.totalRounds}`;
    } else {
      roundInfo.classList.add("hidden");
    }

    // Статус
    if (r.status === "waiting") {
      const seriesHint = r.totalRounds > 1 ? ` (серия до ${Math.ceil(r.totalRounds/2)} побед)` : "";
      roomStatus.textContent = `Ожидаем игроков — ${r.players.length}/${r.maxPlayers}${seriesHint}`;
    } else if (r.status === "playing") {
      roomStatus.textContent = "Игра идёт";
    } else if (r.status === "roundEnd") {
      const w = r.players.find(p => p.id === r.winnerId);
      roomStatus.textContent = w ? `Партию выиграл ${w.name}. ${r.endReason || ""}` : `Партия завершена. ${r.endReason || ""}`;
    } else { // finished
      const w = r.players.find(p => p.id === r.seriesWinnerId);
      roomStatus.textContent = w ? `🏆 ${w.name} — победитель серии!` : `Серия завершена. ${r.endReason || ""}`;
    }

    mpLetter.textContent = r.lastLetter ? r.lastLetter.toUpperCase() : "—";
    turnIndicator.textContent = r.status === "playing" ? (isMyTurn ? "Ваш ход" : `Ход: ${current?current.name:"…"}`) : (r.status === "waiting" ? "Ожидание" : r.status === "roundEnd" ? "Партия окончена" : "Серия окончена");
    turnIndicator.className = "turn-indicator" + (isMyTurn ? " active" : "");

    // Timer
    if (r.status === "playing" && r.turnDeadline) startTimer(r.turnDeadline);
    else stopTimer();

    // Players (показываем seriesWins если серия >1)
    playersList.innerHTML = "";
    for (const p of r.players) {
      const el = document.createElement("div");
      el.className = "player-item" + (p.id === r.currentPlayerId && r.status === "playing" ? " current" : "") + (p.id === state.playerId ? " you" : "") + (!p.connected ? " disconnected" : "");
      const seriesLabel = r.totalRounds > 1 ? ` <span class="p-series">${p.seriesWins || 0}🏆</span>` : "";
      el.innerHTML = `<span class="p-name">${escapeHtml(p.name)}${p.isHost?" 👑":""}${p.id===state.playerId?" (вы)":""}${!p.connected?" ⚡":"" }</span>${seriesLabel}<span class="p-score">${p.score}</span>`;
      playersList.appendChild(el);
    }

    // History
    mpFeed.innerHTML = "";
    for (const h of r.history) {
      const b = document.createElement("div");
      b.className = "bubble " + (h.playerId === state.playerId ? "you" : "ai");
      b.innerHTML = `<span class="meta">${escapeHtml(h.name)}</span><span>${escapeHtml(h.city)}</span>`;
      mpFeed.appendChild(b);
    }
    mpFeed.scrollTop = mpFeed.scrollHeight;

    // Input
    const canPlay = r.status === "playing" && isMyTurn;
    mpInput.disabled = !canPlay; mpSendBtn.disabled = !canPlay;
    if (canPlay) {
      setRoomMsg(r.lastLetter ? `Ваш ход — город на «${r.lastLetter.toUpperCase()}».` : "Ваш ход — любой город.");
      setTimeout(() => mpInput.focus(), 0);
    } else if (r.status === "playing") setRoomMsg("");

    // Hint button
    hintBtn.classList.toggle("hidden", !(canPlay && r.hints && !r.hintGiven && r.lastLetter));

    // Buttons
    const canStart = r.status === "waiting" && me && me.isHost && r.players.length >= 2;
    startBtn.classList.toggle("hidden", !canStart);
    nextRoundBtn.classList.toggle("hidden", !(r.status === "roundEnd" && me && me.isHost));
    rematchBtn.classList.toggle("hidden", !(r.status === "finished" && me && me.isHost));
    surrenderBtn.classList.toggle("hidden", r.status !== "playing");
  }

  // ── Chat ──────────────────────────────────────────────
  chatToggle.addEventListener("click", () => {
    chatOpen = !chatOpen;
    chatBody.classList.toggle("hidden", !chatOpen);
    chatArrow.textContent = chatOpen ? "▲" : "▼";
    if (chatOpen) { unreadCount = 0; chatBadge.classList.add("hidden"); chatMessages.scrollTop = chatMessages.scrollHeight; chatInput.focus(); }
  });
  chatForm.addEventListener("submit", (e) => { e.preventDefault(); const t = chatInput.value.trim(); if (!t) return; send("chat:message", { text: t }); chatInput.value = ""; });
  function addChatMessage(name, text, isSystem) {
    const el = document.createElement("div");
    el.className = "chat-msg" + (isSystem ? " system" : "");
    el.innerHTML = isSystem ? text : `<b>${escapeHtml(name)}</b>: ${escapeHtml(text)}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (!chatOpen) { unreadCount++; chatBadge.textContent = unreadCount > 99 ? "99+" : unreadCount; chatBadge.classList.remove("hidden"); }
  }

  // ── Emoji reactions ───────────────────────────────────
  document.querySelectorAll(".emoji-btn").forEach(btn => {
    btn.addEventListener("click", () => { send("chat:emoji", { emoji: btn.dataset.emoji }); });
  });
  function showFloatingEmoji(emoji, name) {
    const el = document.createElement("div");
    el.className = "emoji-float";
    el.textContent = emoji;
    el.style.left = Math.random() * 80 + 10 + "%";
    emojiFloats.appendChild(el);
    setTimeout(() => el.remove(), 2000);
    addChatMessage("", `${name} ${emoji}`, true);
  }

  // ── Events: lobby ─────────────────────────────────────
  isPrivate.addEventListener("change", () => { passwordInput.disabled = !isPrivate.checked; if (!isPrivate.checked) passwordInput.value = ""; else passwordInput.focus(); });
  nameInput.addEventListener("change", () => { try { localStorage.setItem("cities:name", playerName()); } catch {} });
  createBtn.addEventListener("click", () => {
    const name = playerName();
    if (isPrivate.checked && !passwordInput.value.trim()) { setLobbyMsg("Укажите пароль.", "error"); passwordInput.focus(); return; }
    try { localStorage.setItem("cities:name", name); } catch {}
    send("room:create", {
      name, maxPlayers: Number(maxPlayers.value), isPrivate: isPrivate.checked,
      password: passwordInput.value.trim(), turnTimer: Number(turnTimer.value),
      hints: hintsCheck.checked, disconnectTimeout: Number(disconnectTimeout.value),
      totalRounds: Number(totalRounds.value),
    });
    setLobbyMsg("");
  });
  refreshBtn.addEventListener("click", () => send("lobby:list"));
  joinByCodeBtn.addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { setLobbyMsg("Введите код.", "error"); return; }
    send("room:join", { code, name: playerName(), password: codePassword.value.trim() });
  });

  // ── Events: room ──────────────────────────────────────
  startBtn.addEventListener("click", () => send("room:start"));
  rematchBtn.addEventListener("click", () => send("room:rematch"));
  nextRoundBtn.addEventListener("click", () => send("room:nextRound"));
  surrenderBtn.addEventListener("click", () => { if (confirm("Сдаться?")) send("room:surrender"); });
  leaveBtn.addEventListener("click", () => send("room:leave"));
  hintBtn.addEventListener("click", () => send("room:hint"));
  shareBtn.addEventListener("click", () => {
    const url = `${location.origin}/multi?code=${state.room?.code || ""}`;
    if (navigator.share) { navigator.share({ title: "Города — присоединяйся!", url }); }
    else { navigator.clipboard.writeText(url).then(() => setRoomMsg("Ссылка скопирована!", "ok")); }
  });
  mpForm.addEventListener("submit", (e) => { e.preventDefault(); const c = mpInput.value.trim(); if (!c) return; send("room:move", { city: c }); mpInput.value = ""; setRoomMsg(""); });
  mpInput.addEventListener("input", () => { if (mpMessage.classList.contains("error")) setRoomMsg(""); });

  // ── init ──────────────────────────────────────────────
  setConnStatus(false, "соединение…");
  connect();
})();
