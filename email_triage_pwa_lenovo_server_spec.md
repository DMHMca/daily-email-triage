# Daily Email Triage & Draft Workspace — Specification & Antigravity 2.0 Setup

---

## 1. Ready-to-Use Prompt for Antigravity 2.0

Copy and paste the prompt below into a new Project in **Antigravity 2.0** on your Lenovo Windows 11 server (or attach this entire file to the project and instruct the agent to build from it):

> **Prompt:**
> Build and deploy a mobile-first Progressive Web App (PWA) called **Daily Email Triage & Draft Workspace** for David McAughtry, following every requirement in the specification below.
>
> 1. **Strict Draft-Only Safety:** Do **not** include any "Send" button anywhere in the UI, and do **not** request or wire up the `gmail.send` OAuth scope. Restrict Gmail API access strictly to `gmail.readonly` and `gmail.compose`.
> 2. **Architecture:** Build a clean, lightweight PWA (`manifest.json` + Service Worker) hosted on a live HTTPS origin (e.g., Firebase Hosting) so it installs cleanly to Chrome on a Google Pixel with zero WebView/CSP issues.
> 3. **Morning Refresh:** Configure an automated daily morning sync (running either via a scheduled task on this always-on Windows 11 Lenovo server or a cloud scheduled function) that fetches unreplied emails from the rolling past 7 days, applies the strict exclusion rules, logs excluded threads, and prepares the queue before morning review.
> 4. **Drafting & Dictation:** Keep all Essence/Notes fields and Draft Reply fields strictly **blank by default**. Support `en-GB` voice dictation in the notes field, and generate plain, polite **British English** draft replies only when explicitly triggered.
> 5. **Verification & Setup:** Guide me step-by-step through the one-time Google Cloud Console OAuth setup for `gmail.readonly` and `gmail.compose`, verify the live UI in Chrome using the browser tool, and provide the final HTTPS URL so I can add it to my Pixel home screen.

---

## 2. Technical Specification: Daily Email Triage & Draft Workspace

### 2.1 Core Objective
A mobile-first Progressive Web App (PWA) for **David McAughtry** that refreshes every morning, surfaces only unreplied emails from the past 7 days that genuinely require a response, and provides a safe, blank-by-default workspace to dictate notes and generate polite British English draft replies.

### 2.2 Strict Safety Constraint (Draft-Only Mode)
* **No Send Capability:** There must be **no "Send" button** anywhere in the UI and no API scope or endpoint permitted to send emails automatically.
* **Allowed OAuth Scopes Only:**
  * `https://www.googleapis.com/auth/gmail.readonly`
  * `https://www.googleapis.com/auth/gmail.compose`
  * **Explicitly Excluded:** `gmail.send`, `mail.google.com` (full access).
* **Output Options Only:**
  * Copy draft text to clipboard.
  * Export all non-empty drafts to a `.txt` file.
  * Save a generated reply strictly to the **Gmail Drafts** folder for manual review and sending.

### 2.3 Email Filtering & Triage Logic
* **Time Window:** Rolling past 7 days.
* **Inclusion Criteria:** Direct emails addressed to the user that have not yet been answered.
* **Mandatory Exclusions:**
  * Threads where the user's latest message is already in `SENT`.
  * CC-only emails or threads where no direct reply is requested.
  * eBay messages, routine receipts, order confirmations, automated alerts, and newsletters.
* **Audit Transparency:** Include a collapsible **Audited & Excluded Threads** log at the bottom of the workspace listing every filtered-out thread from the 7-day window along with the exact reason it was excluded.

### 2.4 User Interface & Workflow
* **Target Device:** Google Pixel (Android Chrome, installable via *Add to Home screen*) and desktop browsers.
* **Navigation / Filter Tabs:**
  * `All Active`
  * `Pending`
  * `Handled / Archived`
* **Email Card Layout (per vetted thread):**
  * **Header:** Sender name & email address, subject line, and date.
  * **Summary:** Concise 1–2 sentence summary of what the email requires.
  * **Essence / Notes Input:** Strictly **blank by default**. Must support **`en-GB` voice dictation** (Web Speech API button and/or native OS keyboard dictation).
  * **Draft Reply Output:** Strictly **blank by default** until the user enters notes and clicks `Produce Draft`. Output must be plain, polite **British English** prose addressed appropriately to the person or company.
* **Per-Thread Actions:**
  * `Produce Draft` — generates a British English reply from the user's notes.
  * `Copy Draft` — copies the generated draft to the clipboard.
  * `Save to Gmail Drafts` — saves the reply strictly as a Gmail Draft (no sending).
  * `Pend` — moves the thread to the `Pending` tab.
  * `Archive / Done` — moves the thread to the `Handled / Archived` tab.
* **Global Actions & State Persistence:**
  * `Refresh / Sync Now` — triggers an on-demand 7-day inbox triage refresh.
  * `Export Drafts` — downloads all non-empty drafts as a single `.txt` file.
  * **Persistence:** Persist in-progress notes, generated drafts, and `Pending` / `Archived` statuses across page reloads (via `localStorage`, IndexedDB, or backend storage).

---

## 3. Lenovo Windows 11 Server & Antigravity 2.0 Requirements

### 3.1 Host Machine Profile
* **Hardware/OS:** Always-on Lenovo PC running **Windows 11 Desktop (64-bit)**, operated headless with a shared monitor.
* **Role:** Hosts **Antigravity 2.0** (standalone desktop app) for building, modifying (via Remote Control), and optionally running lightweight scheduled morning sync jobs.

### 3.2 Required Host Configuration (One-Time Setup)
1. **Google Chrome:** Installed on the Lenovo (required by Antigravity 2.0 for browser verification).
2. **Prevent Sleep / Hibernate:**
   * *Settings → System → Power & battery → Screen, sleep, & hibernate timeouts* → Set **Put my device to sleep** to **Never**.
3. **Automatic Login After Windows Updates/Reboots:**
   * Disable *Settings → Accounts → Sign-in options → For improved security, only allow Windows Hello sign-in for Microsoft accounts on this device*.
   * Run `netplwiz` (`Win + R`) and uncheck *Users must enter a user name and password to use this computer* (or use Microsoft **Sysinternals Autologon** for encrypted credential storage).
4. **Auto-Launch Antigravity 2.0 on Startup:**
   * Place a shortcut to **Antigravity 2.0** in `shell:startup` (`Win + R`).
5. **Antigravity 2.0 Remote Control & Unattended Settings:**
   * *Settings → Application:* Toggle **Enable Remote Control** and **Prevent Sleep** to **On**. Set **Device Name** to `lenovo-server`.
   * *Settings → General → Global Permissions → Permission Preset:* Set to **Auto** so safe, reversible operations do not stall waiting for manual approval when accessed remotely.
   * **Remote Access URL:** `https://antigravity.google.com` (select `lenovo-server` from the instance switcher on your Pixel, G14, or Surface Pro 11).

### 3.3 Deployment & Morning Refresh Options
* **Hosting (Recommended):** Deploy the PWA frontend to **Firebase Hosting** (native to Antigravity 2.0) or Cloudflare Pages/Vercel so it serves over standard HTTPS without local network tunnelling issues.
* **Morning Sync Execution:**
  * **Option A (Cloud):** Firebase Scheduled Function / Cloud Scheduler runs every morning (e.g., 06:30 UK time) — works even if the Lenovo is rebooting.
  * **Option B (Local Lenovo):** Antigravity 2.0 Scheduled Task or Windows Task Scheduler runs a lightweight script every morning on the always-on Lenovo and pushes the refreshed triage queue to the app backend.