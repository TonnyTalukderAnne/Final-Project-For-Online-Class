/**
 * Campus Now — backend
 *
 * Dependency-free Node.js HTTP server (only built-in http/fs/path/url
 * modules — no npm install needed). Data persists to data.json.
 *
 * Open crowdsourcing model: anyone who's entered an email can update
 * room status, the weekly cafeteria menu, queue length, ratings,
 * comments, and favorites. No admin/password layer — identity is just
 * an email, used for streaks and "last updated by" attribution.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = __dirname;

// Frontend files now live alongside local-server.js/data.json/package.json at
// the repo root (so the same layout works for a config-free Vercel
// deploy). Since they share a folder, only serve this exact allowlist
// over HTTP — never the whole directory — so data.json, local-server.js, and
// package.json are never accidentally exposed to a browser request.
const STATIC_FILES = new Set(['index.html', 'app.js', 'i18n.js', 'style.css']);

const WEEK_DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const DEFAULT_DATA = {
  rooms: {},
  cafeteria: {
    weeklyMenu: {},
    queue: null,
    comments: [],
    ratings: {},
  },
  users: {},
};

function readData() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  if (!data.rooms) data.rooms = {};
  if (!data.cafeteria) data.cafeteria = { weeklyMenu: {}, queue: null, comments: [], ratings: {} };
  if (!data.cafeteria.weeklyMenu) data.cafeteria.weeklyMenu = {};
  if (!data.cafeteria.comments) data.cafeteria.comments = [];
  if (!data.cafeteria.ratings) data.cafeteria.ratings = {};
  if (!data.users) data.users = {};
  return data;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function collectBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      cb(null, body ? JSON.parse(body) : {});
    } catch (err) {
      cb(err);
    }
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function bumpStreak(data, email) {
  const key = normalizeEmail(email);
  if (!key) return;
  if (!data.users[key]) data.users[key] = { favorites: [], streak: 0, lastReportDate: null };
  const u = data.users[key];
  const today = todayStr();
  if (u.lastReportDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    u.streak = u.lastReportDate === yesterday ? u.streak + 1 : 1;
    u.lastReportDate = today;
  }
}

function ratingSummary(ratings) {
  const values = Object.values(ratings);
  if (values.length === 0) return { average: 0, count: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / values.length) * 10) / 10, count: values.length };
}

const MIME_TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

function serveStatic(req, res, pathname) {
  const fileName = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (!STATIC_FILES.has(fileName)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const fullPath = path.join(PUBLIC_DIR, fileName);
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function cafeteriaPayload(data) {
  return {
    weeklyMenu: data.cafeteria.weeklyMenu,
    queue: data.cafeteria.queue,
    comments: data.cafeteria.comments,
    rating: ratingSummary(data.cafeteria.ratings),
  };
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- Rooms ----

  if (pathname === '/api/rooms' && req.method === 'GET') {
    const data = readData();
    const rooms = Object.values(data.rooms).sort((a, b) => b.timestamp - a.timestamp);
    return sendJSON(res, 200, { rooms });
  }

  if (pathname === '/api/rooms' && req.method === 'POST') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { name, purpose, status, note, email } = body;
      if (!name || !String(name).trim()) return sendJSON(res, 400, { error: 'Room name is required' });
      if (!['study', 'rest'].includes(purpose)) return sendJSON(res, 400, { error: 'Purpose must be "study" or "rest"' });
      if (!['free', 'occupied'].includes(status)) return sendJSON(res, 400, { error: 'Status must be "free" or "occupied"' });
      if (!email || !String(email).trim()) return sendJSON(res, 400, { error: 'Email is required' });

      const data = readData();
      const key = String(name).trim().toLowerCase();
      const existing = data.rooms[key];
      data.rooms[key] = {
        name: String(name).trim(),
        purpose,
        status,
        note: note ? String(note).trim().slice(0, 200) : '',
        timestamp: Date.now(),
        updatedBy: normalizeEmail(email),
        reports: existing ? existing.reports || [] : [],
      };
      bumpStreak(data, email);
      writeData(data);
      const rooms = Object.values(data.rooms).sort((a, b) => b.timestamp - a.timestamp);
      const user = data.users[normalizeEmail(email)] || { streak: 0 };
      return sendJSON(res, 200, { rooms, streak: user.streak });
    });
  }

  if (pathname === '/api/rooms' && req.method === 'DELETE') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { name } = body;
      if (!name || !String(name).trim()) return sendJSON(res, 400, { error: 'Room name is required' });

      const data = readData();
      const key = String(name).trim().toLowerCase();
      if (!data.rooms[key]) return sendJSON(res, 404, { error: 'Room not found' });
      delete data.rooms[key];
      writeData(data);
      const rooms = Object.values(data.rooms).sort((a, b) => b.timestamp - a.timestamp);
      return sendJSON(res, 200, { rooms });
    });
  }

  // ---- Room reports / comments ----

  if (pathname === '/api/reports' && req.method === 'POST') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { room, message, email } = body;
      if (!message || !String(message).trim()) return sendJSON(res, 400, { error: 'Message is required' });
      if (!email || !String(email).trim()) return sendJSON(res, 400, { error: 'Email is required' });

      const data = readData();
      const entry = {
        message: String(message).trim().slice(0, 300),
        email: normalizeEmail(email),
        timestamp: Date.now(),
      };

      if (!room || room === 'cafeteria') {
        data.cafeteria.comments.unshift(entry);
        data.cafeteria.comments = data.cafeteria.comments.slice(0, 30);
      } else {
        const key = String(room).trim().toLowerCase();
        if (!data.rooms[key]) return sendJSON(res, 404, { error: 'Room not found' });
        if (!data.rooms[key].reports) data.rooms[key].reports = [];
        data.rooms[key].reports.unshift(entry);
        data.rooms[key].reports = data.rooms[key].reports.slice(0, 20);
      }

      bumpStreak(data, email);
      writeData(data);
      const user = data.users[normalizeEmail(email)] || { streak: 0 };
      return sendJSON(res, 200, {
        rooms: Object.values(data.rooms).sort((a, b) => b.timestamp - a.timestamp),
        cafeteria: cafeteriaPayload(data),
        streak: user.streak,
      });
    });
  }

  // ---- Cafeteria ----

  if (pathname === '/api/cafeteria' && req.method === 'GET') {
    const data = readData();
    return sendJSON(res, 200, cafeteriaPayload(data));
  }

  if (pathname === '/api/cafeteria/menu' && req.method === 'POST') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { day, menu, email } = body;
      if (!WEEK_DAYS.includes(day)) return sendJSON(res, 400, { error: 'Invalid day' });
      if (typeof menu !== 'string') return sendJSON(res, 400, { error: 'Menu text is required' });
      if (!email || !String(email).trim()) return sendJSON(res, 400, { error: 'Email is required' });

      const data = readData();
      data.cafeteria.weeklyMenu[day] = {
        text: menu.trim().slice(0, 500),
        updatedAt: Date.now(),
        updatedBy: normalizeEmail(email),
      };
      bumpStreak(data, email);
      writeData(data);
      return sendJSON(res, 200, cafeteriaPayload(data));
    });
  }

  if (pathname === '/api/cafeteria/menu' && req.method === 'DELETE') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { day } = body;
      if (!WEEK_DAYS.includes(day)) return sendJSON(res, 400, { error: 'Invalid day' });

      const data = readData();
      delete data.cafeteria.weeklyMenu[day];
      writeData(data);
      return sendJSON(res, 200, cafeteriaPayload(data));
    });
  }

  if (pathname === '/api/cafeteria/queue' && req.method === 'POST') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { level, email } = body;
      if (!['short', 'medium', 'long'].includes(level)) return sendJSON(res, 400, { error: 'Queue level must be short, medium, or long' });
      if (!email || !String(email).trim()) return sendJSON(res, 400, { error: 'Email is required' });

      const data = readData();
      data.cafeteria.queue = { level, timestamp: Date.now(), updatedBy: normalizeEmail(email) };
      bumpStreak(data, email);
      writeData(data);
      return sendJSON(res, 200, cafeteriaPayload(data));
    });
  }

  if (pathname === '/api/cafeteria/rating' && req.method === 'POST') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { stars, email } = body;
      const n = Number(stars);
      if (!Number.isInteger(n) || n < 1 || n > 5) return sendJSON(res, 400, { error: 'Rating must be 1-5' });
      if (!email || !String(email).trim()) return sendJSON(res, 400, { error: 'Email is required' });

      const data = readData();
      data.cafeteria.ratings[normalizeEmail(email)] = n;
      bumpStreak(data, email);
      writeData(data);
      return sendJSON(res, 200, cafeteriaPayload(data));
    });
  }

  // ---- Favorites ----

  if (pathname === '/api/favorites' && req.method === 'GET') {
    const email = normalizeEmail(query.email);
    const data = readData();
    const user = data.users[email] || { favorites: [], streak: 0 };
    return sendJSON(res, 200, {
      favorites: user.favorites || [],
      streak: user.streak || 0,
      myRating: data.cafeteria.ratings[email] || 0,
    });
  }

  if (pathname === '/api/favorites' && req.method === 'POST') {
    return collectBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const email = normalizeEmail(body.email);
      const room = String(body.room || '').trim().toLowerCase();
      const action = body.action === 'remove' ? 'remove' : 'add';
      if (!email || !room) return sendJSON(res, 400, { error: 'Email and room are required' });

      const data = readData();
      if (!data.users[email]) data.users[email] = { favorites: [], streak: 0, lastReportDate: null };
      const favs = new Set(data.users[email].favorites || []);
      if (action === 'add') favs.add(room);
      else favs.delete(room);
      data.users[email].favorites = Array.from(favs);
      writeData(data);
      return sendJSON(res, 200, { favorites: data.users[email].favorites });
    });
  }

  if (pathname.startsWith('/api/')) {
    return sendJSON(res, 404, { error: 'Unknown endpoint' });
  }

  return serveStatic(req, res, pathname);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Campus Now is running → http://localhost:${PORT}`);
});
