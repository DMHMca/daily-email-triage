# Daily Email Triage & Draft Workspace

A mobile-first Progressive Web App (PWA) for **David McAughtry** that surfaces unreplied direct emails from the rolling past 7 days, audits every excluded thread with its exact exclusion reason, supports `en-GB` voice dictation, and generates plain, polite **British English** draft replies — strictly in **Draft-Only Mode**.

## Strict Draft-Only Safety
- **Zero Send capability**: No "Send" button exists anywhere in the UI, and runtime guards in `docs/js/safety.js` block any call to `/messages/send` or `/drafts/send`.
- **Allowed Gmail OAuth scopes ONLY**:
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.compose`
- **Blank by default**: Every Essence / Notes box and Draft Reply box remains strictly blank until David enters or dictates notes and clicks **Produce Draft**.
- **Output options only**: Copy draft to clipboard, export all non-empty drafts to `.txt`, or save strictly to **Gmail Drafts** for manual review.

## Quick Local Commands
```powershell
# Generate PNG PWA icons
node scripts/generate-icons.mjs

# Run automated safety, triage, and British English drafting tests
node --test tests/*.test.mjs

# Run local preview server on http://127.0.0.1:8787
node server/static-server.mjs

# Run Lenovo morning sync dry-run (writes data/morning-queue.json and logs/excluded-YYYY-MM-DD.txt)
node server/morning-sync.mjs --demo

# One-time Lenovo OAuth setup for live 06:30 Gmail morning sync
node server/oauth-setup.mjs

# Register the 06:30 daily Windows Task Scheduler job on this Lenovo PC
powershell -ExecutionPolicy Bypass -File server\install-scheduled-task.ps1 -Time "06:30"
```

## Architecture
- `docs/` — Static PWA served directly over HTTPS via **GitHub Pages** (`index.html`, `styles.css`, `manifest.json`, `sw.js`, PNG icons, and modular ES modules in `docs/js/`).
- `server/` — Lenovo Windows 11 06:30 scheduled morning sync (`morning-sync.mjs`), one-time OAuth setup (`oauth-setup.mjs`), Task Scheduler installer (`install-scheduled-task.ps1`), and local verification server (`static-server.mjs`).
- `tests/triage.test.mjs` — Automated safety audit, triage exclusion verification, British English drafter tests, and PWA manifest/icon verification.
