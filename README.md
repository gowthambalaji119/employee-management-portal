# Employee Management Portal

A production-style, full-stack Employee Management Portal with **real-time attendance
and work-session tracking** — built with Node.js, Express, Socket.IO, SQLite, and a
vanilla HTML/CSS/JS frontend (no build step required).

The server is the **single source of truth** for every timestamp and every
work-hour / break-hour calculation. The frontend only ever *displays* numbers the
server computed — it never invents or sends trusted time values.

---

## 1. Quick Start

```bash
cd backend
npm install
cp .env.example .env      # already done for you if you received this as a zip
npm run seed               # creates demo departments, an admin, and 5 employees
npm start                  # http://localhost:4000
```

Open **http://localhost:4000** in your browser.

### Demo accounts

| Role     | Email                | Password      |
|----------|-----------------------|---------------|
| Admin    | admin@company.com     | Admin@123     |
| Employee | john@company.com      | Employee@123  |
| Employee | david@company.com     | Employee@123  |
| Employee | sarah@company.com     | Employee@123  |
| Employee | priya@company.com     | Employee@123  |
| Employee | michael@company.com   | Employee@123  |

The database is a single SQLite file at `backend/data/emp_portal.db`. Delete it
(and re-run `npm run seed`) at any time to reset to a clean demo state.

---

## 2. Architecture

```
Frontend (static HTML/CSS/JS, Socket.IO client)
        ↓ fetch() with credentials: 'include'
REST API (Express, /api/*)
        ↓
Backend (Node.js + Express)
        ↓
WebSocket (Socket.IO, cookie-authenticated)
        ↓
Database (SQLite via better-sqlite3, WAL mode)
```

Everything — backend, frontend static assets, and the database — runs from a
single Express process (`backend/src/server.js`) on one port. This keeps the
project trivial to run locally while still cleanly separating concerns
(REST controllers, Socket.IO event layer, DB access, static frontend).

### Why SQLite instead of MySQL/PostgreSQL?

The data model, SQL, and access patterns are fully relational and portable —
the schema (`backend/src/db/schema.sql`) uses standard SQL types and would
port to PostgreSQL/MySQL with only minor syntax changes (e.g. `AUTOINCREMENT`
→ `SERIAL`, `datetime('now')` → `NOW()`). SQLite was chosen so the project
runs with **zero external services** — no database server to install or
configure — while keeping the exact same normalized schema described in the
spec (`users`, `work_sessions`, `breaks`, `attendance`, `tasks`,
`leave_requests`, `notifications`, plus an `audit_logs` table for security
logging).

### Folder structure

```
emp-portal/
├── backend/
│   ├── src/
│   │   ├── config/db.js            # SQLite connection + schema bootstrap
│   │   ├── middleware/             # auth (JWT), role/self-or-admin RBAC,
│   │   │                           # rate limiting, validation
│   │   ├── utils/                  # server-authoritative time math, audit log
│   │   ├── db/schema.sql           # normalized schema
│   │   ├── db/seed.js              # demo data
│   │   ├── controllers/            # one file per resource
│   │   ├── routes/                 # one file per resource
│   │   ├── socket/index.js         # Socket.IO server + typed emitters
│   │   └── server.js               # app entrypoint
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html                  # login + session-recovery modal
    ├── admin/dashboard.html
    ├── employee/dashboard.html
    ├── css/style.css               # full design system (light/dark)
    └── js/
        ├── api.js                  # fetch wrapper, toasts, formatters
        ├── admin-dashboard.js
        └── employee-dashboard.js
```

---

## 3. Real-time login / logout & work-session system

On **login**, the server:
1. Validates credentials (bcrypt-compared password hash).
2. Issues a JWT in an **httpOnly, sameSite cookie** (never exposed to JS).
3. If a previous **unclosed** session exists for that user, the client is told
   about it (`recoverableSession`) instead of silently discarding it — see
   §5 Session Recovery.
4. Otherwise a new `work_sessions` row is created with `login_time`, `ip_address`,
   and `user_agent` recorded server-side, and the user's `status` is set to
   `ONLINE`.

The dashboard then polls `GET /api/session/current` (authoritative) every 15s
and **visually interpolates** the seconds in between locally, so the on-screen
timer appears to tick every second without hammering the server — but the
displayed baseline is always re-synced to the server's own calculation, and a
page refresh always shows the correct server-computed value immediately.

On **logout** (`POST /api/auth/logout`), the server:
- Closes any open break.
- Computes `total_session_seconds`, `total_break_seconds`, and
  `total_work_seconds = total_session_seconds - total_break_seconds`.
- Computes overtime (`> STANDARD_WORK_HOURS`) and the day's `attendance_status`
  (`PRESENT` / `HALF_DAY` / `ABSENT` / `LATE` / `ON_LEAVE`) per the configured
  rules in `.env`.
- Upserts the `attendance` table for that date (one row per user per day).
- Sets `status = OFFLINE`, clears the auth cookie.

All of this logic lives in `finalizeSession()` in
`backend/src/controllers/authController.js` and is reused identically by the
"close previous session" recovery path, so a session can never be finalized
twice or with inconsistent math.

---

## 4. Break management

- `POST /api/breaks/start` — rejects if no active session, or a break is
  already open (`409 Conflict`).
- `POST /api/breaks/end` — computes `duration_seconds` server-side from the
  stored `break_start` and current server time, adds it to the session's
  running `total_break_seconds`.
- Every break is its own row in `breaks`, so an employee can have **any
  number of breaks per session** — the UI's timeline and the admin's break
  report both show the full history.
- While on break, `GET /api/session/current` returns `status: ON_BREAK` and
  **pauses** the working-time accumulation (break seconds keep incrementing
  instead).

---

## 5. Automatic session recovery

If a browser is closed / crashes / loses connection mid-session:

- The `work_sessions` row is **never deleted** — it just sits as
  `session_status: ACTIVE` (or `ON_BREAK`) with a `last_heartbeat` that stops
  advancing.
- While a tab is open, the client pings `POST /api/session/heartbeat` every
  25s, keeping `last_heartbeat` fresh.
- On the **next login**, the server detects the still-open session and
  returns it as `recoverableSession` instead of starting a new one. The login
  page shows:

  ```
  Previous active session detected.
  Login: 09:05 AM
  Last server activity: 02:35 PM
  [Resume Session]  [Close Previous Session]
  ```

- **Resume Session** (`POST /api/auth/session/resume`) simply continues the
  existing session — no data lost, no duplicate session created.
- **Close Previous Session** (`POST /api/auth/session/close-previous`)
  finalizes it using `last_heartbeat` as the effective end time (a reasonable,
  server-controlled approximation of when activity actually stopped), then a
  fresh session is started. This also **prevents duplicate active sessions**
  for the same user — `startSession()` returns `409 Conflict` if one is
  already open.

---

## 6. Real-time architecture (Socket.IO)

The Socket.IO server (`backend/src/socket/index.js`) authenticates each socket
connection using the **same JWT cookie** as the REST API (no separate token to
manage) and joins each client to:
- `user:<id>` — for personal updates (multi-tab sync, notifications)
- `admins` — for the live admin roster

Events emitted by controllers as state changes happen server-side:

| Event                     | Emitted when                                  |
|----------------------------|------------------------------------------------|
| `employee_online`         | A work session starts                          |
| `employee_break_start`    | A break starts                                 |
| `employee_break_end`      | A break ends                                   |
| `employee_logout`         | A session is finalized (logout or force-close) |
| `employee_status_changed` | Any ONLINE/ON_BREAK/OFFLINE transition         |
| `attendance_updated`      | The day's attendance row is upserted           |
| `notification_created`    | A task, leave decision, etc. creates a notif.  |

The admin dashboard's "Live Employee Status" table and stat cards re-fetch
automatically on any of these events — no manual refresh required. A dropped
socket connection does **not** by itself end a work session (that's the whole
point of §5); presence truth lives in the database, not the socket.

---

## 7. Database schema

See `backend/src/db/schema.sql` for the full DDL. Tables (all foreign-keyed
and indexed): `departments`, `users`, `work_sessions`, `breaks`, `attendance`,
`tasks`, `leave_requests`, `notifications`, `audit_logs`.

`attendance` has a `UNIQUE(user_id, attendance_date)` constraint and is
maintained via `INSERT ... ON CONFLICT DO UPDATE`, so it always reflects the
latest server-computed totals for that day even across multiple
login/logout cycles.

---

## 8. Security

- **Passwords**: bcrypt, cost factor 12. Plaintext is never stored or logged.
- **Auth**: JWT signed server-side, stored in an `httpOnly`, `sameSite=lax`
  cookie (not readable by JS — mitigates XSS token theft). `secure` flag is
  environment-controlled (`COOKIE_SECURE=true` in production behind HTTPS).
- **RBAC**: `requireRole('admin')` and `requireSelfOrAdmin()` middleware
  guard every sensitive route. Employees get a `403` if they try to read or
  modify another employee's attendance, breaks, tasks, or leave requests —
  including by editing the `:userId` in the URL (verified by automated curl
  tests during development; see §10 below).
- **Rate limiting**: login is capped at 10 attempts / 15 minutes per IP
  (`express-rate-limit`); all `/api/*` routes are capped at 300 req/min per IP.
- **Input validation**: lightweight schema validation on auth routes;
  parameterized SQL everywhere (via `better-sqlite3` prepared statements) —
  no string-concatenated queries, so SQL injection is not possible through
  normal use of this API.
- **XSS**: all user-generated text (names, task titles, leave reasons, etc.)
  is escaped client-side via `textContent`/`innerHTML` escaping helpers
  before being interpolated into the DOM.
- **Server-authoritative time**: the frontend never sends a timestamp that is
  trusted for any calculation — `nowISO()` on the server is the only source
  of truth for login/break/logout times and all derived durations.
- **Audit logging**: every login attempt (success/failure), logout, session
  start/resume/force-close, break start/end, employee CRUD action, leave
  decision, and task creation is written to `audit_logs` with the acting
  user, IP, and a details payload.
- **Helmet** is applied for standard security headers; CORS is restricted to
  `CLIENT_ORIGIN` with credentials enabled.

> CSRF note: because the frontend and API are served from the same origin and
> the auth cookie is `sameSite=lax`, cross-site POST forms cannot silently
> ride the session. If you split the frontend onto a different origin in
> production, add a CSRF token or switch to `sameSite=strict` plus a
> double-submit token.

---

## 9. Configurable attendance rules

Set in `backend/.env`:

```
STANDARD_WORK_HOURS=8       # hours before overtime accrues
MAX_BREAK_MINUTES=60        # informational cap (extend to enforce/alert)
LATE_LOGIN_THRESHOLD=09:15  # HH:MM (UTC) — logins after this are "late"
HALF_DAY_THRESHOLD_HOURS=4  # below this, the day is marked HALF_DAY
```

Overtime and attendance status are computed in
`backend/src/utils/time.js` (`computeOvertimeSeconds`,
`computeAttendanceStatus`) and stored on the `attendance` row separately from
regular worked seconds, exactly as specified.

---

## 10. API overview

All routes are prefixed with `/api`. Authenticated routes expect the `token`
cookie set by `/auth/login`.

| Method & Path                              | Access        | Purpose |
|---------------------------------------------|---------------|---------|
| POST `/auth/login`                          | public        | Validate credentials, detect recoverable session |
| POST `/auth/logout`                         | any           | Finalize session, clear cookie |
| GET `/auth/me`                              | any           | Current user + active session |
| POST `/auth/session/start`                  | any           | Start a new work session |
| POST `/auth/session/resume`                 | any           | Resume a detected active session |
| POST `/auth/session/close-previous`         | any           | Force-close a stale session |
| POST `/session/heartbeat`                   | any           | Keep `last_heartbeat` fresh |
| GET `/session/current`                      | any           | Live server-computed status/timers |
| POST `/breaks/start` / `/breaks/end`        | any           | Multi-break tracking |
| GET `/breaks/history/:userId`               | self or admin | Break history |
| GET `/employees`                            | admin         | Search/filter employees |
| GET `/employees/online`                     | admin         | Live roster with computed timers |
| POST `/employees`                           | admin         | Add employee |
| PUT `/employees/:id`                        | admin         | Edit employee |
| PATCH `/employees/:id/deactivate|activate`  | admin         | Deactivate/reactivate |
| GET `/employees/:id`                        | self or admin | Employee detail |
| PUT `/employees/:userId/profile`            | self or admin | Self-service profile update |
| GET `/attendance/:userId/today|history|timeline|summary` | self or admin | Attendance views |
| GET `/attendance/admin/overview|department-wise|daily-trend` | admin | Dashboard stats & charts |
| POST `/tasks`                               | admin         | Assign task |
| GET `/tasks`                                | any           | List (scoped to self unless admin) |
| PATCH `/tasks/:id/status`                   | self or admin | Update task status |
| POST `/leaves`                              | any           | Apply for leave |
| GET `/leaves`                               | any           | List (scoped to self unless admin) |
| PATCH `/leaves/:id/decision`                | admin         | Approve/reject |
| GET `/notifications`                        | any           | List own notifications |
| PATCH `/notifications/:id/read` / `/read-all` | any         | Mark read |
| GET/POST/PUT/DELETE `/departments`          | admin (write) | Department CRUD |
| GET `/reports/daily|weekly|monthly|attendance|breaks|overtime|leaves` | admin | `?format=csv` for download |
| GET `/reports/work-hours/:userId`           | self or admin | Per-employee report |

---

## 11. What was manually verified

During development the following were exercised end-to-end against the
running server (not just written and assumed correct):

- Login → session start → live timer state → start break → end break
  (duration computed correctly) → logout (session/break/work totals computed
  correctly, attendance row upserted).
- Admin overview stats reflect real online/break/offline counts and update
  after employee actions.
- CSV export returns correctly-formatted, downloadable CSV.
- **Access control**: an employee attempting to read another employee's
  attendance via URL ID manipulation receives `403 Forbidden`; an employee
  calling an admin-only endpoint receives `403 Forbidden`; an unauthenticated
  request receives `401 Unauthorized`.

## 12. Known scope limitations

- CORS/cookie settings assume same-origin deployment (frontend served by the
  same Express app). For a split-origin deployment, adjust `CLIENT_ORIGIN`,
  `COOKIE_SECURE`, and add explicit CSRF protection.
- SQLite is used for zero-config portability; for high-concurrency production
  use, swap `better-sqlite3` for `pg`/`mysql2` — the schema and queries are
  written in portable SQL to make that migration straightforward.
- Admin dashboard charts are dependency-free CSS/DOM bar charts rather than a
  charting library, to keep the project runnable with no external CDN
  dependency beyond the Socket.IO client script.
