# Migration Notes

## What changed

- Auth logic moved from inline `server.js` handlers into modular route/service/middleware files.
- Token model now uses rotating refresh sessions with CSRF verification.
- Added role-aware route guard and account lockout handling.
- Added user personalization endpoints for saved locations and radar views.
- Added structured request metadata (`X-Request-Id`), slow-request logging, `/healthz`, `/metrics`.
- Added graceful shutdown handling for Render (`SIGTERM`, `SIGINT`).

## Compatibility

- Existing `POST /api/auth/register` and `POST /api/auth/login` still return `{ token, user }`.
- Existing Bearer token auth is still valid.
- Existing weather/radar routes are preserved.
- Existing env vars are still supported.

## New operational requirements

- Set a strong `JWT_SECRET` in production.
- Admin-only metrics endpoint requires user role `admin`.

## Rollback

1. Revert to the previous commit before modular auth extraction.
2. Redeploy on Render.
3. Ensure old auth tokens are re-issued by users if JWT config changed.
