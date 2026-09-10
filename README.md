# CRM Employee

Windows desktop app for the Business OS **employee** portal. While you are signed in and **clocked in**, the primary screen is captured every **5 minutes** and stored in a private Supabase bucket.

This folder is separate from the admin and client desktop apps.

## Setup

1. Copy `.env.example` to `.env` and set `SUPABASE_URL` / `SUPABASE_ANON_KEY` to the same values as the Vite portals.
2. Apply [`sql/work_screenshots.sql`](sql/work_screenshots.sql) once on that Supabase project.
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

Output is `release/CRM Employee-Setup-1.0.0.exe`. Copy `.env` next to the installed exe or into `%APPDATA%\CRM Employee\.env` so screenshot upload works.
