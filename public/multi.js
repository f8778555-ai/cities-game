/**
 * Мультиплеер — полный клиент:
 * профиль с вкладками, магазин аватаров, темы, достижения,
 * друзья, топ игроков, XP/уровни, чат (текст/голос/видео),
 * таймер, автостарт, подсказки, реванш, эмодзи, звуки, кик.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const qs = (s) => document.querySelector(s);

  // ───── UI refs ─────────────────────────────────────────
  const lobbyScreen = $("lobbyScreen"), roomScreen = $("roomScreen"), connStatus = $("connStatus");
  const maxPlayers = $("maxPlayers"), isPrivate = $("isPrivate"), passwordInput = $("passwordInput");
  const createBtn = $("createBtn"), refreshBtn = $("refreshBtn");
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
  const chatPanel = $("chatPanel"), chatFab = $("chatFab"), chatCloseBtn = $("chatCloseBtn");
  const chatMessages = $("chatMessages"), chatForm = $("chatForm"), chatInput = $("chatInput");
  const chatBadge = $("chatBadge"), chatTyping = $("chatTyping");
  const emojiFloats = $("emojiFloats");
  const soundBtn = $("soundBtn"), profileBtn = $("profileBtn");
  const myAvatar = $("myAvatar"), myLevelBadge = $("myLevelBadge");
  const profileModal = $("profileModal"), modalCloseBtn = $("modalCloseBtn");
  const profileName = $("profileName");
  const avatarPreview = $("avatarPreview"), profileNamePreview = $("profileNamePreview");
  const colorPicker = $("colorPicker");
  const profileSave = $("profileSave");
  const levelDisplay = $("levelDisplay"), xpBar = $("xpBar"), xpText = $("xpText");
  const editProfileBtn = $("editProfileBtn"), welcomeHi = $("welcomeHi");
  const googleButtonHost = $("googleButtonHost"), googleLogoutBtn = $("googleLogoutBtn"), googleStatus = $("googleStatus");
  const shopGrid = $("shopGrid"), themesGrid = $("themesGrid");
  const achievementsList = $("achievementsList");
  const friendSearchInput = $("friendSearchInput"), friendSearchBtn = $("friendSearchBtn");
  const friendsSearchResults = $("friendsSearchResults"), friendsList = $("friendsList");
  const leaderboardList = $("leaderboardList");
  const achievementToast = $("achievementToast"), levelUpToast = $("levelUpToast");
  const voiceBtn = $("voiceBtn"), videoBtn = $("videoBtn");
  const recordingBar = $("recordingBar"), recordingTime = $("recordingTime");
  const recordCancel = $("recordCancel"), recordSend = $("recordSend");
  const videoPreviewBar = $("videoPreviewBar"), videoPreview = $("videoPreview"), videoRecTime = $("videoRecTime");
  const videoCancel = $("videoCancel"), videoSend = $("videoSend");

  // ───── state ───────────────────────────────────────────
  const state = { ws: null, playerId: null, room: null, connected: false, reconnectAttempts: 0 };
  let chatOpen = false, unreadCount = 0, timerInterval = null, autoStartInterval = null;
  let soundEnabled = localStorage.getItem("cities:sound") !== "off";
  const typingUsers = new Map();
  let remoteUser = null;
  let googleClientId = null;
  let allAchievements = [];
  let shopItems = [];
  let themes = [];
  let currentTab = "profile";
  let leaderboardSort = "wins";

  const DEFAULT_COLORS = ["#6ea8ff","#8a7cff","#4cd6b0","#ff9b6a","#ff6a8a","#ffd43b","#a6e3a1","#f38ba8","#cba6f7","#94e2d5","#fab387","#89b4fa"];

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem("cities:profile") || "{}");
      return {
        name: p.name || "",
        avatar: p.avatar || "🙂",
        color: p.color || "#6ea8ff",
        theme: p.theme || "dark",
      };
    } catch { return { name: "", avatar: "🙂", color: "#6ea8ff", theme: "dark" }; }
  }
  function saveProfile(p) { localStorage.setItem("cities:profile", JSON.stringify(p)); }
  let profile = loadProfile();

  // ───── Theme ─────────────────────────────────────────
  function applyTheme(themeId) {
    document.documentElement.dataset.theme = themeId || "dark";
    localStorage.setItem("cities:theme", themeId);
    profile.theme = themeId;
    saveProfile(profile);
  }
  applyTheme(profile.theme || localStorage.getItem("cities:theme") || "dark");

  // ───── Helpers ───────────────────────────────────────
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function formatDur(s) { s = Math.round(s || 0); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
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

  function applyProfileUI() {
    if (myAvatar) { myAvatar.textContent = profile.avatar; myAvatar.style.background = profile.color + "33"; }
    if (welcomeHi) welcomeHi.textContent = profile.name ? `Привет, ${profile.name}!` : "Привет!";
    if (remoteUser) {
      myLevelBadge?.classList.remove("hidden");
      if (myLevelBadge) myLevelBadge.textContent = remoteUser.level;
    } else {
      myLevelBadge?.classList.add("hidden");
    }
  }
  applyProfileUI();

  // ───── Sound ─────────────────────────────────────────
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
      ensureAudio(); if (!audioCtx) return;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  const soundMove = () => playTone(600, 0.1);
  const soundYourTurn = () => { playTone(880, 0.15); setTimeout(() => playTone(1100, 0.15), 160); };
  const soundWin = () => { playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 150); setTimeout(() => playTone(784, 0.3), 300); };
  const soundLose = () => playTone(300, 0.3, "sawtooth");
  const soundTimer = () => playTone(440, 0.05);
  const soundMessage = () => playTone(700, 0.08);
  const soundLevelUp = () => { playTone(523, 0.1); setTimeout(()=>playTone(659,0.1),100); setTimeout(()=>playTone(784,0.1),200); setTimeout(()=>playTone(1046,0.3),300); };

  // ───── Profile modal logic ────────────────────────────
  function openProfileModal(tab = "profile") {
    renderColorPicker(profile.color);
    avatarPreview.textContent = profile.avatar;
    avatarPreview.style.background = profile.color + "33";
    avatarPreview.style.boxShadow = `0 0 30px ${profile.color}66`;
    profileName.value = profile.name || "";
    profileNamePreview.textContent = profile.name || "Игрок";
    updateLevelDisplay();
    switchTab(tab);
    if (remoteUser?.isGoogle) {
      googleStatus.textContent = `Вошли как ${remoteUser.email}`;
      googleLogoutBtn.classList.remove("hidden");
      googleButtonHost.innerHTML = "";
    } else {
      googleLogoutBtn.classList.add("hidden");
      initGoogleButton();
    }
    profileModal.classList.remove("hidden");
  }
  function closeProfileModal() { profileModal.classList.add("hidden"); }

  profileBtn?.addEventListener("click", () => openProfileModal());
  editProfileBtn?.addEventListener("click", () => openProfileModal());
  modalCloseBtn?.addEventListener("click", closeProfileModal);
  profileModal?.addEventListener("click", (e) => { if (e.target === profileModal) closeProfileModal(); });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === tab));
    if (tab === "shop") renderShop();
    if (tab === "themes") renderThemes();
    if (tab === "achievements") renderAchievements();
    if (tab === "leaderboard") loadLeaderboard();
    if (tab === "friends") loadFriends();
  }

  function renderColorPicker(selected) {
    colorPicker.innerHTML = "";
    for (const c of DEFAULT_COLORS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-item" + (c === selected ? " selected" : "");
      btn.style.background = c;
      btn.addEventListener("click", () => {
        colorPicker.querySelectorAll(".color-item").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        profile.color = c;
        avatarPreview.style.background = c + "33";
        avatarPreview.style.boxShadow = `0 0 30px ${c}66`;
      });
      colorPicker.appendChild(btn);
    }
  }

  function updateLevelDisplay() {
    if (!remoteUser) {
      levelDisplay.textContent = "—";
      xpText.textContent = "Войдите через Google";
      xpBar.style.width = "0%";
      return;
    }
    levelDisplay.textContent = remoteUser.level;
    const max = remoteUser.xpToNext || 100;
    xpText.textContent = `${remoteUser.xp} / ${max} XP`;
    xpBar.style.width = Math.min(100, (remoteUser.xp / max) * 100) + "%";
  }

  profileName?.addEventListener("input", () => {
    profileNamePreview.textContent = profileName.value.trim() || "Игрок";
  });

  profileSave?.addEventListener("click", async () => {
    const name = profileName.value.trim();
    if (!name) { profileName.focus(); return; }
    profile.name = name;
    saveProfile(profile);
    applyProfileUI();
    if (remoteUser) await syncProfile();
    closeProfileModal();
  });

  async function syncProfile() {
    try {
      const res = await fetch("/api/me/profile", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profile.name, avatar: profile.avatar, color: profile.color, theme: profile.theme }),
      });
      const data = await res.json();
      if (data.user) { remoteUser = data.user; applyProfileUI(); updateLevelDisplay(); }
      if (data.newAchievements?.length) showAchievementToasts(data.newAchievements);
    } catch {}
  }

  // ───── Shop ─────────────────────────────────────────
  async function loadShop() {
    try {
      const res = await fetch("/api/shop", { credentials: "include" });
      const data = await res.json();
      shopItems = data.shop || [];
    } catch {}
  }
  function renderShop() {
    shopGrid.innerHTML = "";
    if (!shopItems.length) { loadShop().then(renderShop); return; }
    for (const item of shopItems) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "shop-item" + (item.unlocked ? "" : " locked") + (item.emoji === profile.avatar ? " selected" : "");
      let hint = "";
      if (!item.unlocked) {
        if (item.requireLevel) hint = `Ур. ${item.requireLevel}`;
        else if (item.requireAchievement) hint = "Достижение";
      }
      el.innerHTML = `<span class="shop-emoji">${item.unlocked ? item.emoji : "🔒"}</span>${hint ? `<span class="shop-hint">${hint}</span>` : ""}`;
      el.disabled = !item.unlocked;
      el.addEventListener("click", () => {
        if (!item.unlocked) return;
        profile.avatar = item.emoji;
        saveProfile(profile);
        avatarPreview.textContent = item.emoji;
        shopGrid.querySelectorAll(".shop-item").forEach(x => x.classList.remove("selected"));
        el.classList.add("selected");
        applyProfileUI();
        if (remoteUser) syncProfile();
      });
      shopGrid.appendChild(el);
    }
  }

  // ───── Themes ───────────────────────────────────────
  async function loadThemes() {
    try {
      const res = await fetch("/api/themes", { credentials: "include" });
      const data = await res.json();
      themes = data.themes || [];
    } catch {}
  }
  function renderThemes() {
    themesGrid.innerHTML = "";
    if (!themes.length) { loadThemes().then(renderThemes); return; }
    for (const t of themes) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "theme-item" + (t.unlocked ? "" : " locked") + (t.id === profile.theme ? " selected" : "");
      el.innerHTML = `
        <div class="theme-preview theme-preview-${t.id}"></div>
        <div class="theme-icon">${t.unlocked ? t.icon : "🔒"}</div>
        <div class="theme-name">${escapeHtml(t.name)}</div>
        ${!t.unlocked ? `<div class="theme-hint">Ур. ${t.requireLevel}</div>` : ""}`;
      el.disabled = !t.unlocked;
      el.addEventListener("click", () => {
        if (!t.unlocked) return;
        applyTheme(t.id);
        themesGrid.querySelectorAll(".theme-item").forEach(x => x.classList.remove("selected"));
        el.classList.add("selected");
        if (remoteUser) syncProfile();
      });
      themesGrid.appendChild(el);
    }
  }

  // ───── Achievements ─────────────────────────────────
  async function loadAchievementsDefs() {
    try {
      const res = await fetch("/api/achievements");
      const data = await res.json();
      allAchievements = data.achievements || [];
    } catch {}
  }
  function renderAchievements() {
    achievementsList.innerHTML = "";
    if (!allAchievements.length) { loadAchievementsDefs().then(renderAchievements); return; }
    const unlocked = remoteUser?.achievements || {};
    if (!remoteUser) {
      const n = document.createElement("div");
      n.className = "hint-card";
      n.textContent = "Войдите через Google, чтобы сохранять прогресс.";
      achievementsList.appendChild(n);
    }
    for (const a of allAchievements) {
      const isUnlocked = !!unlocked[a.id];
      const el = document.createElement("div");
      el.className = "achievement-item" + (isUnlocked ? " unlocked" : " locked");
      el.innerHTML = `
        <div class="ach-icon">${isUnlocked ? a.icon : "🔒"}</div>
        <div class="ach-body">
          <div class="ach-title">${escapeHtml(a.title)}</div>
          <div class="ach-desc">${escapeHtml(a.description)}</div>
        </div>
        ${isUnlocked ? '<div class="ach-check">✓</div>' : ""}`;
      achievementsList.appendChild(el);
    }
  }

  // ───── Friends ──────────────────────────────────────
  async function loadFriends() {
    if (!remoteUser) {
      friendsList.innerHTML = '<div class="hint-card">Войдите через Google чтобы добавлять друзей.</div>';
      return;
    }
    try {
      const res = await fetch("/api/friends", { credentials: "include" });
      const data = await res.json();
      renderFriendsList(data.friends || []);
    } catch {}
  }
  function renderFriendsList(list) {
    friendsList.innerHTML = "";
    if (!list.length) { friendsList.innerHTML = '<div class="muted" style="font-size:13px">Пока нет друзей. Найдите их в поиске!</div>'; return; }
    for (const f of list) {
      const el = document.createElement("div");
      el.className = "friend-item";
      el.innerHTML = `
        <span class="player-avatar" style="background:${f.color}33;box-shadow:0 0 10px ${f.color}55">${escapeHtml(f.avatar)}</span>
        <div class="friend-info">
          <div class="friend-name">${escapeHtml(f.name)}</div>
          <div class="friend-level">Уровень ${f.level}</div>
        </div>
        <button class="btn btn-remove-friend" data-id="${f.id}">✕</button>`;
      el.querySelector(".btn-remove-friend").addEventListener("click", async () => {
        if (!confirm(`Удалить ${f.name} из друзей?`)) return;
        await fetch("/api/friends/remove", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: f.id }),
        });
        loadFriends();
      });
      friendsList.appendChild(el);
    }
  }
  friendSearchBtn?.addEventListener("click", searchUsers);
  friendSearchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") searchUsers(); });
  async function searchUsers() {
    const q = friendSearchInput.value.trim();
    if (!q) { friendsSearchResults.innerHTML = ""; return; }
    try {
      const res = await fetch("/api/users/search?q=" + encodeURIComponent(q));
      const data = await res.json();
      friendsSearchResults.innerHTML = "";
      if (!data.users.length) {
        friendsSearchResults.innerHTML = '<div class="muted" style="font-size:13px">Никого не найдено.</div>';
        return;
      }
      for (const u of data.users) {
        if (remoteUser && u.id === remoteUser.id) continue;
        const el = document.createElement("div");
        el.className = "friend-item";
        el.innerHTML = `
          <span class="player-avatar" style="background:${u.color}33">${escapeHtml(u.avatar)}</span>
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(u.name)}</div>
            <div class="friend-level">Ур. ${u.level}</div>
          </div>
          <button class="btn btn-primary" data-id="${u.id}">+</button>`;
        el.querySelector("button").addEventListener("click", async () => {
          if (!remoteUser) { alert("Нужно войти через Google."); return; }
          const r = await fetch("/api/friends/add", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: u.id }),
          });
          if (r.ok) { friendsSearchResults.innerHTML = ""; friendSearchInput.value = ""; loadFriends(); }
        });
        friendsSearchResults.appendChild(el);
      }
    } catch {}
  }

  // ───── Leaderboard ──────────────────────────────────
  document.querySelectorAll(".leader-sort .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".leader-sort .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      leaderboardSort = chip.dataset.sort;
      loadLeaderboard();
    });
  });
  async function loadLeaderboard() {
    try {
      const res = await fetch("/api/leaderboard?sort=" + leaderboardSort + "&limit=50");
      const data = await res.json();
      renderLeaderboard(data.leaderboard || []);
    } catch {}
  }
  function renderLeaderboard(list) {
    leaderboardList.innerHTML = "";
    if (!list.length) { leaderboardList.innerHTML = '<div class="hint-card">Пока пусто — сыграйте несколько партий!</div>'; return; }
    const valueField = { wins: "wins", games: "games", streak: "maxStreak", level: "level", cities: "totalCities" }[leaderboardSort] || "wins";
    list.forEach((u, i) => {
      const el = document.createElement("div");
      el.className = "leader-item" + (i < 3 ? " top" : "") + (remoteUser && u.id === remoteUser.id ? " me" : "");
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      const value = u[valueField] || 0;
      el.innerHTML = `
        <span class="leader-rank">${medal}</span>
        <span class="player-avatar" style="background:${u.color}33;box-shadow:0 0 10px ${u.color}55">${escapeHtml(u.avatar)}</span>
        <div class="leader-info">
          <div class="leader-name">${escapeHtml(u.name)}${u.isGoogle ? " ✓" : ""}</div>
          <div class="leader-sub">Ур. ${u.level} · ${u.winRate}% побед</div>
        </div>
        <div class="leader-value">${value}</div>`;
      leaderboardList.appendChild(el);
    });
  }

  // ───── Google OAuth ─────────────────────────────────
  async function loadConfig() {
    try { const res = await fetch("/api/config"); const data = await res.json(); googleClientId = data.googleClientId; } catch {}
  }
  async function fetchMe() {
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      const data = await res.json();
      if (data.user) {
        remoteUser = data.user;
        profile.name = remoteUser.name;
        profile.avatar = remoteUser.avatar;
        profile.color = remoteUser.color;
        profile.theme = remoteUser.theme || profile.theme;
        saveProfile(profile);
        applyTheme(profile.theme);
        applyProfileUI();
      }
    } catch {}
  }
  async function initGoogleButton() {
    if (!googleClientId) {
      googleStatus.textContent = "Google-вход недоступен (нет Client ID).";
      googleButtonHost.innerHTML = "";
      return;
    }
    if (!window.google?.accounts?.id) {
      await new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true; s.defer = true; s.onload = resolve; s.onerror = resolve;
        document.head.appendChild(s);
      });
    }
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        try {
          const res = await fetch("/api/auth/google", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: response.credential }),
          });
          const data = await res.json();
          if (data.user) {
            remoteUser = data.user;
            profile.name = data.user.name;
            profile.avatar = data.user.avatar;
            profile.color = data.user.color;
            profile.theme = data.user.theme || profile.theme;
            saveProfile(profile);
            applyTheme(profile.theme);
            applyProfileUI();
            updateLevelDisplay();
            googleStatus.textContent = `Вошли как ${data.user.email}`;
            googleLogoutBtn.classList.remove("hidden");
            googleButtonHost.innerHTML = "";
            if (data.newAchievements?.length) showAchievementToasts(data.newAchievements);
          } else googleStatus.textContent = "Ошибка: " + (data.error || "");
        } catch { googleStatus.textContent = "Ошибка сети"; }
      },
    });
    googleButtonHost.innerHTML = "";
    window.google.accounts.id.renderButton(googleButtonHost, {
      theme: "filled_blue", size: "large", width: 260, text: "signin_with", shape: "pill",
    });
  }
  googleLogoutBtn?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    remoteUser = null; profile.google = null; saveProfile(profile);
    googleStatus.textContent = "Вы вышли.";
    googleLogoutBtn.classList.add("hidden");
    applyProfileUI();
    initGoogleButton();
  });

  // ───── Toast: achievement ───────────────────────────
  function showAchievementToasts(list) {
    list.forEach((a, i) => setTimeout(() => showAchievementToast(a), i * 2500));
  }
  function showAchievementToast(a) {
    achievementToast.innerHTML = `
      <div class="toast-icon">${a.icon}</div>
      <div class="toast-body">
        <div class="toast-label">🏆 Достижение!</div>
        <div class="toast-title">${escapeHtml(a.title)}</div>
        <div class="toast-desc">${escapeHtml(a.description)}</div>
      </div>`;
    achievementToast.classList.remove("hidden");
    achievementToast.classList.add("show");
    soundWin();
    setTimeout(() => { achievementToast.classList.remove("show"); setTimeout(() => achievementToast.classList.add("hidden"), 500); }, 3500);
  }
  function showLevelUpToast(data) {
    levelUpToast.innerHTML = `
      <div class="toast-icon" style="background:linear-gradient(135deg,rgba(138,124,255,0.3),rgba(110,168,255,0.2))">⭐</div>
      <div class="toast-body">
        <div class="toast-label">🎉 Повышение уровня!</div>
        <div class="toast-title">Уровень ${data.level}</div>
        <div class="toast-desc">Открыты новые возможности</div>
      </div>`;
    levelUpToast.classList.remove("hidden");
    levelUpToast.classList.add("show");
    soundLevelUp();
    confettiBurst();
    setTimeout(() => { levelUpToast.classList.remove("show"); setTimeout(() => levelUpToast.classList.add("hidden"), 500); }, 3500);
  }

  // ───── Timer / AutoStart ────────────────────────────
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
    update(); timerInterval = setInterval(update, 1000);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } timerDisplay.classList.add("hidden"); }
  function startAutoStartTimer(deadline) {
    stopAutoStartTimer();
    if (!deadline) { autoStartBar.classList.add("hidden"); return; }
    autoStartBar.classList.remove("hidden");
    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (left <= 0) { stopAutoStartTimer(); return; }
      autoStartTime.textContent = left >= 60 ? `${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}` : `${left}с`;
      autoStartBar.classList.toggle("urgent", left <= 10);
    };
    update(); autoStartInterval = setInterval(update, 1000);
  }
  function stopAutoStartTimer() { if (autoStartInterval) { clearInterval(autoStartInterval); autoStartInterval = null; } autoStartBar.classList.add("hidden"); }

  // ───── Confetti ─────────────────────────────────────
  function confettiBurst() {
    const emojis = ["🎉","🎊","✨","🌟","⭐","🎆"];
    for (let i = 0; i < 30; i++) {
      const el = document.createElement("div");
      el.className = "confetti"; el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.left = Math.random() * 100 + "%";
      el.style.animationDelay = (Math.random() * 0.5) + "s";
      el.style.animationDuration = (1.5 + Math.random()) + "s";
      emojiFloats.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  }

  // ───── WebSocket ────────────────────────────────────
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
    if (code) { joinRoom(code.toUpperCase(), ""); history.replaceState(null, "", location.pathname); }
  }
  function joinRoom(code, password) {
    send("room:join", { code, name: playerName(), password, avatar: profile.avatar, color: profile.color });
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case "hello":
        state.playerId = msg.playerId;
        if (msg.user) {
          remoteUser = msg.user;
          profile.name = msg.user.name; profile.avatar = msg.user.avatar; profile.color = msg.user.color;
          if (msg.user.theme) profile.theme = msg.user.theme;
          saveProfile(profile); applyTheme(profile.theme); applyProfileUI();
        }
        break;
      case "lobby:update": renderRooms(msg.rooms); break;
      case "room:joined":
        state.room = msg.room; state.playerId = msg.you || state.playerId;
        showRoom(); setRoomMsg(""); renderRoom();
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
        }
        break;
      }
      case "move:invalid": setRoomMsg(msg.message, "error"); break;
      case "room:left": state.room = null; showLobby(); setLobbyMsg("Вы покинули комнату."); send("lobby:list"); break;
      case "room:kicked": state.room = null; showLobby(); setLobbyMsg(msg.message || "Вас исключили.", "error"); send("lobby:list"); break;
      case "room:hint": setRoomMsg(`💡 ${msg.hint}`, "ok"); break;
      case "error":
        if (!roomScreen.classList.contains("hidden")) setRoomMsg(msg.message, "error");
        else setLobbyMsg(msg.message, "error"); break;
      case "chat:message": case "chat:voice": case "chat:video": case "chat:system":
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
      case "achievements:unlocked": showAchievementToasts(msg.achievements || []); break;
      case "user:update": remoteUser = msg.user; applyProfileUI(); updateLevelDisplay(); break;
      case "level:up": showLevelUpToast(msg); break;
      case "xp:gained": break; // покажется через user:update
    }
  }

  // ───── Room rendering ────────────────────────────────
  function renderRooms(list) {
    roomsList.innerHTML = "";
    if (!list.length) { roomsList.innerHTML = '<div class="hint-card">Нет открытых игр. Создайте первую!</div>'; return; }
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

  function renderRoom() {
    const r = state.room; if (!r) return;
    roomCode.textContent = r.code;
    const me = r.players.find(p => p.id === state.playerId);
    const amHost = me && me.isHost;
    const isMyTurn = r.status === "playing" && r.currentPlayerId === state.playerId;
    const current = r.players.find(p => p.id === r.currentPlayerId);

    if (r.status === "waiting") roomStatus.textContent = `👥 ${r.players.length}/${r.maxPlayers}`;
    else if (r.status === "playing") roomStatus.textContent = "🎮 Идёт";
    else { const w = r.players.find(p => p.id === r.winnerId); roomStatus.textContent = w ? `🏆 ${w.name}!` : `Завершена`; }

    mpLetter.textContent = r.lastLetter ? r.lastLetter.toUpperCase() : "—";
    turnIndicator.textContent = r.status === "playing" ? (isMyTurn ? "🎯 Ваш ход" : `⏳ ${current?current.name:"…"}`) : (r.status === "waiting" ? "⏳ Ожидание" : "🏁 Конец");
    turnIndicator.className = "turn-indicator" + (isMyTurn ? " active" : "");

    if (r.status === "playing" && r.turnDeadline) startTimer(r.turnDeadline); else stopTimer();
    if (r.status === "waiting" && r.autoStartDeadline) startAutoStartTimer(r.autoStartDeadline); else stopAutoStartTimer();

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
        kickBtn.className = "btn-kick"; kickBtn.textContent = "✕";
        kickBtn.addEventListener("click", (e) => { e.stopPropagation(); if (confirm(`Исключить ${p.name}?`)) send("room:kick", { targetId: p.id }); });
        el.appendChild(kickBtn);
      }
      playersList.appendChild(el);
    }

    // История ходов
    const prevCount = mpFeed.childElementCount;
    mpFeed.innerHTML = "";
    for (const h of r.history) {
      const b = document.createElement("div");
      b.className = "bubble " + (h.playerId === state.playerId ? "you" : "ai");
      const p = r.players.find(x => x.id === h.playerId);
      b.innerHTML = `
        ${p ? `<span class="player-avatar bubble-avatar" style="background:${p.color}33">${escapeHtml(p.avatar || "🙂")}</span>` : ""}
        <div class="bubble-content"><span class="meta">${escapeHtml(h.name)}</span><span class="bubble-city">${escapeHtml(h.city)}</span></div>`;
      mpFeed.appendChild(b);
    }
    mpFeed.scrollTop = mpFeed.scrollHeight;
    if (r.history.length > prevCount && r.history.length > 0 && !isMyTurn) {
      const last = mpFeed.lastElementChild;
      if (last) last.classList.add("bubble-new");
    }

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

  // ───── Chat ─────────────────────────────────────────
  function toggleChat(open) {
    chatOpen = open !== undefined ? open : !chatOpen;
    chatPanel.classList.toggle("open", chatOpen);
    if (chatOpen) { unreadCount = 0; chatBadge.classList.add("hidden"); chatMessages.scrollTop = chatMessages.scrollHeight; }
  }
  chatFab?.addEventListener("click", () => toggleChat(true));
  chatCloseBtn?.addEventListener("click", () => toggleChat(false));
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
    if (!names.length) chatTyping.classList.add("hidden");
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

  // ───── Emoji reactions ──────────────────────────────
  document.querySelectorAll(".emoji-btn").forEach(btn => {
    btn.addEventListener("click", () => send("chat:emoji", { emoji: btn.dataset.emoji }));
  });
  function showFloatingEmoji(emoji, name) {
    const el = document.createElement("div");
    el.className = "emoji-float"; el.textContent = emoji;
    el.style.left = Math.random() * 80 + 10 + "%";
    emojiFloats.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  // ───── Voice / Video recording ──────────────────────
  let mediaRecorder = null, recordedChunks = [], recordStartTime = 0, recordInterval = null;
  voiceBtn?.addEventListener("click", async () => {
    if (!navigator.mediaDevices) return alert("Микрофон недоступен.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      mediaRecorder.start();
      recordStartTime = Date.now();
      recordingBar.classList.remove("hidden");
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

  let videoRecorder = null, videoChunks = [], videoStream = null, videoStartTime = 0, videoInterval = null;
  videoBtn?.addEventListener("click", async () => {
    if (!navigator.mediaDevices) return alert("Камера недоступна.");
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

  // ───── Events: lobby ────────────────────────────────
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

  // ───── Events: room ─────────────────────────────────
  startBtn.addEventListener("click", () => send("room:start"));
  rematchBtn.addEventListener("click", () => send("room:rematch"));
  extendBtn.addEventListener("click", () => send("room:extendAutoStart", { seconds: 60 }));
  surrenderBtn.addEventListener("click", () => { if (confirm("Сдаться?")) send("room:surrender"); });
  leaveBtn.addEventListener("click", () => { if (confirm("Выйти? Вы сможете вернуться по коду.")) send("room:leave"); });
  hintBtn.addEventListener("click", () => send("room:hint"));
  shareBtn.addEventListener("click", () => {
    const url = `${location.origin}/multi?code=${state.room?.code || ""}`;
    if (navigator.share) navigator.share({ title: "Города", url });
    else navigator.clipboard.writeText(url).then(() => setRoomMsg("Ссылка скопирована!", "ok"));
  });
  mpForm.addEventListener("submit", (e) => { e.preventDefault(); const c = mpInput.value.trim(); if (!c) return; send("room:move", { city: c }); mpInput.value = ""; setRoomMsg(""); });
  mpInput.addEventListener("input", () => { if (mpMessage.classList.contains("error")) setRoomMsg(""); });

  // ───── Init ─────────────────────────────────────────
  setConnStatus(false, "соединение…");
  (async () => {
    await loadConfig();
    await fetchMe();
    await loadAchievementsDefs();
    await loadShop();
    await loadThemes();
    updateLevelDisplay();
    connect();
    if (!profile.name) setTimeout(() => openProfileModal(), 400);
  })();
})();
