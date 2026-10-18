# TaskBoard

A Kanban project board for teams, modelled on the "Fernly" reference videos: a drag-and-drop
board, a dashboard, analytics, and team roles, with two-factor sign-in required for everyone.

| Part | Stack |
| --- | --- |
| API | ASP.NET Core 10, EF Core, ASP.NET Identity (cookie sessions + TOTP 2FA), SignalR |
| Web | React 19, Vite, TypeScript, Tailwind CSS 4, dnd-kit, Recharts, Motion, Hugeicons |
| Data | Oracle 19c via Oracle.EntityFrameworkCore, SQL pinned to 19c (SQLite in-memory for tests) |
| Run | Docker Compose: Caddy (HTTPS) → nginx (static + proxy) → API → the organisation's Oracle 19c |

## Features

- **Board**: columns with a stage type (To do / In progress / Review / Done), drag cards within and
  across columns (mouse, touch and keyboard), filters, search, quick add. Changes appear live in
  every open browser through SignalR.
- **Cards**: title, description, project, tag, priority, due date, assignees, checklist,
  comments, tracked hours.
- **Dashboard**: count-up stats, this week's completions vs last week, project progress,
  "my tasks", recent activity.
- **Analytics**: 7/30/90-day ranges with comparison to the previous period, throughput,
  on-time delivery, cycle time, time by project, 12-week activity heatmap, top contributors,
  CSV export.
- **Team**: Owner / Admin / Member / Viewer roles, email-bound invite links that expire in 7 days.
- **Arabic, right-to-left**: the whole UI, server messages, sample data and CSV export are in
  Arabic; dates use the Gregorian calendar with Western digits.
- **Design system**: [Platforms Code](https://design.dga.gov.sa) (DGA, كود المنصات) foundations:
  SA-flag green `#1B8354`, neutral and status palettes, IBM Plex Sans Arabic (self-hosted),
  Hugeicons, 40px buttons and fields with 4px corners, 8px cards. The DGA page templates
  (home, service, contact…) are for public websites and were not used; the board, dashboard and
  analytics screens are built from the foundations and components.
- **Theme**: one accent colour per workspace re-tints the whole UI (green by default); light and dark mode.

## Security

- 2FA (TOTP, any authenticator app) is mandatory: a new account can only reach the enrolment
  endpoints until it is turned on. 10 single-use recovery codes. Optional "remember this device".
- Lockout after 5 wrong passwords or codes (10 min); per-IP rate limit on sign-in endpoints.
- HttpOnly, SameSite=Strict, Secure cookies; a required `X-Requested-With` header blocks CSRF.
- Workspace ids belonging to other teams return 404, so they cannot be probed.
- CSV export defuses spreadsheet formulas. nginx sends CSP, frame and content-type headers;
  Caddy adds HSTS.

## Run locally

```bash
docker compose -f docker-compose.dev.yml up -d          # Oracle Free on 127.0.0.1:1521 (stands in for 19c)
dotnet run --project backend/TaskBoard.Api --launch-profile http   # API on :5064, migrates on start
npm --prefix frontend install && npm --prefix frontend run dev    # Web on :5173, proxies /api
```

To get 2FA codes without a phone while developing: `python3 scripts/totp.py "<setup key>"`.

## Oracle notes

- Oracle stores `''` as NULL, so card descriptions are nullable in the database and mapped back
  to `""` when read; other text fields reject blank values before they reach the database.
- `DateOnly` is stored as `DATE`; long text (description, comments, data-protection keys) as `NCLOB`.
- `deploy/oracle/schema.sql` is the idempotent schema script for DBAs who apply changes themselves
  (`Database:ApplyMigrations=false`).

## Tests

```bash
dotnet test
```

Unit and integration tests run on SQLite. `python3 -I scripts/staging_smoke.py <url>` runs 19
end-to-end checks against a running server on Oracle. It covers sign-up gating, 2FA enrolment and sign-in, recovery codes, lockout, rate limiting, CSRF,
board ordering and completion, roles and invitations, dashboard and analytics maths, CSV export.

## Deploy

See [DEPLOY.md](DEPLOY.md) (Arabic): staging first, then production, with the GitHub Actions
pipeline in `.github/workflows/ci.yml`.
