/**
 * Lenovo Windows 11 Automated Morning Sync Script (runs daily at 06:30 UK time)
 *
 * Strictly Draft-Only:
 *  - Uses ONLY gmail.readonly and gmail.compose scopes (enforced via safety.js)
 *  - Fetches unreplied threads from the rolling past 7 days
 *  - Applies the shared strict exclusion rules
 *  - Writes the prepared queue to data/morning-queue.json (blank notes & drafts for new threads)
 *  - Logs every excluded thread with exact reason to logs/excluded-YYYY-MM-DD.json & .txt
 *
 * Usage:
 *   node server/morning-sync.mjs          (live Gmail using secrets/lenovo-oauth.json)
 *   node server/morning-sync.mjs --demo   (dry-run with sample UK inbox)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeGmailEndpoint, assertSafeScopeString } from '../docs/js/safety.js';
import { triageThreads, ROLLING_WINDOW_DAYS } from '../docs/js/triage-engine.js';
import { buildDemoRawThreads } from '../docs/js/demo-data.js';
import { extractBodyFromPayload } from '../docs/js/gmail-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SECRETS_PATH = path.join(ROOT_DIR, 'secrets', 'lenovo-oauth.json');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const QUEUE_PATH = path.join(DATA_DIR, 'morning-queue.json');
const HISTORY_LOG = path.join(LOGS_DIR, 'sync-history.log');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function getUkDateStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function appendHistory(message) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(HISTORY_LOG, line, 'utf8');
  console.log(line.trim());
}

async function refreshAccessToken(creds) {
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error('Incomplete credentials in secrets/lenovo-oauth.json. Run "npm.cmd run auth:lenovo" first.');
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth token refresh failed: ${data.error_description || data.error || res.status}`);
  }

  if (data.scope) {
    assertSafeScopeString(data.scope);
  }

  return data.access_token;
}

async function safeGmailGet(accessToken, apiPath) {
  const url = `${GMAIL_API_BASE}${apiPath}`;
  assertSafeGmailEndpoint('GET', url);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gmail GET ${apiPath} failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchLiveThreads(accessToken) {
  const profile = await safeGmailGet(accessToken, '/profile');
  const userEmail = String(profile.emailAddress || '').toLowerCase();

  const query = encodeURIComponent(`newer_than:${ROLLING_WINDOW_DAYS}d -in:spam -in:trash`);
  const threadIds = [];
  let pageToken = '';

  do {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const listData = await safeGmailGet(accessToken, `/threads?q=${query}&maxResults=100${pageParam}`);
    if (Array.isArray(listData.threads)) {
      for (const t of listData.threads) {
        if (t.id) threadIds.push(t.id);
      }
    }
    pageToken = listData.nextPageToken || '';
  } while (pageToken && threadIds.length < 250);

  const normalized = [];
  const batchSize = 8;
  for (let i = 0; i < threadIds.length; i += batchSize) {
    const slice = threadIds.slice(i, i + batchSize);
    const batch = await Promise.all(
      slice.map((id) => safeGmailGet(accessToken, `/threads/${encodeURIComponent(id)}?format=full`))
    );
    for (const rawThread of batch) {
      const messages = (rawThread.messages || []).map((msg) => ({
        id: msg.id,
        dateMs: Number(msg.internalDate || 0),
        labels: msg.labelIds || [],
        headers: msg.payload?.headers || [],
        snippet: msg.snippet || '',
        bodyText: extractBodyFromPayload(msg.payload),
      }));
      normalized.push({ id: rawThread.id, messages });
    }
  }

  return { userEmail, threads: normalized };
}

function preservePreviousLocalWork(freshActive) {
  if (!fs.existsSync(QUEUE_PATH)) return freshActive;
  try {
    const existing = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    const prevMap = new Map((existing.activeThreads || []).map((t) => [t.threadId, t]));
    return freshActive.map((item) => {
      const prev = prevMap.get(item.threadId);
      if (!prev) {
        return { ...item, notes: '', draft: '', status: 'active' };
      }
      return {
        ...item,
        notes: typeof prev.notes === 'string' ? prev.notes : '',
        draft: typeof prev.draft === 'string' ? prev.draft : '',
        status: prev.status || 'active',
        gmailDraftId: prev.gmailDraftId || '',
      };
    });
  } catch {
    return freshActive;
  }
}

function writeAuditLogs(dateStamp, result, userEmail, mode) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const preparedQueue = {
    mode,
    owner: 'David McAughtry',
    userEmail,
    syncedAt: result.syncedAt,
    windowDays: ROLLING_WINDOW_DAYS,
    evaluatedCount: result.evaluatedCount,
    activeCount: result.activeThreads.length,
    excludedCount: result.excludedThreads.length,
    activeThreads: preservePreviousLocalWork(result.activeThreads),
    excludedThreads: result.excludedThreads,
  };

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(preparedQueue, null, 2), 'utf8');

  const excludedJsonPath = path.join(LOGS_DIR, `excluded-${dateStamp}.json`);
  fs.writeFileSync(excludedJsonPath, JSON.stringify(result.excludedThreads, null, 2), 'utf8');

  const excludedTxtLines = [
    `DAILY EMAIL TRIAGE — AUDITED & EXCLUDED THREADS LOG (${dateStamp})`,
    `Mode: ${mode} | Account: ${userEmail} | Synced: ${result.syncedAt}`,
    `Evaluated: ${result.evaluatedCount} | Active Queue: ${result.activeThreads.length} | Excluded: ${result.excludedThreads.length}`,
    '========================================================================',
    '',
    ...result.excludedThreads.map((e, i) =>
      [
        `${i + 1}. [${e.category}] ${e.subject}`,
        `   From: ${e.senderName} <${e.senderEmail}>`,
        `   Date: ${e.dateIso}`,
        `   Reason: ${e.reason}`,
      ].join('\n')
    ),
    '',
  ];

  const excludedTxtPath = path.join(LOGS_DIR, `excluded-${dateStamp}.txt`);
  fs.writeFileSync(excludedTxtPath, excludedTxtLines.join('\n'), 'utf8');

  return { queuePath: QUEUE_PATH, excludedJsonPath, excludedTxtPath };
}

async function main() {
  const isDemoFlag = process.argv.includes('--demo');
  const dateStamp = getUkDateStamp();

  if (!isDemoFlag && !fs.existsSync(SECRETS_PATH)) {
    appendHistory(
      'Morning sync skipped live Gmail call: secrets/lenovo-oauth.json not yet configured. Run "npm.cmd run auth:lenovo" after creating Google Cloud OAuth credentials (running --demo dry check instead).'
    );
    const demoEmail = 'david.mcaughtry@example.co.uk';
    const raw = buildDemoRawThreads(demoEmail, Date.now());
    const result = triageThreads(raw, { userEmail: demoEmail, nowMs: Date.now() });
    const files = writeAuditLogs(dateStamp, result, demoEmail, 'demo-fallback');
    appendHistory(
      `Demo-fallback morning sync complete: ${result.activeThreads.length} active, ${result.excludedThreads.length} excluded. Log: ${files.excludedTxtPath}`
    );
    return;
  }

  if (isDemoFlag) {
    const demoEmail = 'david.mcaughtry@example.co.uk';
    const raw = buildDemoRawThreads(demoEmail, Date.now());
    const result = triageThreads(raw, { userEmail: demoEmail, nowMs: Date.now() });
    const files = writeAuditLogs(dateStamp, result, demoEmail, 'demo');
    appendHistory(
      `Demo morning sync complete: ${result.activeThreads.length} active, ${result.excludedThreads.length} excluded. Audit log: ${files.excludedTxtPath}`
    );
    return;
  }

  const creds = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  const accessToken = await refreshAccessToken(creds);
  const { userEmail, threads } = await fetchLiveThreads(accessToken);
  const result = triageThreads(threads, { userEmail, nowMs: Date.now() });
  const files = writeAuditLogs(dateStamp, result, userEmail, 'live-gmail');

  appendHistory(
    `Live Gmail morning sync complete for ${userEmail}: ${result.activeThreads.length} active threads prepared, ${result.excludedThreads.length} excluded & logged at ${files.excludedTxtPath}`
  );
}

main().catch((err) => {
  appendHistory(`ERROR during morning sync: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
