# Campus Now 🏫

A crowdsourced live-status app for campus life. Two tabs, one shared
idea: **anyone with an email can update or report — no admin
gatekeeper.** Built for a one-week "vibe coding" project.

- **🏛️ Rooms** — is a study spot or a rest/lounge area free right now?
- **🍽️ Cafeteria** — what's on the menu this week, how long is the
  queue, and how does everyone rate it?

## The problem

Students constantly waste time on two small but repeated questions:
*"Is there a free room to study/rest in?"* and *"What's the food/queue
situation at the cafeteria right now?"* Nobody tracks this centrally,
so everyone re-discovers it by walking over and checking.

## Core feature — pure crowdsourcing

Log in with just an email (no password, no signup flow) and you can:
- Set/update **any** room's status, purpose, and note
- Search and filter rooms
- ⭐ Favorite rooms
- 💬 Report/comment on any room or the cafeteria
- 🍽️ Edit any day's cafeteria menu
- ⏳ Report the cafeteria queue length
- ⭐ Rate the cafeteria (1–5 stars, real average shown)

Every visitor sees the same live data — the moment one person updates
something, everyone else's view catches up (polling every 8s), with a
brief glow animation on the card that changed.

## Pre-seeded data

The app ships with **24 rooms** across the library, CSE/EEE/Business
buildings, lounges, and rest spots, plus a full **7-day cafeteria
menu**, a sample queue status, one comment, and one rating — so it
looks alive the moment you open it, instead of empty. Everything is
still editable by anyone.

## Features

### 🌐 5 languages
বাংলা, English, 한국어, العربية, and Español — a language switcher (flag
pills) appears on the login page and inside the app header. Arabic
automatically switches the whole page to right-to-left layout. The
choice is remembered per browser. Data itself (day keys sent to the
server, purpose/status values) always stays in canonical English
internally — only what's *displayed* changes, so switching language
never breaks stored data. Translations live in `i18n.js`.

### Login / Welcome page
One simple screen: enter your email, hit Continue. That's the whole
flow — matches the "just email, no password" requirement.

### 🌡️ Campus Pulse bar
A live one-line summary above the tabs: `🟢 14 free · 🔴 10 occupied ·
☕ Queue: Medium` — the whole campus's status in one glance. This is
the app's "wow moment" for Demo Day.

### 🏛️ Rooms tab
- **Add / update a room** — anyone can set a room's purpose (Study 📚
  / Rest 🛋️), status (Free 🟢 / Occupied 🔴), and an optional note.
  Updating an existing room replaces its old entry (no duplicates).
- **✏️ Edit** any room — pre-fills the form with its current values.
- **🗑️ Delete** any room — asks for confirmation first, removes it
  entirely.
- **Search** by name, plus **All / Study / Rest** filter chips.
- "Free for 25 min" / "Occupied for 10 min" — calculated live from the
  report's timestamp, not typed in by hand.
- **⚠️ Stale warning** on any room "Occupied" for 3+ hours.
- **⭐ Favorites** per student.
- **💬 Report/comment thread** per room, open to everyone.
- Card **glows briefly** whenever its status just changed.

### 🍽️ Cafeteria tab
- **Weekly menu** — 7 day-chips (Sat–Fri) to switch between days;
  anyone can **✏️ edit** or **🗑️ delete** any day's menu.
- **Queue status** — Short 🙂 / Medium 😐 / Long 😣, color-coded,
  with "reported X ago".
- **⭐ Star rating** — a real 1–5 star average shown to everyone, plus
  your own rating (updatable any time).
- **💬 Comment thread** for general cafeteria feedback.

### The four states, everywhere
Every list handles: **Empty**, **Loading** (skeleton), **Error**
(banner + Retry), **Success** (instant toast).

## Design rationale

*(For the "why did you design it this way?" question.)*

| Principle | Where it shows up |
|---|---|
| **Affordance** | Color-coded pills, gradient primary buttons, pill-shaped tabs — function is obvious without reading labels. |
| **Constraints** | Submit buttons stay disabled until required fields are filled; ratings only accept 1–5. |
| **Feedback** | Every action gets an instant toast, and a room card glows when it just changed — updates feel alive, not static. |
| **Natural mapping** | Status colors (green/red) and queue colors (green/amber/red) are consistent across both tabs. |
| **Mental model** | One simple login, pill tabs, day-chips for the week — patterns borrowed from apps students already use. |
| **Visibility** | The Campus Pulse bar surfaces the single most useful number (how much is free right now) without cluttering the room list. |

## Tech stack

Zero external dependencies anywhere — no CDN, no npm install, no
build step. Works in Chrome, Firefox, Opera, Edge, desktop or mobile.

- **Frontend:** plain vanilla JavaScript (`app.js`) — a state
  object, a `render()` function, and event delegation.
- **Backend:** Node.js `http` module only. `local-server.js` serves the
  static frontend and a small REST API. (The one exception: the `api/`
  folder used only for a Vercel deployment depends on `@vercel/kv` —
  see "Deploying" below. `local-server.js` itself never needs it.)
- **Storage:** a single `data.json` file, read/written per request
  (Vercel deployments use Vercel KV instead — see below).

## Two ways to run it (for local-server.js / Render / Replit)

### 1. Double-click `index.html` — local mode, zero setup
Works instantly in any browser. Data is saved with `localStorage`, in
that browser only — good for a quick look, not the real shared app.

### 2. `node local-server.js` (or a deployed link) — shared mode, the real app
```bash
node local-server.js
```
Then open **http://localhost:3000**. No `npm install` needed. This is
the mode where every update is visible to everyone — **this is what
should be deployed and given to mentors** for Demo Day.

## Project structure

Frontend files sit at the repo root (not in a `public/` folder) —
this lets Vercel serve them automatically with **zero config**,
no `vercel.json` needed.

```
campus-now/
├── index.html          # Static shell, no external scripts
├── i18n.js               # Translations: bn / en / ko / ar / es
├── app.js                # Entire UI: state, render, event handling
├── style.css              # Decorated, gradient-accented visual design
├── local-server.js       # HTTP server + REST API (Render/Replit/local — no dependencies)
├── data.json             # Data store for local-server.js — pre-seeded with 24 rooms + weekly menu
├── package.json
├── api/                  # Serverless functions for Vercel (mirrors local-server.js's routes, uses a KV store)
│   ├── _lib/db.js          # Shared KV read/write helpers
│   ├── _lib/seed.js        # Same 24-room + weekly-menu seed, runs once per KV database
│   ├── rooms.js
│   ├── reports.js
│   ├── favorites.js
│   └── cafeteria.js, cafeteria/menu.js, cafeteria/queue.js, cafeteria/rating.js
└── README.md
```

## API reference

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/api/rooms` | — | List all rooms, newest first |
| POST | `/api/rooms` | `{ name, purpose, status, note, email }` | Set/upsert a room's status |
| DELETE | `/api/rooms` | `{ name }` | Delete a room entirely |
| POST | `/api/reports` | `{ room, message, email }` | Report/comment (`room: "cafeteria"` for cafeteria) |
| GET | `/api/cafeteria` | — | Weekly menu, queue, comments, rating |
| POST | `/api/cafeteria/menu` | `{ day, menu, email }` | Update one day's menu (`day` is a weekday name) |
| DELETE | `/api/cafeteria/menu` | `{ day }` | Delete one day's menu |
| POST | `/api/cafeteria/queue` | `{ level, email }` | Set queue length (`short`/`medium`/`long`) |
| POST | `/api/cafeteria/rating` | `{ stars, email }` | Submit/update your 1–5 star rating |
| GET | `/api/favorites?email=` | — | Get a user's favorites, streak, and their own rating |
| POST | `/api/favorites` | `{ email, room, action }` | Add/remove a favorite |

## Deploying (for the live link on Demo Day)

### Option A — Vercel (this repo already supports it)
Vercel runs serverless functions, not a persistent Node server, so the
`local-server.js` file isn't used here — instead, every `/api/...` route has
a matching file under `api/` (e.g. `api/rooms.js`). `index.html`,
`app.js`, `i18n.js`, and `style.css` sit at the repo root (not inside
a `public/` folder) so Vercel serves them automatically with **zero
config** — no `vercel.json` needed, one less thing that can go wrong.
Storage uses a Redis-compatible KV store since serverless functions
have no persistent filesystem.

1. Push this project to GitHub, import it into Vercel as normal.
2. In the Vercel dashboard, open your project → **Storage** tab →
   **Create Database**, and pick a Redis/KV option (the exact name
   shown depends on your Vercel account — "KV", "Redis", or an
   Upstash-powered Redis under "Marketplace Database Providers" are
   all fine). Connect it to this project.
3. Check **Settings → Environment Variables** — note whichever
   variable names got added (e.g. `KV_REST_API_URL` /
   `KV_REST_API_TOKEN`, or `REDIS_URL`). If they don't match what
   `api/_lib/db.js` expects, that file needs a small edit to read the
   variable names your storage actually created.
4. Redeploy (Vercel does this automatically after connecting storage,
   or trigger it manually from the Deployments tab).
5. The 24 demo rooms and 7-day menu seed themselves into KV on first
   request — no extra step needed.

### Option B — Render / Railway / Replit (uses local-server.js + data.json)
Because `local-server.js` has zero dependencies, deployment is a
one-command push on any plain Node host:

- **Replit** — create a Node repl, upload this folder or the zip, hit
  **Run**. The preview URL is your live link.
- **Render** — new Web Service → Build command: *(none)* → Start
  command: `node local-server.js`.
- **Railway** — `railway init` → `railway up`.

⚠️ Most free hosts use an *ephemeral* filesystem — `data.json` may
reset on redeploy or after inactivity. Check the live link before
presenting.

## Future scope

- **Real database** — swap `data.json` for SQLite/Postgres so data
  survives redeploys and scales past one building.
- **Push notifications** — alert a student when a favorited room goes
  free.
- **Photo attachments** on reports ("here's what it looks like now").
- **Multi-building / map view** — a campus map with room pins.
- **Analytics** — busiest cafeteria hours, most-reported-free rooms.
- **Light moderation** — flag/hide obviously spam reports, without a
  full admin gatekeeper.
- **PWA / offline support** — installable, with cached last-known state.
