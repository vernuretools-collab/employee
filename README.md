# CRM Employee

Windows desktop app for the Business OS **employee** portal. While you are signed in and **clocked in**, the primary screen is captured every **10 minutes** and stored in a private Supabase bucket. Idle time is saved only after 20 minutes without keyboard or mouse input. Once that happens, the full streak is stored (25 minutes away counts as 25 minutes idle) and is included in admin monthly reports.

This folder is separate from the admin and client desktop apps.

## Setup

1. Copy `.env.example` to `.env` and set `SUPABASE_URL` / `SUPABASE_ANON_KEY` to the same values as the Vite portals.
2. Apply [`sql/work_screenshots.sql`](sql/work_screenshots.sql) and [`sql/work_idle_days.sql`](sql/work_idle_days.sql) once on that Supabase project.
3. Install and bundle the employee portal:

```
npm install
npm run portals
```

`npm run portals` builds `../new-crm-supabase/employee-portal` and copies `dist` into `portals/employee`. Override the CRM path with `CRM_ROOT` if needed.

4. Start:

```
npm run dev
```

## Windows installer

```
npm run dist
```

Output is `release/CRM Employee-Setup-<version>.exe`. Copy `.env` next to the installed exe or into `%APPDATA%\CRM Employee\.env` so screenshot upload works.

## Updates for installed apps

People who already installed CRM Employee (1.2.0 or newer) check GitHub Releases on launch and every 4 hours. A newer version downloads in the background and installs when they restart or quit the app.

Ship that update with a version higher than the one they have, then publish the installer, blockmap, and `latest.yml`:

```
$env:GH_TOKEN = "<github token with repo scope>"
npm run release
```

`npm run release` publishes to [vernuretools-collab/employee](https://github.com/vernuretools-collab/employee). The current package version is the version those installs will be offered.
