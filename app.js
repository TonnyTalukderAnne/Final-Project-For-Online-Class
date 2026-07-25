/**
 * Campus Now — frontend
 *
 * Pure vanilla JavaScript. No React, no Babel, no CDN, no build step —
 * works in Chrome, Firefox, Opera, Edge, mobile browsers, anywhere.
 *
 * Language: Bangla, English, Korean, Arabic, Spanish — see i18n.js
 * (loaded before this file). Switching language only changes what's
 * displayed; data sent to the server (day keys, purpose/status values)
 * always stays in canonical English internally.
 *
 * Open crowdsourcing model: anyone who enters an email can update room
 * status, the weekly menu, queue length, ratings, comments, and
 * favorites — no admin/password layer.
 *
 * TWO RUN MODES, auto-detected by location.protocol:
 *  1. file:// (double-clicked index.html) → "local mode" — data lives
 *     in localStorage on this browser only.
 *  2. http(s):// (node server.js, or a deployed link) → "shared mode" —
 *     every update goes through the REST API, visible to everyone.
 */

(function () {
  'use strict';

  const root = document.getElementById('root');
  const isFileProtocol = location.protocol === 'file:';

  const I18N = window.CAMPUS_I18N;
  const WEEK_DAYS = I18N.DAY_KEYS;

  const SESSION_KEY = 'campusnow_session_v1';
  const LANG_KEY = 'campusnow_lang_v1';
  const LOCAL_ROOMS_KEY = 'campusnow_rooms_v1';
  const LOCAL_CAFETERIA_KEY = 'campusnow_cafeteria_v1';
  const LOCAL_USERS_KEY = 'campusnow_users_v1';

  function emptyCafeteria() {
    return { weeklyMenu: {}, queue: null, comments: [], rating: { average: 0, count: 0 } };
  }

  function detectDefaultLang() {
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const supported = ['bn', 'en', 'ko', 'ar', 'es'];
    return supported.includes(nav) ? nav : 'en';
  }

  // ---------- button click sound (synthesized, no audio files needed) ----------

  let audioCtx = null;

  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function playClickSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(360, now + 0.09);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  // ---------- local storage helpers ----------

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // localStorage disabled/full — local mode simply won't persist.
    }
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function bumpStreakLocal(email) {
    const users = readLocal(LOCAL_USERS_KEY, {});
    const key = String(email).trim().toLowerCase();
    if (!users[key]) users[key] = { favorites: [], streak: 0, lastReportDate: null };
    const u = users[key];
    const today = todayStr();
    if (u.lastReportDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      u.streak = u.lastReportDate === yesterday ? u.streak + 1 : 1;
      u.lastReportDate = today;
    }
    writeLocal(LOCAL_USERS_KEY, users);
    return u.streak;
  }

  function localRatingSummary(ratings) {
    const values = Object.values(ratings || {});
    if (values.length === 0) return { average: 0, count: 0 };
    const sum = values.reduce((a, b) => a + b, 0);
    return { average: Math.round((sum / values.length) * 10) / 10, count: values.length };
  }

  // ---------- storage / API adapters ----------

  const localApi = {
    getRooms() {
      const rooms = readLocal(LOCAL_ROOMS_KEY, {});
      return Promise.resolve({ rooms: Object.values(rooms).sort((a, b) => b.timestamp - a.timestamp) });
    },
    postRoom(payload) {
      if (!payload.name || !payload.name.trim()) return Promise.reject(new Error('Room name is required'));
      const rooms = readLocal(LOCAL_ROOMS_KEY, {});
      const key = payload.name.trim().toLowerCase();
      const existing = rooms[key];
      rooms[key] = {
        name: payload.name.trim(),
        purpose: payload.purpose,
        status: payload.status,
        note: (payload.note || '').trim().slice(0, 200),
        timestamp: Date.now(),
        updatedBy: payload.email,
        reports: existing ? existing.reports || [] : [],
      };
      writeLocal(LOCAL_ROOMS_KEY, rooms);
      const streak = bumpStreakLocal(payload.email);
      return Promise.resolve({ rooms: Object.values(rooms).sort((a, b) => b.timestamp - a.timestamp), streak });
    },
    deleteRoom(name) {
      const rooms = readLocal(LOCAL_ROOMS_KEY, {});
      const key = String(name).trim().toLowerCase();
      if (!rooms[key]) return Promise.reject(new Error('Room not found'));
      delete rooms[key];
      writeLocal(LOCAL_ROOMS_KEY, rooms);
      return Promise.resolve({ rooms: Object.values(rooms).sort((a, b) => b.timestamp - a.timestamp) });
    },
    postReport(payload) {
      const rooms = readLocal(LOCAL_ROOMS_KEY, {});
      const cafeteria = readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria());
      const entry = { message: String(payload.message).trim().slice(0, 300), email: payload.email.trim().toLowerCase(), timestamp: Date.now() };
      if (!payload.room || payload.room === 'cafeteria') {
        cafeteria.comments = cafeteria.comments || [];
        cafeteria.comments.unshift(entry);
        cafeteria.comments = cafeteria.comments.slice(0, 30);
        writeLocal(LOCAL_CAFETERIA_KEY, cafeteria);
      } else {
        const key = payload.room.trim().toLowerCase();
        if (!rooms[key]) return Promise.reject(new Error('Room not found'));
        rooms[key].reports = rooms[key].reports || [];
        rooms[key].reports.unshift(entry);
        rooms[key].reports = rooms[key].reports.slice(0, 20);
        writeLocal(LOCAL_ROOMS_KEY, rooms);
      }
      const streak = bumpStreakLocal(payload.email);
      return Promise.resolve({ rooms: Object.values(rooms).sort((a, b) => b.timestamp - a.timestamp), cafeteria, streak });
    },
    getCafeteria() {
      return Promise.resolve(readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria()));
    },
    postMenu(day, menu, email) {
      const data = readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria());
      data.weeklyMenu = data.weeklyMenu || {};
      data.weeklyMenu[day] = { text: String(menu).trim().slice(0, 500), updatedAt: Date.now(), updatedBy: email };
      writeLocal(LOCAL_CAFETERIA_KEY, data);
      bumpStreakLocal(email);
      return Promise.resolve(data);
    },
    deleteMenu(day) {
      const data = readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria());
      data.weeklyMenu = data.weeklyMenu || {};
      delete data.weeklyMenu[day];
      writeLocal(LOCAL_CAFETERIA_KEY, data);
      return Promise.resolve(data);
    },
    postQueue(level, email) {
      const data = readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria());
      data.queue = { level, timestamp: Date.now(), updatedBy: email };
      writeLocal(LOCAL_CAFETERIA_KEY, data);
      bumpStreakLocal(email);
      return Promise.resolve(data);
    },
    postRating(stars, email) {
      const data = readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria());
      data.ratings = data.ratings || {};
      data.ratings[String(email).trim().toLowerCase()] = stars;
      data.rating = localRatingSummary(data.ratings);
      writeLocal(LOCAL_CAFETERIA_KEY, data);
      bumpStreakLocal(email);
      return Promise.resolve(data);
    },
    getFavorites(email) {
      const users = readLocal(LOCAL_USERS_KEY, {});
      const cafeteria = readLocal(LOCAL_CAFETERIA_KEY, emptyCafeteria());
      const u = users[String(email).trim().toLowerCase()] || { favorites: [], streak: 0 };
      const myRating = (cafeteria.ratings || {})[String(email).trim().toLowerCase()] || 0;
      return Promise.resolve({ favorites: u.favorites || [], streak: u.streak || 0, myRating });
    },
    postFavorite(email, room, action) {
      const users = readLocal(LOCAL_USERS_KEY, {});
      const key = String(email).trim().toLowerCase();
      if (!users[key]) users[key] = { favorites: [], streak: 0, lastReportDate: null };
      const favs = new Set(users[key].favorites || []);
      const roomKey = room.trim().toLowerCase();
      if (action === 'remove') favs.delete(roomKey);
      else favs.add(roomKey);
      users[key].favorites = Array.from(favs);
      writeLocal(LOCAL_USERS_KEY, users);
      return Promise.resolve({ favorites: users[key].favorites });
    },
  };

  const serverApi = {
    getRooms() {
      return fetch('/api/rooms').then((r) => {
        if (!r.ok) throw new Error('Could not load rooms');
        return r.json();
      });
    },
    postRoom(payload) {
      return fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not save'); return d; }));
    },
    deleteRoom(name) {
      return fetch('/api/rooms', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not delete room'); return d; }));
    },
    postReport(payload) {
      return fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not submit report'); return d; }));
    },
    getCafeteria() {
      return fetch('/api/cafeteria').then((r) => {
        if (!r.ok) throw new Error('Could not load cafeteria status');
        return r.json();
      });
    },
    postMenu(day, menu, email) {
      return fetch('/api/cafeteria/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, menu, email }),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not update menu'); return d; }));
    },
    deleteMenu(day) {
      return fetch('/api/cafeteria/menu', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day }),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not delete menu'); return d; }));
    },
    postQueue(level, email) {
      return fetch('/api/cafeteria/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, email }),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not report queue'); return d; }));
    },
    postRating(stars, email) {
      return fetch('/api/cafeteria/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, email }),
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Could not submit rating'); return d; }));
    },
    getFavorites(email) {
      return fetch(`/api/favorites?email=${encodeURIComponent(email)}`).then((r) => {
        if (!r.ok) throw new Error('Could not load favorites');
        return r.json();
      });
    },
    postFavorite(email, room, action) {
      return fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, room, action }),
      }).then((r) => {
        if (!r.ok) throw new Error('Could not update favorites');
        return r.json();
      });
    },
  };

  // If the deployed backend (server API / storage) isn't working — e.g.
  // Vercel serverless storage not connected yet — the app falls back to
  // saving in this browser's localStorage instead of showing a broken
  // page. Once the real backend works, calls succeed normally and this
  // fallback never triggers. A lightweight circuit breaker avoids
  // re-trying a known-broken backend on every single click (which would
  // make the app feel slow) while still re-checking periodically in
  // case the backend gets fixed mid-session.
  let backendDown = false;
  let lastBackendCheck = 0;
  const BACKEND_RETRY_INTERVAL_MS = 20000;

  function withLocalFallback(primary, fallback) {
    const wrapped = {};
    Object.keys(primary).forEach((name) => {
      wrapped[name] = (...args) => {
        const now = Date.now();
        if (backendDown && (now - lastBackendCheck) < BACKEND_RETRY_INTERVAL_MS) {
          return fallback[name](...args);
        }
        lastBackendCheck = now;
        return primary[name](...args)
          .then((result) => {
            if (backendDown) {
              backendDown = false;
              usedFallbackStorage = false;
            }
            return result;
          })
          .catch((err) => {
            console.warn(`[Campus Now] "${name}" failed against the live backend (${err.message}) — using local browser storage instead.`);
            backendDown = true;
            usedFallbackStorage = true;
            return fallback[name](...args);
          });
      };
    });
    return wrapped;
  }

  let usedFallbackStorage = false;
  const api = isFileProtocol ? localApi : withLocalFallback(serverApi, localApi);

  // ---------- state ----------

  const state = {
    lang: readLocal(LANG_KEY, detectDefaultLang()),
    session: readLocal(SESSION_KEY, null), // { email }
    loginForm: { email: '' },
    loginError: null,

    tab: 'rooms',
    rooms: [],
    roomsLoading: true,
    roomsError: null,
    filter: 'all',
    search: '',
    prevTimestamps: {},
    justUpdated: {},
    showRoomForm: false,

    roomForm: { name: '', purpose: 'study', status: 'free', note: '' },
    roomSubmitting: false,

    reportDrafts: {},
    reportSubmitting: {},
    openReports: {},

    cafeteria: emptyCafeteria(),
    cafLoading: true,
    cafError: null,
    activeDay: WEEK_DAYS[new Date().getDay() === 6 ? 0 : new Date().getDay() + 1] || WEEK_DAYS[0],
    editingMenu: false,
    menuInput: '',
    savingMenu: false,
    savingQueue: null,
    myRating: 0,
    ratingSubmitting: false,

    favorites: [],
    streak: 0,

    toast: null,
  };

  // ---------- helpers ----------

  function t(key, vars) {
    return I18N.t(state.lang, key, vars);
  }

  function dayLabel(day) {
    return (I18N.STRINGS[state.lang] && I18N.STRINGS[state.lang].days[day]) || day;
  }

  function dayShortLabel(day) {
    return (I18N.STRINGS[state.lang] && I18N.STRINGS[state.lang].daysShort[day]) || day.slice(0, 3);
  }

  function dayEmoji(day) {
    return (I18N.STRINGS[state.lang] && I18N.STRINGS[state.lang].dayEmoji[day]) || '📅';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  function timeAgo(ts) {
    if (!ts) return t('justNow');
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('justNow');
    if (diffMin < 60) return `${diffMin} ${t('minUnit')}`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ${t('hrUnit')}`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} ${t('dayUnit')}`;
  }

  function isStale(room) {
    return room.status === 'occupied' && (Date.now() - room.timestamp) > 3 * 60 * 60 * 1000;
  }

  function isTyping() {
    const el = document.activeElement;
    return !!(el && el.tagName === 'INPUT' && root.contains(el));
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  }

  function showToast(message, type = 'success') {
    const key = Date.now();
    state.toast = { message, type, key };
    render();
    setTimeout(() => {
      if (state.toast && state.toast.key === key) {
        state.toast = null;
        render();
      }
    }, 2500);
  }

  function persistSession() {
    writeLocal(SESSION_KEY, state.session);
  }

  function applyDocumentLang() {
    const meta = I18N.STRINGS[state.lang] || I18N.STRINGS.en;
    document.documentElement.lang = state.lang;
    document.documentElement.dir = meta.dir || 'ltr';
  }

  // ---------- data actions ----------

  function fetchRooms() {
    return api.getRooms()
      .then((data) => {
        const nextRooms = data.rooms;
        const nextTs = {};
        nextRooms.forEach((r) => {
          const key = r.name.toLowerCase();
          nextTs[key] = r.timestamp;
          const prev = state.prevTimestamps[key];
          if (prev !== undefined && prev !== r.timestamp) {
            state.justUpdated[key] = true;
            setTimeout(() => {
              delete state.justUpdated[key];
              if (!isTyping()) render();
            }, 2200);
          }
        });
        state.prevTimestamps = nextTs;
        state.rooms = nextRooms;
        state.roomsLoading = false;
        state.roomsError = null;
        if (!isTyping()) render();
      })
      .catch((err) => {
        state.roomsError = err.message;
        state.roomsLoading = false;
        if (!isTyping()) render();
      });
  }

  function fetchCafeteria() {
    return api.getCafeteria()
      .then((data) => {
        state.cafeteria = data;
        state.cafLoading = false;
        state.cafError = null;
        if (!isTyping()) render();
      })
      .catch((err) => {
        state.cafError = err.message;
        state.cafLoading = false;
        if (!isTyping()) render();
      });
  }

  function fetchFavorites() {
    if (!state.session) return;
    api.getFavorites(state.session.email).then((data) => {
      state.favorites = data.favorites || [];
      state.streak = data.streak || 0;
      state.myRating = data.myRating || 0;
      render();
    }).catch(() => {});
  }

  function submitRoom(e) {
    e.preventDefault();
    if (!state.roomForm.name.trim() || state.roomSubmitting) return;
    state.roomSubmitting = true;
    render();
    api.postRoom({ ...state.roomForm, email: state.session.email })
      .then((data) => {
        state.rooms = data.rooms;
        if (data.streak) state.streak = data.streak;
        state.roomForm = { name: '', purpose: 'study', status: 'free', note: '' };
        state.roomSubmitting = false;
        state.showRoomForm = false;
        render();
        showToast(t('toastRoomSaved'));
      })
      .catch((err) => {
        state.roomSubmitting = false;
        render();
        showToast(err.message, 'error');
      });
  }

  function editRoom(key) {
    const room = state.rooms.find((r) => r.name.toLowerCase() === key);
    if (!room) return;
    state.roomForm = { name: room.name, purpose: room.purpose, status: room.status, note: room.note || '' };
    state.showRoomForm = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render();
  }

  function deleteRoom(key) {
    const room = state.rooms.find((r) => r.name.toLowerCase() === key);
    if (!room) return;
    if (!window.confirm(t('confirmDeleteRoom', { name: room.name }))) return;
    api.deleteRoom(room.name)
      .then((data) => {
        state.rooms = data.rooms;
        state.favorites = state.favorites.filter((f) => f !== key);
        render();
        showToast(t('toastRoomDeleted'));
      })
      .catch((err) => showToast(err.message, 'error'));
  }

  function submitReport(roomKey) {
    const message = (state.reportDrafts[roomKey] || '').trim();
    if (!message || state.reportSubmitting[roomKey]) return;
    state.reportSubmitting[roomKey] = true;
    render();
    api.postReport({ room: roomKey === 'cafeteria' ? 'cafeteria' : findRoomNameByKey(roomKey), message, email: state.session.email })
      .then((data) => {
        state.rooms = data.rooms;
        if (data.cafeteria) state.cafeteria = data.cafeteria;
        if (data.streak) state.streak = data.streak;
        state.reportDrafts[roomKey] = '';
        state.reportSubmitting[roomKey] = false;
        render();
        showToast(t('toastReportSubmitted'));
      })
      .catch((err) => {
        state.reportSubmitting[roomKey] = false;
        render();
        showToast(err.message, 'error');
      });
  }

  function findRoomNameByKey(key) {
    const room = state.rooms.find((r) => r.name.toLowerCase() === key);
    return room ? room.name : key;
  }

  function saveMenu() {
    state.savingMenu = true;
    render();
    api.postMenu(state.activeDay, state.menuInput, state.session.email)
      .then((data) => {
        state.cafeteria = data;
        state.editingMenu = false;
        state.savingMenu = false;
        render();
        showToast(t('toastMenuUpdated', { day: dayLabel(state.activeDay) }));
      })
      .catch((err) => {
        state.savingMenu = false;
        render();
        showToast(err.message, 'error');
      });
  }

  function deleteMenuDay() {
    if (!window.confirm(t('confirmDeleteMenu', { day: dayLabel(state.activeDay) }))) return;
    api.deleteMenu(state.activeDay)
      .then((data) => {
        state.cafeteria = data;
        state.editingMenu = false;
        render();
        showToast(t('toastMenuDeleted', { day: dayLabel(state.activeDay) }));
      })
      .catch((err) => showToast(err.message, 'error'));
  }

  function reportQueue(level) {
    state.savingQueue = level;
    render();
    api.postQueue(level, state.session.email)
      .then((data) => {
        state.cafeteria = data;
        state.savingQueue = null;
        render();
        showToast(t('toastQueueSaved'));
      })
      .catch((err) => {
        state.savingQueue = null;
        render();
        showToast(err.message, 'error');
      });
  }

  function submitRating(stars) {
    if (state.ratingSubmitting) return;
    state.ratingSubmitting = true;
    render();
    api.postRating(stars, state.session.email)
      .then((data) => {
        state.cafeteria = data;
        state.myRating = stars;
        state.ratingSubmitting = false;
        render();
        showToast(t('toastRatingThanks'));
      })
      .catch((err) => {
        state.ratingSubmitting = false;
        render();
        showToast(err.message, 'error');
      });
  }

  function toggleFavorite(roomKey) {
    const isFav = state.favorites.includes(roomKey);
    api.postFavorite(state.session.email, roomKey, isFav ? 'remove' : 'add')
      .then((data) => {
        state.favorites = data.favorites;
        render();
      })
      .catch((err) => showToast(err.message, 'error'));
  }

  function setLang(lang) {
    state.lang = lang;
    writeLocal(LANG_KEY, lang);
    render();
  }

  // ---------- login screen ----------

  function attemptLogin(e) {
    e.preventDefault();
    state.loginError = null;
    const email = state.loginForm.email.trim();
    if (!isValidEmail(email)) {
      state.loginError = t('invalidEmail');
      render();
      return;
    }
    state.session = { email: email.toLowerCase() };
    persistSession();
    state.loginForm = { email: '' };
    render();
    afterLogin();
  }

  function afterLogin() {
    fetchRooms();
    fetchCafeteria();
    fetchFavorites();
  }

  function logout() {
    state.session = null;
    state.favorites = [];
    state.streak = 0;
    persistSession();
    render();
  }

  // ---------- render: language switcher ----------

  function renderLangSwitcher(extraClass) {
    return `
      <div class="lang-switcher ${extraClass || ''}" role="group" aria-label="Language">
        ${I18N.LANG_META.map((m) => `<button class="lang-pill ${state.lang === m.code ? 'active' : ''}" data-action="set-lang" data-lang="${m.code}" title="${m.code}">${m.flag} ${escapeHtml(m.label)}</button>`).join('')}
      </div>
    `;
  }

  // ---------- render: login/welcome page ----------

  function renderLogin() {
    return `
      <div class="login-page">
        <div class="login-hero">
          <div class="floaty-emoji e1">📚</div>
          <div class="floaty-emoji e2">☕</div>
          <div class="floaty-emoji e3">🛋️</div>
          <div class="floaty-emoji e4">✨</div>
          ${renderLangSwitcher('lang-switcher-hero')}
          <div class="login-hero-inner">
            <div class="pulse-mark">
              <span class="pulse-ring"></span>
              <span class="pulse-dot">🎯</span>
            </div>
            <h1>${escapeHtml(t('appName'))}</h1>
            <p>${escapeHtml(t('tagline'))}</p>
          </div>
        </div>
        <div class="login-card-wrap">
          <div class="card login-card">
            <p class="login-sub">${escapeHtml(t('loginIntro'))}</p>
            <form data-form="login">
              <label class="form-row">${escapeHtml(t('emailLabel'))}
                <input type="email" name="loginEmail" value="${escapeHtml(state.loginForm.email)}" placeholder="${escapeHtml(t('emailPlaceholder'))}" required />
              </label>
              ${state.loginError ? `<div class="login-error" role="alert">${escapeHtml(state.loginError)}</div>` : ''}
              <button type="submit" class="btn-primary login-submit">${escapeHtml(t('continueBtn'))}</button>
            </form>
          </div>
        </div>
        <div class="dance-floor" aria-hidden="true">
          <span class="music-note n1">♪</span>
          <span class="music-note n2">♫</span>
          <svg class="panda-svg" viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="pandaHeadGrad" cx="40%" cy="35%" r="75%">
                <stop offset="0%" stop-color="#ffffff" />
                <stop offset="100%" stop-color="#ececeb" />
              </radialGradient>
              <radialGradient id="pandaBodyGrad" cx="40%" cy="25%" r="80%">
                <stop offset="0%" stop-color="#ffffff" />
                <stop offset="100%" stop-color="#e9e9e8" />
              </radialGradient>
            </defs>

            <g class="panda-leg panda-leg-left">
              <ellipse cx="76" cy="228" rx="19" ry="27" fill="#22201F" />
              <ellipse cx="76" cy="248" rx="13" ry="7" fill="#3a3735" />
            </g>
            <g class="panda-leg panda-leg-right">
              <ellipse cx="124" cy="228" rx="19" ry="27" fill="#22201F" />
              <ellipse cx="124" cy="248" rx="13" ry="7" fill="#3a3735" />
            </g>

            <ellipse cx="100" cy="172" rx="58" ry="58" fill="url(#pandaBodyGrad)" stroke="#22201F" stroke-width="3.5" />
            <ellipse cx="100" cy="178" rx="36" ry="38" fill="#FAFAF9" />

            <g class="panda-arm panda-arm-left">
              <ellipse cx="46" cy="168" rx="15" ry="32" fill="#22201F" />
            </g>
            <g class="panda-arm panda-arm-right">
              <ellipse cx="154" cy="168" rx="15" ry="32" fill="#22201F" />
            </g>

            <g class="panda-head-group">
              <circle cx="54" cy="66" r="24" fill="#22201F" />
              <circle cx="146" cy="66" r="24" fill="#22201F" />
              <circle cx="54" cy="66" r="12" fill="#3a3735" />
              <circle cx="146" cy="66" r="12" fill="#3a3735" />

              <circle cx="100" cy="98" r="64" fill="url(#pandaHeadGrad)" stroke="#22201F" stroke-width="3.5" />

              <ellipse cx="73" cy="100" rx="17" ry="24" fill="#22201F" transform="rotate(-14 73 100)" />
              <ellipse cx="127" cy="100" rx="17" ry="24" fill="#22201F" transform="rotate(14 127 100)" />

              <ellipse cx="66" cy="112" rx="11" ry="7" fill="#FFC3B0" opacity="0.6" />
              <ellipse cx="134" cy="112" rx="11" ry="7" fill="#FFC3B0" opacity="0.6" />

              <circle cx="76" cy="96" r="8.5" fill="#ffffff" />
              <circle cx="124" cy="96" r="8.5" fill="#ffffff" />
              <circle cx="78" cy="99" r="4" fill="#161616" />
              <circle cx="122" cy="99" r="4" fill="#161616" />
              <circle cx="80" cy="96" r="1.4" fill="#ffffff" />
              <circle cx="124" cy="96" r="1.4" fill="#ffffff" />

              <ellipse cx="100" cy="122" rx="10" ry="7" fill="#22201F" />
              <path d="M100 129 L100 136" stroke="#22201F" stroke-width="2.5" stroke-linecap="round" />
              <path d="M88 141 Q100 150 112 141" stroke="#22201F" stroke-width="3" fill="none" stroke-linecap="round" />
            </g>
          </svg>
          <span class="music-note n3">♪</span>
        </div>
      </div>
    `;
  }

  // ---------- render: campus pulse bar ----------

  function renderPulseBar() {
    const free = state.rooms.filter((r) => r.status === 'free').length;
    const occupied = state.rooms.filter((r) => r.status === 'occupied').length;
    const q = state.cafeteria.queue;
    const queueLabel = q ? ({ short: t('shortLabel'), medium: t('mediumLabel'), long: t('longLabel') })[q.level].replace(/^\S+\s/, '') : '—';
    const queueClass = q ? `pulse-queue-${q.level}` : '';
    return `
      <div class="pulse-bar">
        <span class="pulse-item"><span class="pulse-live-dot"></span>${escapeHtml(t('live'))}</span>
        <span class="pulse-item pulse-free">🟢 ${escapeHtml(t('freeCount', { n: free }))}</span>
        <span class="pulse-item pulse-occupied">🔴 ${escapeHtml(t('occupiedCount', { n: occupied }))}</span>
        <span class="pulse-item ${queueClass}">☕ ${escapeHtml(t('queueLabel', { level: queueLabel }))}</span>
      </div>
    `;
  }

  // ---------- render: rooms ----------

  function renderRoomForm() {
    return `
      <form class="card form-card room-form-card" data-form="room">
        <h2>${escapeHtml(t('addUpdateRoom'))}</h2>
        <label class="form-row">${escapeHtml(t('roomNameLabel'))}
          <input type="text" name="name" value="${escapeHtml(state.roomForm.name)}" placeholder="${escapeHtml(t('roomNamePlaceholder'))}" required />
        </label>
        <div class="form-row form-row-split">
          <label>${escapeHtml(t('purposeLabel'))}
            <select name="purpose">
              <option value="study" ${state.roomForm.purpose === 'study' ? 'selected' : ''}>${escapeHtml(t('studyOption'))}</option>
              <option value="rest" ${state.roomForm.purpose === 'rest' ? 'selected' : ''}>${escapeHtml(t('restOption'))}</option>
            </select>
          </label>
          <label>${escapeHtml(t('statusLabel'))}
            <select name="status">
              <option value="free" ${state.roomForm.status === 'free' ? 'selected' : ''}>${escapeHtml(t('freeOption'))}</option>
              <option value="occupied" ${state.roomForm.status === 'occupied' ? 'selected' : ''}>${escapeHtml(t('occupiedOption'))}</option>
            </select>
          </label>
        </div>
        <label class="form-row">${escapeHtml(t('noteLabel'))}
          <input type="text" name="note" value="${escapeHtml(state.roomForm.note)}" maxlength="200" placeholder="${escapeHtml(t('notePlaceholder'))}" />
        </label>
        <div class="room-form-actions">
          <button type="submit" class="btn-primary btn-pill" ${(!state.roomForm.name.trim() || state.roomSubmitting) ? 'disabled' : ''}>${state.roomSubmitting ? escapeHtml(t('savingBtn')) : escapeHtml(t('saveStatusBtn'))}</button>
          <button type="button" class="btn-ghost" data-action="hide-room-form">${escapeHtml(t('cancelBtn'))}</button>
        </div>
      </form>
    `;
  }

  function renderReportThread(room) {
    const key = room.name.toLowerCase();
    const open = !!state.openReports[key];
    const reports = room.reports || [];
    const draft = state.reportDrafts[key] || '';
    const submitting = !!state.reportSubmitting[key];

    return `
      <div class="report-thread">
        <button class="report-toggle" data-action="toggle-reports" data-room="${escapeHtml(key)}">
          ${escapeHtml(t('reportsCount', { n: reports.length }))} ${open ? '▲' : '▼'}
        </button>
        ${open ? `
          <div class="report-list">
            ${reports.length === 0
              ? `<p class="empty-state-inline">${escapeHtml(t('noReportsYet'))}</p>`
              : reports.slice(0, 5).map((r) => `<div class="report-item"><span class="report-email">👤 ${escapeHtml(r.email)}</span><span class="report-msg">${escapeHtml(r.message)}</span><span class="report-time">${timeAgo(r.timestamp)}</span></div>`).join('')}
          </div>
          <div class="report-form">
            <input type="text" data-report-input="${escapeHtml(key)}" value="${escapeHtml(draft)}" maxlength="300" placeholder="${escapeHtml(t('reportPlaceholder'))}" />
            <button class="btn-secondary btn-round" data-action="submit-report" data-room="${escapeHtml(key)}" ${(!draft.trim() || submitting) ? 'disabled' : ''}>${submitting ? '…' : '📤'}</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderRoomCard(room) {
    const key = room.name.toLowerCase();
    const isFree = room.status === 'free';
    const isFav = state.favorites.includes(key);
    const stale = isStale(room);
    const justUpdated = !!state.justUpdated[key];

    return `
      <div class="card room-card purpose-${room.purpose} status-border-${room.status} ${justUpdated ? 'just-updated' : ''}">
        <div class="room-card-top">
          <span class="purpose-badge">${room.purpose === 'study' ? '📚' : '🛋️'}</span>
          <span class="room-name">${escapeHtml(room.name)}</span>
          <button class="fav-btn ${isFav ? 'active' : ''}" data-action="toggle-fav" data-room="${escapeHtml(key)}" aria-label="favorite">${isFav ? '⭐' : '☆'}</button>
        </div>
        <div class="status-pill status-pill-${room.status}"><span class="live-dot-small"></span>${isFree ? t('freeOption') : t('occupiedOption')} · ${timeAgo(room.timestamp)}</div>
        ${stale ? `<div class="stale-badge">${escapeHtml(t('staleWarning'))}</div>` : ''}
        ${room.note ? `<p class="room-note">📝 ${escapeHtml(room.note)}</p>` : ''}
        <div class="room-card-actions">
          <button class="btn-ghost btn-tiny" data-action="edit-room" data-room="${escapeHtml(key)}">${escapeHtml(t('editBtn'))}</button>
          <button class="btn-ghost btn-tiny btn-danger" data-action="delete-room" data-room="${escapeHtml(key)}">${escapeHtml(t('deleteBtn'))}</button>
        </div>
        ${renderReportThread(room)}
      </div>
    `;
  }

  function renderSkeleton(count) {
    return `<div class="skeleton-list" aria-label="Loading" aria-busy="true">${
      Array.from({ length: count }).map(() => '<div class="skeleton-card"></div>').join('')
    }</div>`;
  }

  function filteredRooms() {
    let filtered = state.filter === 'all' ? state.rooms : state.rooms.filter((r) => r.purpose === state.filter);
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
    }
    return filtered;
  }

  function renderRoomsTab() {
    const filtered = filteredRooms();

    return `
      <div class="tab-panel">
        ${state.showRoomForm ? renderRoomForm() : `
          <button class="btn-primary btn-pill add-room-cta" data-action="show-room-form">${escapeHtml(t('addUpdateRoomCta'))}</button>
        `}

        <div class="card search-card">
          <span class="search-icon">🔍</span>
          <input type="text" data-field="room-search" value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t('searchPlaceholder'))}" />
        </div>

        <div class="list-header">
          <h2>${escapeHtml(t('roomsHeading', { n: filtered.length }))}</h2>
          <div class="filter-group" role="group" aria-label="Filter rooms by purpose">
            ${['all', 'study', 'rest'].map((f) => `<button class="filter-btn ${state.filter === f ? 'active' : ''}" data-action="set-filter" data-filter="${f}" aria-pressed="${state.filter === f}">${escapeHtml(f === 'all' ? t('filterAll') : f === 'study' ? t('filterStudy') : t('filterRest'))}</button>`).join('')}
          </div>
        </div>

        ${state.roomsError ? `<div class="error-banner" role="alert"><span>⚠️ ${escapeHtml(state.roomsError)}</span><button class="btn-secondary" data-action="retry-rooms">${escapeHtml(t('retryBtn'))}</button></div>` : ''}

        ${state.roomsLoading
          ? renderSkeleton(3)
          : filtered.length === 0
            ? `<div class="empty-state"><p>${escapeHtml(state.search.trim() ? t('noRoomsMatch') : t('noRoomsYet'))}</p></div>`
            : `<div class="room-grid">${filtered.map(renderRoomCard).join('')}</div>`}
      </div>
    `;
  }

  // ---------- render: cafeteria ----------

  function renderStars(current, interactive) {
    let html = '<div class="star-row">';
    for (let i = 1; i <= 5; i++) {
      html += `<button class="star-btn ${i <= current ? 'filled' : ''}" ${interactive ? `data-action="rate" data-stars="${i}"` : 'disabled'}>★</button>`;
    }
    html += '</div>';
    return html;
  }

  function renderCafeteriaComments() {
    const comments = state.cafeteria.comments || [];
    const open = !!state.openReports['cafeteria'];
    const draft = state.reportDrafts['cafeteria'] || '';
    const submitting = !!state.reportSubmitting['cafeteria'];

    return `
      <div class="card">
        <button class="report-toggle" data-action="toggle-reports" data-room="cafeteria">
          ${escapeHtml(t('commentsCount', { n: comments.length }))} ${open ? '▲' : '▼'}
        </button>
        ${open ? `
          <div class="report-list">
            ${comments.length === 0
              ? `<p class="empty-state-inline">${escapeHtml(t('noCommentsYet'))}</p>`
              : comments.slice(0, 8).map((c) => `<div class="report-item"><span class="report-email">👤 ${escapeHtml(c.email)}</span><span class="report-msg">${escapeHtml(c.message)}</span><span class="report-time">${timeAgo(c.timestamp)}</span></div>`).join('')}
          </div>
          <div class="report-form">
            <input type="text" data-report-input="cafeteria" value="${escapeHtml(draft)}" maxlength="300" placeholder="${escapeHtml(t('commentPlaceholder'))}" />
            <button class="btn-secondary btn-round" data-action="submit-report" data-room="cafeteria" ${(!draft.trim() || submitting) ? 'disabled' : ''}>${submitting ? '…' : '📤'}</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderCafeteriaTab() {
    if (state.cafLoading) {
      return `<div class="tab-panel">${renderSkeleton(2)}</div>`;
    }

    const d = state.cafeteria;
    const dayEntry = (d.weeklyMenu || {})[state.activeDay];

    return `
      <div class="tab-panel">
        ${state.cafError ? `<div class="error-banner" role="alert"><span>⚠️ ${escapeHtml(state.cafError)}</span><button class="btn-secondary" data-action="retry-cafeteria">${escapeHtml(t('retryBtn'))}</button></div>` : ''}

        <div class="card menu-card">
          <div class="menu-card-header">
            <h2>${escapeHtml(t('weeklyMenuHeading'))}</h2>
            ${dayEntry ? `<span class="time-since">${escapeHtml(t('updatedAgo', { t: timeAgo(dayEntry.updatedAt) }))}</span>` : ''}
          </div>
          <div class="day-selector">
            ${WEEK_DAYS.map((day) => `<button class="day-chip ${state.activeDay === day ? 'active' : ''}" data-action="set-day" data-day="${day}">${dayEmoji(day)} ${escapeHtml(dayShortLabel(day))}</button>`).join('')}
          </div>

          ${state.editingMenu ? `
            <div class="menu-edit">
              <input type="text" data-field="menu-input" value="${escapeHtml(state.menuInput)}" maxlength="500" placeholder="${escapeHtml(dayLabel(state.activeDay))}" />
              <div class="menu-edit-actions">
                <button class="btn-primary btn-pill" data-action="save-menu" ${state.savingMenu ? 'disabled' : ''}>${state.savingMenu ? escapeHtml(t('savingBtn')) : escapeHtml(t('saveDayBtn', { day: dayLabel(state.activeDay) }))}</button>
                <button class="btn-ghost" data-action="cancel-menu">${escapeHtml(t('cancelBtn'))}</button>
              </div>
            </div>
          ` : `
            <div class="menu-display">
              <p class="${dayEntry && dayEntry.text ? '' : 'empty-state-inline'}">${dayEntry && dayEntry.text ? escapeHtml(dayEntry.text) : escapeHtml(t('noMenuForDay', { day: dayLabel(state.activeDay) }))}</p>
              <div class="menu-display-actions">
                <button class="btn-secondary btn-round" data-action="edit-menu" title="${escapeHtml(t('editBtn'))}">✏️</button>
                ${dayEntry && dayEntry.text ? `<button class="btn-secondary btn-round btn-danger" data-action="delete-menu" title="${escapeHtml(t('deleteBtn'))}">🗑️</button>` : ''}
              </div>
            </div>
          `}
        </div>

        <div class="card queue-card">
          <h2>${escapeHtml(t('queueStatusHeading'))}</h2>
          ${d.queue
            ? `<div class="queue-pill queue-pill-${d.queue.level}">${escapeHtml(({ short: t('shortLabel'), medium: t('mediumLabel'), long: t('longLabel') })[d.queue.level])} — ${escapeHtml(t('queueReportedAgo', { t: timeAgo(d.queue.timestamp) }))}</div>`
            : `<p class="empty-state-inline">${escapeHtml(t('noQueueYet'))}</p>`}
          <div class="queue-buttons">
            <button class="queue-btn queue-btn-short" data-action="report-queue" data-level="short" ${state.savingQueue === 'short' ? 'disabled' : ''}>${state.savingQueue === 'short' ? '…' : escapeHtml(t('shortLabel'))}</button>
            <button class="queue-btn queue-btn-medium" data-action="report-queue" data-level="medium" ${state.savingQueue === 'medium' ? 'disabled' : ''}>${state.savingQueue === 'medium' ? '…' : escapeHtml(t('mediumLabel'))}</button>
            <button class="queue-btn queue-btn-long" data-action="report-queue" data-level="long" ${state.savingQueue === 'long' ? 'disabled' : ''}>${state.savingQueue === 'long' ? '…' : escapeHtml(t('longLabel'))}</button>
          </div>
        </div>

        <div class="card rating-card">
          <h2>${escapeHtml(t('rateCafeteriaHeading'))}</h2>
          <div class="rating-summary">
            <span class="rating-number">${d.rating && d.rating.average ? d.rating.average : '—'}</span>
            ${renderStars(d.rating ? Math.round(d.rating.average) : 0, false)}
            <span class="rating-count">${escapeHtml(t('ratingsCountLabel', { n: d.rating ? d.rating.count : 0 }))}</span>
          </div>
          <p class="rating-your-label">${escapeHtml(t('yourRatingLabel'))}</p>
          ${renderStars(state.myRating, true)}
        </div>

        ${renderCafeteriaComments()}
      </div>
    `;
  }

  // ---------- render: app shell ----------

  function render() {
    applyDocumentLang();

    if (!state.session) {
      root.innerHTML = renderLogin();
      return;
    }

    root.innerHTML = `
      <div class="app">
        <header class="app-header">
          <div class="app-header-top">
            <h1>🏫 ${escapeHtml(t('appName'))}</h1>
            <div class="user-chip">
              ${state.streak > 0 ? `<span class="streak-badge">🔥 ${state.streak}</span>` : ''}
              <span class="user-email">👤 ${escapeHtml(state.session.email)}</span>
              <button class="btn-secondary btn-round logout-btn" data-action="logout" title="${escapeHtml(t('logout'))}">🚪</button>
            </div>
          </div>
          ${renderLangSwitcher('lang-switcher-app')}
          ${isFileProtocol ? `<div class="mode-banner">${t('localModeBanner')}</div>` : ''}
          ${!isFileProtocol && usedFallbackStorage ? `<div class="mode-banner">⚠️ Live backend storage isn't responding right now — running on this browser's local storage instead, so the app stays usable. Reports here won't be shared with other visitors until the backend is fixed.</div>` : ''}
          ${renderPulseBar()}
          <nav class="tabs" role="tablist">
            <button role="tab" aria-selected="${state.tab === 'rooms'}" class="tab-btn ${state.tab === 'rooms' ? 'active' : ''}" data-action="switch-tab" data-tab="rooms">🏛️ ${escapeHtml(t('roomsTabLabel'))}</button>
            <button role="tab" aria-selected="${state.tab === 'cafeteria'}" class="tab-btn ${state.tab === 'cafeteria' ? 'active' : ''}" data-action="switch-tab" data-tab="cafeteria">🍽️ ${escapeHtml(t('cafeteriaTabLabel'))}</button>
          </nav>
        </header>
        <main>${state.tab === 'rooms' ? renderRoomsTab() : renderCafeteriaTab()}</main>
      </div>
      ${state.toast ? `<div class="toast toast-${state.toast.type}" role="status" aria-live="polite">${escapeHtml(state.toast.message)}</div>` : ''}
    `;

    if (state.editingMenu) {
      const el = root.querySelector('[data-field="menu-input"]');
      if (el && document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  // ---------- event delegation ----------

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'set-lang') { setLang(btn.dataset.lang); }
    else if (action === 'switch-tab') { state.tab = btn.dataset.tab; render(); }
    else if (action === 'set-filter') { state.filter = btn.dataset.filter; render(); }
    else if (action === 'retry-rooms') { state.roomsLoading = true; render(); fetchRooms(); }
    else if (action === 'retry-cafeteria') { state.cafLoading = true; render(); fetchCafeteria(); }
    else if (action === 'show-room-form') { state.showRoomForm = true; render(); }
    else if (action === 'hide-room-form') { state.showRoomForm = false; render(); }
    else if (action === 'set-day') {
      state.activeDay = btn.dataset.day;
      state.editingMenu = false;
      const entry = (state.cafeteria.weeklyMenu || {})[state.activeDay];
      state.menuInput = entry ? entry.text : '';
      render();
    }
    else if (action === 'edit-menu') {
      const entry = (state.cafeteria.weeklyMenu || {})[state.activeDay];
      state.menuInput = entry ? entry.text : '';
      state.editingMenu = true;
      render();
    }
    else if (action === 'cancel-menu') { state.editingMenu = false; render(); }
    else if (action === 'save-menu') { saveMenu(); }
    else if (action === 'delete-menu') { deleteMenuDay(); }
    else if (action === 'report-queue') { reportQueue(btn.dataset.level); }
    else if (action === 'rate') { submitRating(Number(btn.dataset.stars)); }
    else if (action === 'toggle-fav') { toggleFavorite(btn.dataset.room); }
    else if (action === 'edit-room') { editRoom(btn.dataset.room); }
    else if (action === 'delete-room') { deleteRoom(btn.dataset.room); }
    else if (action === 'toggle-reports') {
      const key = btn.dataset.room;
      state.openReports[key] = !state.openReports[key];
      render();
    } else if (action === 'submit-report') { submitReport(btn.dataset.room); }
    else if (action === 'logout') { logout(); }
  }

  function handleSubmit(e) {
    if (e.target.matches('[data-form="login"]')) attemptLogin(e);
    else if (e.target.matches('[data-form="room"]')) submitRoom(e);
  }

  function handleInputOrChange(e) {
    const t = e.target;

    if (t.closest('[data-form="login"]')) {
      if (t.name === 'loginEmail') state.loginForm.email = t.value;
      return;
    }

    if (t.closest('[data-form="room"]') && t.name) {
      state.roomForm[t.name] = t.value;
      const submitBtn = t.closest('form').querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = !state.roomForm.name.trim() || state.roomSubmitting;
      return;
    }

    if (t.dataset.field === 'menu-input') {
      state.menuInput = t.value;
      return;
    }

    if (t.dataset.field === 'room-search') {
      state.search = t.value;
      renderRoomListOnly();
      return;
    }

    if (t.dataset.reportInput !== undefined) {
      const key = t.dataset.reportInput;
      state.reportDrafts[key] = t.value;
      const sendBtn = root.querySelector(`[data-action="submit-report"][data-room="${CSS.escape(key)}"]`);
      if (sendBtn) sendBtn.disabled = !t.value.trim() || !!state.reportSubmitting[key];
    }
  }

  // Re-render just the room list so the search input never loses focus.
  function renderRoomListOnly() {
    const container = root.querySelector('.tab-panel');
    if (!container || state.tab !== 'rooms') { render(); return; }
    const filtered = filteredRooms();
    const listHtml = state.roomsLoading
      ? renderSkeleton(3)
      : filtered.length === 0
        ? `<div class="empty-state"><p>${escapeHtml(state.search.trim() ? t('noRoomsMatch') : t('noRoomsYet'))}</p></div>`
        : `<div class="room-grid">${filtered.map(renderRoomCard).join('')}</div>`;

    const heading = container.querySelector('.list-header h2');
    if (heading) heading.textContent = t('roomsHeading', { n: filtered.length });

    const existingGrid = container.querySelector('.room-grid, .empty-state, .skeleton-list');
    if (existingGrid) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = listHtml;
      existingGrid.replaceWith(wrapper.firstElementChild);
    }
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('button')) playClickSound();
  });
  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('input', handleInputOrChange);
  root.addEventListener('change', handleInputOrChange);

  // ---------- init ----------

  render();
  if (state.session) {
    afterLogin();
    setInterval(fetchRooms, 8000);
    setInterval(fetchCafeteria, 8000);
  }
})();
