/**
 * Клиент мультиплеера: профиль, чат (текст/голос/видео), таймер, автостарт,
 * подсказки, реванш, эмодзи, звуки, тема, статистика, кик, typing.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // ── UI elements ─────────────────────────────────────────
  const lobbyScreen = $("lobbyScreen"), roomScreen = $("roomScreen"), connStatus = $("connStatus");
  const nameInput = $("nameInput");
  const maxPlayers = $("maxPlayers"), isPrivate = $("isPrivate");
  const passwordInput = $("passwordInput"), createBtn = $("createBtn"), refreshBtn = $("refreshBtn");
  const roomsList = $("roomsList"), codeInput = $("codeInput"), codePassword = $("codePassword");
  const joinByCodeBtn = $("joinByCodeBtn"), lobbyMsg = $("lobbyMsg");
  const turnTimer = $("turnTimer"), hintsCheck = $("hintsCheck");
  const roomCode = $("roomCode"), roomStatus = $("roomStatus"), mpLetter = $("mpLetter");
  const timerDisplay = $("timerDisplay"), turnIndicator = $("turnIndicator");
  const playersList = $("playersList"), mpFeed = $("mpFeed");
  const mpForm = $("mpForm"), mpInput = $("mpInput"), mpSendBtn = $("mpSendBtn"), mpMessage = $("mpMessage");
  const startBtn = $("startBtn"), rematchBtn = $("rematchBtn"), surrenderBtn = $("surrenderBtn");
  const leaveBtn = $("leaveBtn"), shareBtn = $("shareBtn"), hintBtn = $("hintBtn");
  const extendBtn = $("extendBtn"), autoStartBar = $("autoStartBar"), autoStartTime = $("autoStartTime");
  const chatToggle = $("chatToggle"), chatBody = $("chatBody"), chatMessages = $("chatMessages");
  const chatForm = $("chatForm"), chatInput = $("chatInput"), chatBadge = $("chatBadge"), chatArrow = $("chatArrow");
  const chatTyping = $("chatTyping");
  const emojiFloats = $("emojiFloats");
  const themeBtn = $("themeBtn"), soundBtn = $("soundBtn"), profileBtn = $("profileBtn");
  const myAvatar = $("myAvatar");
  // Profile modal
  const profileModal = $("profileModal"), profileName = $("profileName");
  const avatarPreview = $("avatarPreview"), profileNamePreview = $("profileNamePreview");
  const avatarPicker = $("avatarPicker"), colorPicker = $("colorPicker");
  const profileSave = $("profileSave"), profileCancel = $("profileCancel");
  const editProfileBtn = $("editProfileBtn"), welcomeHi = $("welcomeHi");
  const googleLoginBtn = $("googleLoginBtn"), googleStatus = $("googleStatus");
  // Media
  const voiceBtn = $("voiceBtn"), videoBtn = $("videoBtn");
  const recordingBar = $("recordingBar"), recordingTime = $("recordingTime"), recordingLabel = $("recordingLabel");
  const recordCancel = $("recordCancel"), recordSend = $("recordSend");
  const videoPreviewBar = $("videoPreviewBar"), videoPreview = $("videoPreview"), videoRecTime = $("videoRecTime");
  const videoCancel = $("videoCancel"), videoSend = $("videoSend");

  // ── state ──────────────────────────────────────────────
  const state = { ws: null, playerId: null, room: null, connected: false, reconnectAttempts: 0 };
  let chatOpen = false, unreadCount = 0, timerInterval = null, autoStartInterval = null;
  let soundEnabled = localStorage.getItem("cities:sound") !== "off";
  const typingUsers = new Map();

  // ── Profile ────────────────────────────────────────────
  const AVATARS = ["🙂","😎","🤓","😇","🥳","🤠","🧑‍🎓","🧑‍🚀","🧑‍💻","🧑‍🎤","🦊","🐱","🐶","🐼","🦁","🐸","🐨","🐰","🐯","🦄","🐲","👾","🤖","👻","🎃","🌟","⚡","🔥","💎","🏆","🎯","🎲","🎨","🎸","🎮","⚽","🏀","🚀","🛸","🌈"];
  const COLORS = ["#6ea8ff","#8a7cff","#4cd6b0","#ff9b6a","#ff6a8a","#ffd43b","#a6e3a1","#f38ba8","#cba6f7","#94e2d5","#fab387","#89b4fa"];

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem("cities:profile") || "{}");
      return {
        name: p.name || "",
        avatar: p.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
        color: p.color || COLORS[Math.floor(Math.random() * COLORS.length)],
        google: p.google || null,
      };
    } catch { return { name: "", avatar: "🙂", color: "#6ea8ff", google: null }; }
  }
  function saveProfile(p) { localStorage.setItem("cities:profile", JSON.stringify(p)); }
  let profile = loadProfile();

  function applyProfileUI() {
    if (myAvatar) myAvatar.textContent = profile.avatar;
    if (myAvatar) myAvatar.style.background = profile.color + "33";
    if (welcomeHi) welcomeHi.textContent = profile.name ? `Привет, ${profile.name}!` : "Привет!";
    if (nameInput) nameInput.value = profile.name || "";
  }
  applyProfileUI();

  // Avatar picker
  function renderAvatarPicker(selected) {
    avatarPicker.innerHTML = "";
    for (const a of AVATARS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-item" + (a === selected ? " selected" : "");
      btn.textContent = a;
      btn.addEventListener("click", () => {
        avatarPicker.querySelectorAll(".avatar-item").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        avatarPreview.textContent = a;
        avatarPreview.dataset.value = a;
      });
      avatarPicker.appendChild(btn);
    }
  }
  function renderColorPicker(selected) {
    colorPicker.innerHTML = "";
    for (const c of COLORS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-item" + (c === selected ? " selected" : "");
      btn.style.background = c;
      btn.addEventListener("click", () => {
        colorPicker.querySelectorAll(".color-item").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        colorPicker.dataset.value = c;
        avatarPreview.style.background = c + "33";
        avatarPreview.style.boxShadow = `0 0 30px ${c}66`;
      });
      colorPicker.appendChild(btn);
    }
  }

  function openProfileModal() {
    renderAvatarPicker(profile.avatar);
    renderColorPicker(profile.color);
    avatarPreview.textContent = profile.avatar;
    avatarPreview.dataset.value = profile.avatar;
    avatarPreview.style.background = profile.color + "33";
    avatarPreview.style.boxShadow = `0 0 30px ${profile.color}66`;
    colorPicker.dataset.value = profile.color;
    profileName.value = profile.name || "";
    profileNamePreview.textContent = profile.name || "Игрок";
    googleStatus.textContent = profile.google ? `Вошли как ${profile.google.email}` : "Не обязательно";
    profileModal.classList.remove("hidden");
  }
  function closeProfileModal() { profileModal.classList.add("hidden"); }

  profileBtn?.addEventListener("click", openProfileModal);
  editProfileBtn?.addEventListener("click", openProfileModal);
  profileCancel?.addEventListener("click", closeProfileModal);
  profileModal?.addEventListener("click", (e) => { if (e.target === profileModal) closeProfileModal(); });

  profileName?.addEventListener("input", () => {
    profileNamePreview.textContent = profileName.value.trim() || "Игрок";
  });

  profileSave?.addEventListener("click", () => {
    const name = profileName.value.trim();
    if (!name) { profileName.focus(); return; }
    profile.name = name;
    profile.avatar = avatarPreview.dataset.value || profile.avatar;
    profile.color = colorPicker.dataset.value || profile.color;
    saveProfile(profile);
    applyProfileUI();
    closeProfileModal();
  });

  // Google OAuth (опционально)
  googleLoginBtn?.addEventListener("click", async () => {
    // Используем Google One Tap via GSI library lazily
    if (!document.getElementById("gsiScript")) {
      const script = document.createElement("script");
      script.id = "gsiScript";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.appendChild(script);
      await new Promise(r => script.onload = r);
    }
    // Для реального OAuth нужен Client ID — покажем pop-up с инструкцией
    googleStatus.textContent = "Для Google-входа нужна настройка OAuth — пока работает как анонимный профиль.";
    // Заглушка: сохраняем псевдо-данные
    profile.google = null;
    saveProfile(profile);
  });

  // Если имя не задано — откроем профиль при старте
  if (!profile.name) setTimeout(openProfileModal, 300);

  // ── Theme ─────────────────────────────────────────────
  (function initTheme() {
    const saved = localStorage.getItem("cities:theme") || "dark";
    document.documentElement.dataset.theme = saved;
    if (themeBtn) themeBtn.textContent = saved === "dark" ? "🌙" : "☀️";
  })();
  themeBtn?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("cities:theme", next);
    themeBtn.textContent = next === "dark" ? "🌙" : "☀️";
  });

  // ── Stats ─────────────────────────────────────────────
  function loadStats() {
    try { return JSON.parse(localStorage.getItem("cities:stats") || '{"games":0,"wins":0,"maxStreak":0,"streak":0}'); }
    catch { return { games: 0, wins: 0, maxStreak: 0, streak: 0 }; }
  }
  function saveStats(s) { localStorage.setItem("cities:stats", JSON.stringify(s)); }
  function recordGameResult(won) {
    const s = loadStats();
    s.games++;
    if (won) { s.wins++; s.streak++; if (s.streak > s.maxStreak) s.maxStreak = s.streak; }
    else { s.streak = 0; }
    saveStats(s);
  }

  // ── Sound ─────────────────────────────────────────────
  if (soundBtn) soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
  soundBtn?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("cities:sound", soundEnabled ? "on" : "off");
    soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
  });
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  function ensureAudio() { if (!audioCtx && AudioCtx) audioCtx = new AudioCtx(); }
  function playTone(freq, dur, type = "sine") {
    if (!soundEnabled) return;
    try {
      ensureAudio();
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq;
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
  function soundMessage() { playTone(700, 0.08); }

  // ── helpers ────────────────────────────────────────────
  function setConnStatus(ok, text) {
    state.connected = !!ok;
    connStatus.textContent = text || (ok ? "● онлайн" : "○ оффлайн");
    connStatus.className = "conn " + (ok ? "ok" : "off");
  }
  function showLobby() { lobbyScreen.classList.remove("hidden"); roomScreen.classList.add("hidden"); stopTimer(); stopAutoStartTimer(); chatMessages.innerHTML = ""; unreadCount = 0; chatBadge.classList.add("hidden"); }
  function showRoom() { lobbyScreen.classList.add("hidden"); roomScreen.classList.remove("hidden"); }
  function setLobbyMsg(t, tone = "") { lobbyMsg.textContent = t || ""; lobbyMsg.className = "message" + (tone ? " " + tone : ""); }
  function setRoomMsg(t, tone = "") { mpMessage.textContent = t || ""; mpMessage.className = "message" + (tone ? " " + tone : ""); }
  function playerName() { return profile.name || "Игрок"; }
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

  // ── AutoStart ─────────────────────────────────────────
  function startAutoStartTimer(deadline) {
    stopAutoStartTimer();
    if (!deadline) { autoStartBar.classList.add("hidden"); return; }
    autoStartBar.classList.remove("hidden");
    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (left <= 0) { stopAutoStartTimer(); return; }
      const mins = Math.floor(left / 60), secs = left % 60;
      autoStartTime.textContent = mins > 0 ? `${mins}:${String(secs).padStart(2,"0")}` : `${secs}с`;
      autoStartBar.classList.toggle("urgent", left <= 10);
    };
    update();
    autoStartInterval = setInterval(update, 1000);
  }
  function stopAutoStartTimer() {
    if (autoStartInterval) { clearInterval(autoStartInterval); autoStartInterval = null; }
    autoStartBar.classList.add("hidden");
  }

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

  function autoJoinFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code) {
      joinRoom(code.toUpperCase(), "");
      history.replaceState(null, "", location.pathname);
    }
  }

  function joinRoom(code, password) {
    send("room:join", { code, name: playerName(), password, avatar: profile.avatar, color: profile.color });
  }

  // ── server messages ───────────────────────────────────
  function handleServerMessage(msg) {
    switch (msg.type) {
      case "hello": state.playerId = msg.playerId; break;
      case "lobby:update": renderRooms(msg.rooms); break;
      case "room:joined":
        state.room = msg.room; state.playerId = msg.you || state.playerId;
        showRoom(); setRoomMsg(""); renderRoom();
        // Восстановить чат из лога
        chatMessages.innerHTML = "";
        if (msg.chatLog) for (const entry of msg.chatLog) renderChatEntry(entry);
        break;
      case "room:state": {
        const wasMyTurn = state.room && state.room.currentPlayerId === state.playerId && state.room.status === "playing";
        const prevStatus = state.room?.status;
        state.room = msg.room;
        renderRoom();
        const isMyTurn = msg.room.currentPlayerId === state.playerId && msg.room.status === "playing";
        if (isMyTurn && !wasMyTurn) soundYourTurn();
        else if (!isMyTurn && wasMyTurn) soundMove();
        if (msg.room.status === "finished" && prevStatus !== "finished") {
          const won = msg.room.winnerId === state.playerId;
          if (won) { soundWin(); confettiBurst(); } else soundLose();
          recordGameResult(won);
        }
        break;
      }
      case "move:invalid": setRoomMsg(msg.message, "error"); break;
      case "room:left": state.room = null; showLobby(); setLobbyMsg("Вы покинули комнату."); send("lobby:list"); break;
      case "room:kicked": state.room = null; showLobby(); setLobbyMsg(msg.message || "Вас исключили.", "error"); send("lobby:list"); break;
      case "room:hint": setRoomMsg(`💡 Подсказка: ${msg.hint}`, "ok"); break;
      case "error":
        if (!roomScreen.classList.contains("hidden")) setRoomMsg(msg.message, "error");
        else setLobbyMsg(msg.message, "error");
        break;
      case "chat:message":
      case "chat:voice":
      case "chat:video":
      case "chat:system":
        renderChatEntry(msg.kind ? msg : { kind: msg.type.split(":")[1], ...msg });
        if (msg.playerId && msg.playerId !== state.playerId && !chatOpen) {
          unreadCount++;
          chatBadge.textContent = unreadCount > 99 ? "99+" : unreadCount;
          chatBadge.classList.remove("hidden");
          soundMessage();
        }
        break;
      case "chat:emoji": showFloatingEmoji(msg.emoji, msg.name); break;
      case "chat:typing": showTyping(msg.playerId, msg.name); break;
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
      const hintsLabel = r.hints ? ` 💡` : "";
      item.innerHTML = `<div class="room-item-main"><div class="room-item-title">${escapeHtml(r.hostName)}</div><div class="room-item-sub"><span class="pill">👥 ${r.players}/${r.maxPlayers}</span><span class="pill ${r.status==='waiting'?'ok':''}">${r.status==='waiting'?'Ожидание':r.status==='playing'?'Идёт':'Завершена'}</span>${timerLabel}${hintsLabel}<span class="muted">🎮 ${r.code}</span></div></div>`;
      const btn = document.createElement("button");
      btn.className = "btn btn-primary"; btn.textContent = "Войти";
      btn.disabled = r.status !== "waiting" || r.players >= r.maxPlayers;
      btn.addEventListener("click", () => joinRoom(r.code, ""));
      item.appendChild(btn);
      roomsList.appendChild(item);
    }
  }

  // ── room rendering ────────────────────────────────────
  function renderRoom() {
    const r = state.room; if (!r) return;
    roomCode.textContent = r.code;
    const me = r.players.find(p => p.id === state.playerId);
    const amHost = me && me.isHost;
    const isMyTurn = r.status === "playing" && r.currentPlayerId === state.playerId;
    const current = r.players.find(p => p.id === r.currentPlayerId);

    if (r.status === "waiting") roomStatus.textContent = `👥 ${r.players.length}/${r.maxPlayers}`;
    else if (r.status === "playing") roomStatus.textContent = "🎮 Игра идёт";
    else { const w = r.players.find(p => p.id === r.winnerId); roomStatus.textContent = w ? `🏆 Победил ${w.name}!` : `Игра завершена`; }

    mpLetter.textContent = r.lastLetter ? r.lastLetter.toUpperCase() : "—";
    turnIndicator.textContent = r.status === "playing" ? (isMyTurn ? "🎯 Ваш ход" : `⏳ ${current?current.name:"…"}`) : (r.status === "waiting" ? "⏳ Ожидание" : "🏁 Окончена");
    turnIndicator.className = "turn-indicator" + (isMyTurn ? " active" : "");

    if (r.status === "playing" && r.turnDeadline) startTimer(r.turnDeadline);
    else stopTimer();

    if (r.status === "waiting" && r.autoStartDeadline) startAutoStartTimer(r.autoStartDeadline);
    else stopAutoStartTimer();

    playersList.innerHTML = "";
    for (const p of r.players) {
      const el = document.createElement("div");
      el.className = "player-item" + (p.id === r.currentPlayerId && r.status === "playing" ? " current" : "") + (p.id === state.playerId ? " you" : "") + (!p.connected ? " disconnected" : "");
      el.style.borderLeftColor = p.color || "#6ea8ff";
      el.innerHTML = `
        <span class="player-avatar" style="background:${p.color||"#6ea8ff"}33;box-shadow:0 0 10px ${p.color||"#6ea8ff"}55">${escapeHtml(p.avatar || "🙂")}</span>
        <span class="p-name">${escapeHtml(p.name)}${p.isHost?" 👑":""}${p.id===state.playerId?" (вы)":""}${!p.connected?" ⚡":""}</span>
        <span class="p-score">${p.score}</span>`;
      if (amHost && p.id !== state.playerId && (r.status === "waiting" || !p.connected)) {
        const kickBtn = document.createElement("button");
        kickBtn.className = "btn-kick"; kickBtn.textContent = "✕"; kickBtn.title = "Исключить";
        kickBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm(`Исключить ${p.name}?`)) send("room:kick", { targetId: p.id });
        });
        el.appendChild(kickBtn);
      }
      playersList.appendChild(el);
    }

    mpFeed.innerHTML = "";
    for (const h of r.history) {
      const b = document.createElement("div");
      b.className = "bubble " + (h.playerId === state.playerId ? "you" : "ai");
      b.innerHTML = `<span class="meta">${escapeHtml(h.name)}</span><span class="bubble-city">${escapeHtml(h.city)}</span>`;
      mpFeed.appendChild(b);
    }
    mpFeed.scrollTop = mpFeed.scrollHeight;

    const canPlay = r.status === "playing" && isMyTurn;
    mpInput.disabled = !canPlay; mpSendBtn.disabled = !canPlay;
    if (canPlay) {
      setRoomMsg(r.lastLetter ? `Ваш ход — на «${r.lastLetter.toUpperCase()}».` : "Ваш ход — любой город.");
      setTimeout(() => mpInput.focus(), 0);
    } else if (r.status === "playing") setRoomMsg("");

    hintBtn.classList.toggle("hidden", !(canPlay && r.hints && !r.hintGiven && r.lastLetter));

    const canStart = r.status === "waiting" && me && me.isHost && r.players.length >= 2;
    startBtn.classList.toggle("hidden", !canStart);
    extendBtn.classList.toggle("hidden", !(r.status === "waiting" && me && me.isHost && r.autoStartDeadline));
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

  let typingTimeout = null;
  chatInput?.addEventListener("input", () => {
    if (typingTimeout) return;
    send("chat:typing");
    typingTimeout = setTimeout(() => { typingTimeout = null; }, 2000);
  });

  function showTyping(playerId, name) {
    if (playerId === state.playerId) return;
    const existing = typingUsers.get(playerId);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => { typingUsers.delete(playerId); updateTypingBar(); }, 3000);
    typingUsers.set(playerId, tid);
    chatTyping.dataset[`name_${playerId}`] = name;
    updateTypingBar();
  }
  function updateTypingBar() {
    const names = [];
    for (const pid of typingUsers.keys()) {
      const n = chatTyping.dataset[`name_${pid}`];
      if (n) names.push(n);
    }
    if (names.length === 0) chatTyping.classList.add("hidden");
    else { chatTyping.classList.remove("hidden"); chatTyping.textContent = `${names.join(", ")} печатает…`; }
  }

  function renderChatEntry(entry) {
    const el = document.createElement("div");
    const own = entry.playerId === state.playerId;
    el.className = "chat-msg" + (entry.kind === "system" ? " system" : own ? " own" : "");

    if (entry.kind === "system") {
      el.textContent = entry.text;
    } else if (entry.kind === "text" || entry.kind === "message") {
      el.innerHTML = `<b>${escapeHtml(entry.name)}</b><div class="chat-text">${escapeHtml(entry.text)}</div>`;
    } else if (entry.kind === "voice") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = `data:audio/webm;base64,${entry.data}`;
      el.innerHTML = `<b>${escapeHtml(entry.name)}</b><div class="chat-voice-meta">🎤 ${formatDur(entry.duration)}</div>`;
      el.appendChild(audio);
    } else if (entry.kind === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.src = `data:video/webm;base64,${entry.data}`;
      video.className = "chat-video-circle";
      el.innerHTML = `<b>${escapeHtml(entry.name)}</b><div class="chat-voice-meta">🎥 ${formatDur(entry.duration)}</div>`;
      el.appendChild(video);
    }
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function formatDur(s) { s = Math.round(s || 0); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }

  // ── Emoji ─────────────────────────────────────────────
  document.querySelectorAll(".emoji-btn").forEach(btn => {
    btn.addEventListener("click", () => { send("chat:emoji", { emoji: btn.dataset.emoji }); });
  });
  function showFloatingEmoji(emoji, name) {
    const el = document.createElement("div");
    el.className = "emoji-float"; el.textContent = emoji;
    el.style.left = Math.random() * 80 + 10 + "%";
    emojiFloats.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  // ── Confetti burst ─────────────────────────────────────
  function confettiBurst() {
    const emojis = ["🎉","🎊","✨","🌟","⭐","🎆"];
    for (let i = 0; i < 30; i++) {
      const el = document.createElement("div");
      el.className = "confetti";
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.left = Math.random() * 100 + "%";
      el.style.animationDelay = (Math.random() * 0.5) + "s";
      el.style.animationDuration = (1.5 + Math.random()) + "s";
      emojiFloats.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  }

  // ── Voice recording ────────────────────────────────────
  let mediaRecorder = null, recordedChunks = [], recordStartTime = 0, recordInterval = null;
  voiceBtn?.addEventListener("click", async () => {
    if (!navigator.mediaDevices) { alert("Микрофон недоступен."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      mediaRecorder.start();
      recordStartTime = Date.now();
      recordingBar.classList.remove("hidden");
      recordingLabel.textContent = "Запись голоса…";
      recordInterval = setInterval(() => {
        const s = Math.floor((Date.now() - recordStartTime) / 1000);
        recordingTime.textContent = formatDur(s);
        if (s >= 60) stopRecording(true);
      }, 200);
    } catch { alert("Нет доступа к микрофону."); }
  });

  function stopRecording(sendIt) {
    if (!mediaRecorder) return;
    clearInterval(recordInterval);
    const dur = Math.floor((Date.now() - recordStartTime) / 1000);
    mediaRecorder.addEventListener("stop", async () => {
      if (sendIt && recordedChunks.length) {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        const data = await blobToBase64(blob);
        send("chat:voice", { data, duration: dur });
      }
      recordingBar.classList.add("hidden");
      mediaRecorder = null;
    }, { once: true });
    try { mediaRecorder.stop(); } catch {}
  }
  recordCancel?.addEventListener("click", () => stopRecording(false));
  recordSend?.addEventListener("click", () => stopRecording(true));

  async function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(blob);
    });
  }

  // ── Video recording ────────────────────────────────────
  let videoRecorder = null, videoChunks = [], videoStream = null, videoStartTime = 0, videoInterval = null;
  videoBtn?.addEventListener("click", async () => {
    if (!navigator.mediaDevices) { alert("Камера недоступна."); return; }
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320, facingMode: "user" }, audio: true });
      videoChunks = [];
      videoPreview.srcObject = videoStream;
      videoRecorder = new MediaRecorder(videoStream, { mimeType: "video/webm" });
      videoRecorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };
      videoRecorder.start();
      videoStartTime = Date.now();
      videoPreviewBar.classList.remove("hidden");
      videoInterval = setInterval(() => {
        const s = Math.floor((Date.now() - videoStartTime) / 1000);
        videoRecTime.textContent = formatDur(s);
        if (s >= 30) stopVideoRecording(true);
      }, 200);
    } catch { alert("Нет доступа к камере."); }
  });

  function stopVideoRecording(sendIt) {
    if (!videoRecorder) return;
    clearInterval(videoInterval);
    const dur = Math.floor((Date.now() - videoStartTime) / 1000);
    videoRecorder.addEventListener("stop", async () => {
      videoStream?.getTracks().forEach(t => t.stop());
      if (sendIt && videoChunks.length) {
        const blob = new Blob(videoChunks, { type: "video/webm" });
        const data = await blobToBase64(blob);
        send("chat:video", { data, duration: dur });
      }
      videoPreviewBar.classList.add("hidden");
      videoPreview.srcObject = null;
      videoRecorder = null;
    }, { once: true });
    try { videoRecorder.stop(); } catch {}
  }
  videoCancel?.addEventListener("click", () => stopVideoRecording(false));
  videoSend?.addEventListener("click", () => stopVideoRecording(true));

  // ── Events: lobby ─────────────────────────────────────
  isPrivate.addEventListener("change", () => { passwordInput.disabled = !isPrivate.checked; if (!isPrivate.checked) passwordInput.value = ""; else passwordInput.focus(); });
  createBtn.addEventListener("click", () => {
    if (!profile.name) { openProfileModal(); return; }
    const mp = Math.max(2, Math.min(32, Number(maxPlayers.value) || 4));
    if (isPrivate.checked && !passwordInput.value.trim()) { setLobbyMsg("Укажите пароль.", "error"); passwordInput.focus(); return; }
    send("room:create", {
      name: playerName(), maxPlayers: mp, isPrivate: isPrivate.checked,
      password: passwordInput.value.trim(), turnTimer: Number(turnTimer.value),
      hints: hintsCheck.checked, disconnectTimeout: 0,
      avatar: profile.avatar, color: profile.color,
    });
    setLobbyMsg("");
  });
  refreshBtn.addEventListener("click", () => send("lobby:list"));
  joinByCodeBtn.addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { setLobbyMsg("Введите код.", "error"); return; }
    joinRoom(code, codePassword.value.trim());
  });

  // ── Events: room ──────────────────────────────────────
  startBtn.addEventListener("click", () => send("room:start"));
  rematchBtn.addEventListener("click", () => send("room:rematch"));
  extendBtn.addEventListener("click", () => send("room:extendAutoStart", { seconds: 60 }));
  surrenderBtn.addEventListener("click", () => { if (confirm("Сдаться?")) send("room:surrender"); });
  leaveBtn.addEventListener("click", () => { if (confirm("Выйти? Вы сможете вернуться по коду.")) send("room:leave"); });
  hintBtn.addEventListener("click", () => send("room:hint"));
  shareBtn.addEventListener("click", () => {
    const url = `${location.origin}/multi?code=${state.room?.code || ""}`;
    if (navigator.share) { navigator.share({ title: "Города", url }); }
    else { navigator.clipboard.writeText(url).then(() => setRoomMsg("Ссылка скопирована!", "ok")); }
  });
  mpForm.addEventListener("submit", (e) => { e.preventDefault(); const c = mpInput.value.trim(); if (!c) return; send("room:move", { city: c }); mpInput.value = ""; setRoomMsg(""); });
  mpInput.addEventListener("input", () => { if (mpMessage.classList.contains("error")) setRoomMsg(""); });

  // ── init ──────────────────────────────────────────────
  setConnStatus(false, "соединение…");
  connect();
})();
