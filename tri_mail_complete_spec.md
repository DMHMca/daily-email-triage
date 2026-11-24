# Tri-Mail (Daily Email Triage & Draft Workspace) — Complete Specification

**Owner:** David McAughtry  
**Target Locale:** `en-GB` (British English spelling, prose, and voice dictation)  
**Delivery Targets:**
1. **In-App Interactive Artifact** (for Claude / Claude Code / desktop & mobile app artifact view)
2. **Mobile-First Progressive Web App (PWA)** (installable to Google Pixel home screen via Chrome, or served over HTTPS)

---

## 1. Strict Draft-Only Safety (Non-Negotiable)

- **Zero Send Capability:** There must be **no "Send" button** anywhere in the UI, and no API call, helper, or endpoint permitted to send emails automatically.
- **Permitted Gmail OAuth Scopes ONLY:**
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.compose`
- **Explicitly Forbidden:**
  - `gmail.send`, `gmail.modify`, `mail.google.com` (full access)
  - `/messages/send`, `/drafts/send`, or any `DELETE` / `PATCH` operations outside `/drafts`
- **Runtime Guard:** Enforce a runtime safety check (`assertSafeScopeString` and `assertSafeGmailEndpoint`) before every OAuth request and every Gmail API `fetch`.
- **Allowed Outputs Only:**
  1. Copy draft text to clipboard (`Copy Draft`).
  2. Export all non-empty drafts to a single `.txt` file (`Export Drafts`).
  3. Save a reply strictly to the **Gmail Drafts** folder (`POST /users/me/drafts` or `PUT /users/me/drafts/{id}`) for manual review and sending inside Gmail.

---

## 2. Email Filtering, Triage & Audit Logic

- **Time Window:** Rolling past **7 days**.
- **Inclusion Criteria:** Direct emails addressed to David McAughtry that have not yet been answered.
- **Mandatory Exclusions (with explicit reason logged):**
  1. **Already Answered:** Threads where the latest non-draft message is in `SENT` or sent by the user's normalized email address.
  2. **CC-Only / Not Directly Addressed:** Threads where the user's address is only in `Cc` or absent from `To` (normalize Gmail dot-insensitivity and `@googlemail.com` vs `@gmail.com`).
  3. **eBay Messages:** Senders on `ebay.*` or eBay order/watch/bid notifications.
  4. **Receipts & Order Confirmations:** Invoices, statements, dispatch/delivery updates, Amazon/PayPal/Stripe/Royal Mail/DPD/Evri/courier notifications.
  5. **Automated Alerts:** `no-reply@`, `donotreply@`, `Auto-Submitted`, `X-Autoreply`, security alerts, 2FA/OTP codes, calendar reminders, out-of-office auto-replies, GitHub notifications.
  6. **Newsletters & Marketing:** `List-Unsubscribe`, `List-Id`, `Precedence: bulk/list`, `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `CATEGORY_FORUMS`, or unsubscribe/digest patterns.
  7. **No Reply Requested:** Explicit FYI / "no reply needed" messages and `CATEGORY_UPDATES` without a question or action cue.
- **Audit Transparency Log:**
  - Collapsible **Audited & Excluded Threads** panel at the bottom of the workspace.
  - Lists every filtered-out thread with Sender, Subject, Date, Category badge, and exact exclusion reason, plus a live search filter.

---

## 3. User Interface & Workflow (Mobile-First + Artifact Mode)

- **Navigation / Filter Tabs (with live counts):**
  - `All Active`
  - `Pending`
  - `Handled / Archived`
- **Per-Thread Email Card Layout:**
  - **Header:** Sender initials avatar, Sender name & email address, date/time (`en-GB`), and Subject.
  - **Requires Summary:** Concise 1–2 sentence summary of what the email is asking for, plus a collapsible `View original email` disclosure.
  - **Essence / Notes Input:** Strictly **blank by default** (`""`). Supports **`en-GB` voice dictation** (Web Speech API `lang = 'en-GB'` button + native Android Gboard microphone input).
  - **Draft Reply Output:** Strictly **blank by default** (`""`) until the user enters notes and explicitly clicks **`Produce Draft`**.
  - **Per-Thread Action Buttons (No Send button):**
    - `Produce Draft` — generates plain, polite **British English** prose addressed appropriately to the individual (e.g. `Dear Sarah,`, `Dear Dr Patel,`) or company/role mailbox (e.g. `Dear Cotswold Heating Services Team,`), signed `Kind regards,\nDavid McAughtry`. Uses optional Gemini API key if configured, or built-in offline British English composer.
    - `Copy Draft`
    - `Save to Gmail Drafts` / `Update Gmail Draft`
    - `Pend` / `Move to Active`
    - `Archive / Done` / `Reopen`
- **Global Controls & Persistence:**
  - `Refresh / Sync Now`
  - `Export Drafts` (downloads all non-empty drafts as a UTF-8 `.txt` file)
  - `Setup & Settings` (OAuth Client ID, optional Gemini API key, UK morning refresh time, sign-off name)
  - `Check Update` / `Update Available` (for PWA deployments)
  - **State Persistence:** Persist notes, generated drafts, Gmail draft IDs, and `Pending` / `Archived` statuses across reloads (`IndexedDB` + `localStorage` mirror, or Artifact persistent storage).
- **Preview Mode (Default Before OAuth):**
  - Include realistic UK sample emails (both active and excluded) so the full UI, dictation, British English drafting, tab state, export, and audit log can be tested immediately without credentials.

---

## 4. Architecture & Implementation Lessons (Must-Follow Edge Cases)

To avoid the pitfalls encountered during initial development, any new implementation (Artifact or PWA) **must** include these safeguards from day one:

1. **Null-Safe Email Header Parsing:**
   - Real Gmail `From:` / `To:` / `Cc:` headers frequently arrive as `<user@domain.com>` with no display name, making the display-name capture group `undefined`. Always guard with `(match[1] || '').trim()`.
2. **Avoid Gmail API Rate Limits (`429` / `Quota exceeded`) & Slow Scans:**
   - **Primary morning scan:** Query `in:inbox category:primary newer_than:7d -in:spam -in:trash` so morning triage is fast and clean (only Primary Inbox items appear in **All Active** and **Audited & Excluded Threads**).
   - **Background Misdirection Sweep (Secondary):** Periodically (e.g. via a background/06:30 scheduled job, never blocking the morning UI) scan non-primary tabs (`category:updates`, `category:promotions`, `category:social`, and optionally `in:spam`) specifically for direct personal emails addressed to David in `To:` with no `List-Unsubscribe` / `no-reply` header and a direct question or action cue, surfacing any rescued items in the queue with a `"Rescued from <Tab>"` badge.
   - **Two-stage fetch:** Fetch `format=metadata` (only the required headers) for the thread list first, run triage exclusions, and only fetch `format=full` for the surviving candidate active threads.
   - **`historyId` caching:** Cache `{ threadId -> { historyId, decision, record } }` locally so unchanged threads require **0** API calls on subsequent refreshes.
   - **Timeout & backoff:** Use `AbortSignal.timeout(15000)` on `fetch`, `Promise.allSettled` so one bad thread never aborts the whole sync, and exponential backoff on `429`/`403` rate-limit responses.
3. **Eliminate Repeated Morning OAuth Popups & Wait Times:**
   - Browser-only OAuth (`google.accounts.oauth2.initTokenClient`) only issues 1-hour in-memory access tokens and shows Google's "unverified app" warning in Testing mode.
   - For **zero OAuth screens** and **instant morning loading** on mobile, run the **06:30 UK** sync on a backend (e.g., Firebase Cloud Function + Firestore, or an always-on server pushing to cloud storage) that holds a single one-time refresh token and writes the pre-triaged queue before 06:30.
4. **Visible Diagnostics & Cache-Busting (for PWA Hosting):**
   - Display a persistent inline error banner (never a disappearing 3.6s toast alone) with the error message & stack trace if any sync step fails.
   - Include versioned cache-busting (`?v=X.Y`) on all ES module imports and a visible **Check Update** / **Update Available** button in the top bar.
5. **Artifact Mode (Claude / Claude Code):**
   - If built as an interactive Artifact inside Claude, keep the entire UI in a single self-contained React/HTML artifact with Preview Mode + `en-GB` dictation + British English composer + export `.txt`, and optionally connect to an MCP Gmail server or lightweight backend endpoint (strictly `gmail.readonly` + `gmail.compose` only) so it renders directly inside the mobile app with zero browser-tab switching.
