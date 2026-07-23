# Solar EPC Project Management System (MVP)

Real-time monitoring for running solar EPC projects: project dashboard,
per-project material tracking, and daily usage logging from the field —
usable as a mobile web app (installable, no app-store needed) as well
as on desktop.

## Requirements
Node.js **22.5+** only — no database software or npm packages to install
(uses Node's built-in `node:sqlite`).

## Run it
```
cd solar-epc-mvp
node server.js
```
Open **http://localhost:5178**.

To use a different port: `PORT=8080 node server.js`

On first run, a default admin account is created automatically:
- **username:** `admin`
- **password:** `admin123`

**Change this password-protected setup before real use** — currently there
is no in-app "change password" screen yet; for now, change it by deleting
`data/solar_epc.db` and editing `auth.ensureDefaultAdmin()` in `auth.js`
to set a different starting password, or ask for a "change password"
feature to be added.

## Roles
- **Admin** — everything: manage projects, materials, and team members (create logins for PMs/engineers).
- **Project Manager (pm)** — create/edit projects, add materials, log usage for any project.
- **Site Engineer (engineer)** — can only see and log material usage for the project(s) they're assigned to (matched by their username in the project's "Engineer username" field).

To assign a Site Engineer to a project, set their **username** in the
project's "Engineer username" field when creating/editing the project —
this is what restricts their login to that project.

## Using it on a phone (installable, no app store)
1. Open the site URL in Chrome (Android) or Safari (iPhone).
2. Chrome: menu → "Add to Home screen". Safari: Share → "Add to Home Screen".
3. It now opens full-screen like a native app, with its own icon.

This is intentionally **not offline-first** — it always fetches live data
from the server so the dashboard reflects real-time site status. A true
native Android/iOS app (Play Store / App Store) can be built later on top
of the same API if needed — this MVP's backend is ready for that (all
functionality is exposed as a JSON API under `/api/...`).

## Modules in this MVP
1. **Running Projects** — dashboard of all projects with progress, status,
   manpower, and last update; tap into any project for full detail.
2. **Material Usage** — per-project material list with planned quantity,
   daily entries from site engineers, running totals (used / remaining),
   and full usage history (by material, or all materials by date).

## Project layout
```
solar-epc-mvp/
  server.js     — HTTP server + REST API (plain Node http, no framework)
  db.js         — SQLite schema & queries (users, projects, materials, usage)
  auth.js       — password hashing + session tokens (Node crypto only)
  index.html    — the whole frontend (mobile-first, installable PWA)
  manifest.json — PWA manifest (installability)
  sw.js         — minimal service worker (app shell only, never caches data)
  icon.svg      — app icon
  data/
    solar_epc.db — created automatically, holds all your data
```

## Moving to your own server later
Everything lives in `data/solar_epc.db` (SQLite, a single file) — copy it
to move your data. The code has no dependency on the free-hosting
platform, so moving to a company server is just: copy the folder, run
`node server.js` there (optionally behind nginx/pm2), and point your
domain at it. If you later want PostgreSQL instead of SQLite (e.g. for
multiple servers), only `db.js` needs to change — the rest of the app is
unaffected.

## What's intentionally not in this MVP yet
(possible next phases toward the fuller ERP)
- Change-password / forgot-password screens
- Editing/removing team members
- File photo uploads from site (progress photos)
- Notifications/alerts (e.g. material running low)
- Procurement, finance, HR modules
