# Amelia Jacob's Salon — Staff App (PWA)

Mobile-first employee app per the blueprint (MVP scope): PIN login, location
selection (Macarthur Square / Ed Park), clock on/off with breaks, service
counts at clock-off, task checklist, personal KPIs and shift history.
Installable on staff phones from the browser (Add to Home Screen).

## Run it

```bash
npm install
npm run dev        # http://localhost:5174 — open on your phone via LAN IP
npm run build      # production build in dist/
```

Demo PINs: Sophie `1111` · Tahlia `2222` · Megan `3333` · Demo `0000`

## How it's wired

- `src/api/client.js` — the only file that touches data. Every function is
  shaped like the future REST endpoint (commented at the top of the file) and
  currently persists to localStorage so the app runs standalone. To go live,
  replace the function bodies with `fetch()` calls; no screen code changes.
- Data model mirrors blueprint §8.2: `shifts`, `shift_events` (immutable raw
  clock log), `shift_services`, `tasks`. Pairs with the existing
  `001_initial_schema.sql` Postgres schema.
- Approval-first: clock-off sets shift status to `submitted` — nothing is
  payroll-ready until a manager approves it in the admin portal (next build).
- `public/sw.js` is a minimal offline shell cache; swap for Workbox/vite-plugin-pwa
  when the backend lands.

## Out of scope in this build (per blueprint phases)

Admin portal, timesheet approval, GPS/QR clock-on proof, rostering,
Xero/MYOB sync (Phase 5 — approval-first, one-way, CSV fallback).
