# Ascent — Full Stack Project

Your bounce-to-the-sky canvas game, now with accounts and a MongoDB-backed
high score. Two independent pieces:

```
ascent-game/
├── backend/         Node.js + Express + MongoDB API (signup/login + scores)
├── frontend/         Original vanilla version — your game (index.html) + auth.js
└── frontend-react/   React (Vite) port of the same frontend — see its own README.md
```

The game logic itself (physics, rendering, procedural platforms) is
**unchanged** across both frontends — only the score-saving path and a login
screen were added, and `frontend-react` is a structural port of that same
code into React components. Pick whichever frontend you want to run; both
talk to the same backend.

---

## 1. Backend setup

### Requirements
- Node.js 18+
- A MongoDB database — either:
  - Local MongoDB (`mongodb://127.0.0.1:27017`), or
  - A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (recommended if you don't want to install MongoDB locally)

### Steps
```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
```
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/ascent_game     # or your Atlas URI
JWT_SECRET=some_long_random_string                     # change this
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5500,http://127.0.0.1:5500 # your frontend's origin(s)
```

Run it:
```bash
npm run dev      # with nodemon, auto-restarts on changes
# or
npm start
```

You should see:
```
MongoDB connected: <host>
Ascent API listening on port 5000
```

Sanity check: open `http://localhost:5000/api/health` — it should return `{"status":"ok"}`.

---

## 2. Frontend setup

> Prefer React? See `frontend-react/README.md` instead — same functionality,
> Vite dev server, real `.env` support. The steps below are for the plain
> `frontend/` (vanilla HTML/JS) version.

The frontend is static (`index.html` + `auth.js`), but it must be served over
`http://` (not opened as a `file://` path) for `fetch()` calls to the backend
to behave predictably with CORS. Easiest options:

**Option A — VS Code "Live Server" extension**
Right-click `frontend/index.html` → "Open with Live Server" (defaults to
`http://127.0.0.1:5500`, which matches the sample `.env`).

**Option B — Python's built-in server**
```bash
cd frontend
python3 -m http.server 5500
```
Then open `http://localhost:5500`.

If your frontend runs on a different port, update `CORS_ORIGIN` in the
backend's `.env` to match, and restart the backend.

### Pointing the frontend at your backend
`frontend/auth.js` calls the API at:
```js
const API_BASE_URL = window.ASCENT_API_BASE_URL || 'http://localhost:5000/api';
```
For local dev this just works. When you deploy the backend somewhere (Render,
Railway, Fly.io, etc.), set it before `auth.js` loads by adding this line in
`index.html` right before `<script src="auth.js"></script>`:
```html
<script>window.ASCENT_API_BASE_URL = 'https://your-backend-domain.com/api';</script>
```

---

## 3. How it works

- On page load, `auth.js` checks for a saved JWT. If present and valid, it
  fetches the account (`GET /api/auth/me`) and reveals the game. If not, it
  shows the login/signup screen.
- Signing up or logging in stores a JWT in `localStorage` and reveals the
  game.
- When the player reaches the top of the shaft (`onWin` in the game script),
  the run's height and bounce count are POSTed to `/api/scores`. The server
  only raises the stored `highScore` if the new run beat it — it doesn't
  trust the client blindly.
- `localStorage`'s existing best-score display still works offline; the
  server value simply overrides it once available, so the UI never regresses
  even without a network connection.

---

## 4. API reference

All endpoints are prefixed with `/api`.

| Method | Path                 | Auth? | Body                              | Description                        |
|--------|----------------------|-------|------------------------------------|-------------------------------------|
| GET    | `/health`             | No    | —                                   | Health check                        |
| POST   | `/auth/signup`        | No    | `{ username, password }`           | Create account, returns `{ token, user }` |
| POST   | `/auth/login`         | No    | `{ username, password }`           | Log in, returns `{ token, user }`   |
| GET    | `/auth/me`            | Yes   | —                                   | Returns `{ user }` for the current token |
| POST   | `/scores`             | Yes   | `{ height, bounces }`               | Submits a run; returns updated `{ isNewHighScore, highScore, gamesPlayed, totalBounces }` |
| GET    | `/scores/leaderboard` | No    | query: `?limit=10`                  | Top players by high score           |

Authenticated requests need:
```
Authorization: Bearer <token>
```

`username`: 3-20 chars, letters/numbers/underscores only (stored lowercase).
`password`: minimum 6 characters (hashed with bcrypt, never stored in plaintext).

---

## 5. Admin: ball trajectory debug tool

Any account can be promoted to `admin` for testing purposes. Admins see an
extra "Trajectory" toggle button in-game (top-left) that:
- draws the ball's **actual** flight path (magenta line) since its last launch, and
- while aiming, draws a **predicted** flight path (dashed cyan line) showing
  exactly where the current drag would send the ball if released now — pure
  ballistics simulation, no collisions — using the same physics as the real
  game. Useful for verifying the platform-reachability guarantees while
  testing.

Promoting an account requires direct server/database access (deliberately
not exposed as an API endpoint, so nobody can grant themselves admin):
```bash
cd backend
node scripts/makeAdmin.js <username>            # promote
node scripts/makeAdmin.js <username> --revoke    # demote back to a normal user
```
The `role` field (`'user'` | `'admin'`) is returned in the `/auth/me`,
`/auth/login`, and `/auth/signup` responses, so both frontends already pick
it up automatically on login — no other setup needed.

## 6. Notes / next steps you might want

- Add rate limiting (e.g. `express-rate-limit`) on `/auth/*` to slow down
  brute-force attempts.
- Add email + password-reset flow if you want recoverable accounts.
- Add a leaderboard screen in the frontend (`AscentAuth.getLeaderboard()` is
  already wired up and ready to call).
- Move `JWT_SECRET` and `MONGODB_URI` into your hosting provider's secret
  manager rather than a committed `.env` file.
