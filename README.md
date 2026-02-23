# Storm Surge Weather

Storm Surge Weather is a Node.js + Mapbox weather platform with radar playback, weather fallback providers, alerts, and account-backed personalization.

## Quick Start (Local)

```bash
npm install
cp .env.example .env
npm run dev
```

Server starts on `PORT` (default `3001`).

## Render Deployment

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Health check path:** `/healthz`
- **Required env vars:** `JWT_SECRET` (strong), provider keys as needed.

## Environment Variables

See `.env.example` for full list.

## Architecture Notes

```text
Client (public/*)
  ├─ app.js             # map UI, radar playback controls, auth UI, API calls
  ├─ RadarAnimator.js   # frame playback abstraction and map layer animation
  └─ index.html/style.css

Server (server.js + modules)
  ├─ routes/authRoutes.js
  ├─ middleware/auth.js + middleware/validation.js
  ├─ services/tokenService.js + services/userService.js
  └─ utils/security.js

Storage strategy
  ├─ Google Cloud Storage JSON blobs (preferred)
  └─ in-memory fallback when GCS unavailable

Radar strategy
  ├─ /api/radar/frames      # frame manifest (RainViewer or synthetic)
  ├─ /api/radar/tile        # resilient tile proxy + synthetic fallback
  └─ Client preloading/caching + requestAnimationFrame playback

Observability
  ├─ X-Request-Id response header
  ├─ Slow request logs
  ├─ /healthz and /api/health
  └─ /metrics (admin role)
```

## Security Model

- Access token (short-lived, 15m) returned in login/register responses.
- Refresh token rotation stored server-side (hashed) and delivered in HttpOnly cookie.
- CSRF protection for refresh flow using `X-CSRF-Token` + csrf cookie match.
- Password policy enforcement (length + complexity).
- Failed-login lockout window for brute-force resistance.
- Email verification and password-reset token workflows.
- RBAC guard (`user/moderator/admin`) available for privileged routes.

## Feature Inventory

- Account register/login/refresh/logout.
- Saved locations (`/api/user/locations`).
- Favorite radar views (`/api/user/radar-views`).
- Radar playback controls (timeline, fps, opacity, debug).
- Weather provider fallback chain (WeatherNext2 → Open-Meteo → synthetic).
- Advanced weather/radar helper endpoints and synthetic backstops.

## Testing

```bash
npm run test:syntax
npm test
```

The smoke tests validate auth, health, and radar frame basics.

## Desktop Packaging Plan (Hosted now, Desktop later)

- Current frontend already supports API base override via `window.SS_API_URL` in `public/app.js`.
- **Hosted mode (default):** browser uses Render API origin.
- **Desktop mode later:** set `window.SS_API_URL=http://127.0.0.1:<port>` and run local sidecar API.
- Sidecar choices:
  - Electron + Node sidecar process
  - Tauri + remote API default, optional local sidecar
- Keep storage portable by introducing repository abstraction (SQLite local, hosted storage remote) in a future step.
