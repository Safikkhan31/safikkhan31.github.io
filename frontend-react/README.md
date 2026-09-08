# Ascent — React frontend

This is a React (Vite) port of `frontend/index.html`. The gameplay, physics,
rendering, sound, HUD, and auth flow are functionally identical to the
vanilla version — only the code organization changed.

## Structure

```
frontend-react/
├── index.html              Vite HTML shell (keeps the AdSense loader script)
├── .env.example             Copy to .env — sets the backend API URL
├── src/
│   ├── main.jsx              React entry point
│   ├── App.jsx                Swaps between AuthScreen and Game based on auth status
│   ├── api.js                 fetch() wrapper + JWT storage (was auth.js's apiFetch)
│   ├── styles.css             Same CSS as the original, unchanged selectors
│   ├── context/
│   │   └── AuthContext.jsx    Login/signup/logout/submitScore/reportProgress/getLeaderboard
│   └── components/
│       ├── AuthScreen.jsx     Login/signup form (was the #authOverlay markup + auth.js wiring)
│       ├── Game.jsx           The canvas game engine — ported ~line-for-line
│       └── AdSlot.jsx         The AdSense slot (only reveals itself once an ad fills)
```

## What changed vs. the vanilla version (and why)

- **`Game.jsx`** wraps the entire original script in a single `useEffect`
  that runs once on mount, so the physics/rendering/input code is close to a
  direct copy-paste. It still reads/writes the DOM via `document.getElementById`
  exactly like the original — those elements are rendered by the same JSX
  with the same `id`s, so behavior is unchanged. A cleanup function was added
  (removes listeners, cancels the animation frame) since React effects can
  re-run, unlike a plain `<script>` tag that only ever runs once.
- **Auth** moved from a global `window.AscentAuth` object (`auth.js`) into a
  React context (`AuthContext.jsx`) so components can call `login`/`signup`/
  `submitScore`/etc. via `useAuth()`. The behavior (JWT in `localStorage`,
  same API endpoints, same request/response shapes) is unchanged.
- **`Game` only mounts once the user is authenticated** (`App.jsx` renders
  `<AuthScreen />` until then), so the old `'ascent:authready'` custom event
  is no longer needed — `Game` just reads the already-resolved `user` prop
  once, at mount, to seed the best score from the server.
- **The API base URL** is now a proper `.env` var (`VITE_API_BASE_URL`),
  since Vite actually supports env files (unlike the plain-HTML version,
  which had no build step to read one — see the note in the main README).

## Running it

```bash
cd frontend-react
npm install
cp .env.example .env    # edit if your backend isn't on localhost:5000
npm run dev
```

Vite will serve it on `http://localhost:5500` (configured in `vite.config.js`
to match the backend's sample `CORS_ORIGIN`). Build for production with
`npm run build` (outputs to `dist/`).

## Note

I wasn't able to run `npm install` / `npm run dev` in this environment (no
network access), so this hasn't been exercised in an actual browser end to
end — I've syntax-checked every file and cross-verified that every DOM id
the game script reads is actually rendered in the JSX, but please give it a
real run and let me know if anything needs adjusting.
