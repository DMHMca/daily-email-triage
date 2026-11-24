/**
 * Strict Draft-Only Gmail API Client (Browser PWA via Google Identity Services)
 *
 * Allowed OAuth scopes ONLY:
 * - https://www.googleapis.com/auth/gmail.readonly
 * - https://www.googleapis.com/auth/gmail.compose
 *
 * Strictly NO email-sending capability anywhere in this client.
 */

import { GMAIL_SCOPE_STRING, assertSafeGmailEndpoint, assertSafeScopeString } from './safety.js?v=1.9';
import { triageThreads, ROLLING_WINDOW_DAYS } from './triage-engine.js?v=1.9';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function decodeBase64UrlToUtf8(input = '') {
  if (!input) return '';
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function encodeUtf8ToBase64Url(input = '') {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Extracts best plain-text body from a Gmail API message payload tree.
 */
export function extractBodyFromPayload(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64UrlToUtf8(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64UrlToUtf8(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const nested = extractBodyFromPayload(part);
      if (nested) return nested;
    }
  }
  if (payload.body?.data) {
    return decodeBase64UrlToUtf8(payload.body.data);
  }
  return '';
}

/**
 * Builds an RFC 2822 UTF-8 MIME draft reply for Gmail Drafts ONLY.
 */
export function buildDraftMimeMessage({ to, subject, body, inReplyTo = '', references = '' }) {
  const replySubject = /^re:/i.test(subject || '') ? subject : `Re: ${subject || '(No subject)'}`;
  const encodedSubject = /[^\x20-\x7E]/.test(replySubject)
    ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(replySubject)))}?=`
    : replySubject;

  const lines = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    const refChain = references ? `${references} ${inReplyTo}` : inReplyTo;
    lines.push(`References: ${refChain}`);
  }

  lines.push('', String(body || '').replace(/\r?\n/g, '\r\n'));
  return lines.join('\r\n');
}

export class SafeGmailClient {
  constructor() {
    this.accessToken = '';
    this.tokenExpiresAt = 0;
    this.userEmail = '';
    this.clientId = '';
    this.tokenClient = null;
  }

  isSignedIn() {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiresAt - 30_000);
  }

  signOut() {
    if (this.accessToken && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch {
        // Ignore revoke error
      }
    }
    this.accessToken = '';
    this.tokenExpiresAt = 0;
    this.userEmail = '';
  }

  async ensureAuthorized(clientId, { interactive = true } = {}) {
    const trimmedId = String(clientId || '').trim();
    if (!trimmedId) {
      throw new Error('Please enter your Google OAuth Client ID in Settings first.');
    }

    if (this.isSignedIn() && this.clientId === trimmedId) {
      return this.accessToken;
    }

    if (!window.google?.accounts?.oauth2?.initTokenClient) {
      throw new Error('Google Identity Services script is still loading or blocked. Please check your internet connection and retry.');
    }

    // Enforce strict scope whitelist before requesting OAuth token
    assertSafeScopeString(GMAIL_SCOPE_STRING);

    this.clientId = trimmedId;

    return new Promise((resolve, reject) => {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: trimmedId,
        scope: GMAIL_SCOPE_STRING,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || `Google sign-in failed (${response.error}).`));
            return;
          }
          // Double-check returned granted scopes never escalate beyond allowed list
          if (response.scope) {
            try {
              assertSafeScopeString(response.scope);
            } catch (safetyErr) {
              this.accessToken = '';
              reject(safetyErr);
              return;
            }
          }
          this.accessToken = response.access_token;
          this.tokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
          resolve(this.accessToken);
        },
        error_callback: (err) => {
          reject(new Error(err?.message || 'Google sign-in popup was closed or blocked.'));
        },
      });

      this.tokenClient.requestAccessToken({
        prompt: interactive ? '' : 'none',
      });
    });
  }

  async safeFetch(path, options = {}, attempt = 0) {
    const method = (options.method || 'GET').toUpperCase();
    const url = path.startsWith('http') ? path : `${GMAIL_API_BASE}${path}`;

    // Runtime guard: blocks ANY email-sending endpoint or unapproved HTTP verb
    assertSafeGmailEndpoint(method, url);

    if (!this.accessToken) {
      throw new Error('Not connected to Gmail. Please connect in Settings first.');
    }

    const res = await fetch(url, {
      ...options,
      method,
      signal: options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      this.accessToken = '';
      this.tokenExpiresAt = 0;
      throw new Error('Your Gmail session expired. Tap "Refresh / Sync Now" to reconnect.');
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || detail;
      } catch {
        // Ignore parse error
      }

      const isQuotaError =
        res.status === 429 ||
        (res.status === 403 && /quota|rate\s*limit|user-?rate/i.test(detail));

      if (isQuotaError && attempt < 3) {
        const delayMs = 1500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        return this.safeFetch(path, options, attempt + 1);
      }

      throw new Error(`Gmail API error: ${detail}`);
    }

    return res.json();
  }

  async fetchProfile() {
    const data = await this.safeFetch('/profile', { method: 'GET' });
    this.userEmail = String(data.emailAddress || '').toLowerCase();
    return this.userEmail;
  }

  /**
   * Fetches all threads from the rolling past 7 days (excluding spam/trash),
   * evaluates every thread through the strict exclusion rules, and returns
   * { activeThreads, excludedThreads, syncedAt, userEmail }.
   */
  async syncRollingSevenDays(clientId, { interactive = true, onProgress } = {}) {
    await this.ensureAuthorized(clientId, { interactive });
    onProgress?.('Checking Gmail profile…');
    const userEmail = await this.fetchProfile();

    onProgress?.(`Fetching inbox threads from the past ${ROLLING_WINDOW_DAYS} days…`);
    // Pre-filter bulk Promotions/Social/Forums in Gmail's query so we stay well under per-minute API quotas
    const query = encodeURIComponent(
      `newer_than:${ROLLING_WINDOW_DAYS}d -in:spam -in:trash -category:promotions -category:social -category:forums`
    );
    const listedThreads = [];
    let pageToken = '';

    do {
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const listData = await this.safeFetch(`/threads?q=${query}&maxResults=100${pageParam}`, { method: 'GET' });
      if (Array.isArray(listData.threads)) {
        for (const t of listData.threads) {
          if (t.id && listedThreads.length < 120) {
            listedThreads.push({ id: t.id, historyId: t.historyId || '' });
          }
        }
      }
      pageToken = listData.nextPageToken || '';
    } while (pageToken && listedThreads.length < 120);

    // Load cached thread evaluations by threadId + historyId so unchanged threads take 0ms
    const cacheKey = `tri_mail_thread_cache_v1_${userEmail}`;
    let threadCache = {};
    try {
      threadCache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    } catch {
      threadCache = {};
    }

    const toFetchIds = [];
    const cachedActive = [];
    const cachedExcluded = [];

    for (const item of listedThreads) {
      const hit = threadCache[item.id];
      if (hit && hit.historyId && hit.historyId === item.historyId && hit.decision) {
        if (hit.decision === 'include') cachedActive.push(hit.record);
        else cachedExcluded.push(hit.record);
      } else {
        toFetchIds.push(item.id);
      }
    }

    const metadataHeaders = [
      'From', 'To', 'Cc', 'Subject', 'Reply-To', 'List-Unsubscribe', 'List-Id',
      'Precedence', 'Auto-Submitted', 'X-Autoreply', 'X-Auto-Response-Suppress',
      'Message-ID', 'References',
    ]
      .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
      .join('&');

    // Stage 1: Fetch lightweight metadata ONLY for new/changed threads
    const metaThreads = [];
    const historyByThreadId = new Map(listedThreads.map((t) => [t.id, t.historyId]));
    const batchSize = 8;
    let firstBatchError = '';

    for (let i = 0; i < toFetchIds.length; i += batchSize) {
      const slice = toFetchIds.slice(i, i + batchSize);
      onProgress?.(`Scanning new threads (${Math.min(i + slice.length, toFetchIds.length)}/${toFetchIds.length})…`);
      const batchResults = await Promise.allSettled(
        slice.map((id) =>
          this.safeFetch(`/threads/${encodeURIComponent(id)}?format=metadata&${metadataHeaders}`, { method: 'GET' })
        )
      );

      for (const settled of batchResults) {
        if (settled.status !== 'fulfilled') {
          if (!firstBatchError) firstBatchError = settled.reason?.message || 'Thread fetch failed';
          continue;
        }
        const rawThread = settled.value;
        const messages = (rawThread.messages || []).map((msg) => ({
          id: msg.id,
          dateMs: Number(msg.internalDate || 0),
          labels: msg.labelIds || [],
          headers: msg.payload?.headers || [],
          snippet: msg.snippet || '',
          bodyText: '',
        }));
        metaThreads.push({ id: rawThread.id, messages });
      }
      if (i + batchSize < toFetchIds.length) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    if (toFetchIds.length > 0 && metaThreads.length === 0 && cachedActive.length === 0 && cachedExcluded.length === 0) {
      throw new Error(firstBatchError || `Could not load ${toFetchIds.length} threads from Gmail.`);
    }

    onProgress?.('Filtering out receipts, newsletters, CC-only & replied threads…');
    const firstPass = triageThreads(metaThreads, { userEmail, nowMs: Date.now() });

    // Cache metadata-excluded threads immediately
    for (const excl of firstPass.excludedThreads) {
      const hId = historyByThreadId.get(excl.threadId) || '';
      if (hId) threadCache[excl.threadId] = { historyId: hId, decision: 'exclude', record: excl };
    }

    // Stage 2: Fetch full body ONLY for new/changed candidate active threads
    const candidateIds = firstPass.activeThreads.map((t) => t.threadId);
    const fullThreads = [];
    for (let i = 0; i < candidateIds.length; i += batchSize) {
      const slice = candidateIds.slice(i, i + batchSize);
      onProgress?.(`Reading ${Math.min(i + slice.length, candidateIds.length)}/${candidateIds.length} candidate emails…`);
      const batchResults = await Promise.allSettled(
        slice.map((id) => this.safeFetch(`/threads/${encodeURIComponent(id)}?format=full`, { method: 'GET' }))
      );
      for (const settled of batchResults) {
        if (settled.status !== 'fulfilled') continue;
        const rawThread = settled.value;
        const messages = (rawThread.messages || []).map((msg) => ({
          id: msg.id,
          dateMs: Number(msg.internalDate || 0),
          labels: msg.labelIds || [],
          headers: msg.payload?.headers || [],
          snippet: msg.snippet || '',
          bodyText: extractBodyFromPayload(msg.payload),
        }));
        fullThreads.push({ id: rawThread.id, messages });
      }
    }

    const secondPass = triageThreads(fullThreads, { userEmail, nowMs: Date.now() });
    for (const inc of secondPass.activeThreads) {
      const hId = historyByThreadId.get(inc.threadId) || '';
      if (hId) threadCache[inc.threadId] = { historyId: hId, decision: 'include', record: inc };
    }
    for (const excl of secondPass.excludedThreads) {
      const hId = historyByThreadId.get(excl.threadId) || '';
      if (hId) threadCache[excl.threadId] = { historyId: hId, decision: 'exclude', record: excl };
    }

    // Trim cache to listed 7-day threads so it never grows unbounded
    const listedSet = new Set(listedThreads.map((t) => t.id));
    for (const k of Object.keys(threadCache)) {
      if (!listedSet.has(k)) delete threadCache[k];
    }
    try {
      localStorage.setItem(cacheKey, JSON.stringify(threadCache));
    } catch {
      // Ignore storage quota error on cache
    }

    const allActive = [...cachedActive, ...secondPass.activeThreads].sort(
      (a, b) => (b.dateMs || 0) - (a.dateMs || 0)
    );
    const allExcluded = [...cachedExcluded, ...firstPass.excludedThreads, ...secondPass.excludedThreads].sort(
      (a, b) => (b.dateMs || 0) - (a.dateMs || 0)
    );

    return {
      activeThreads: allActive,
      excludedThreads: allExcluded,
      evaluatedCount: listedThreads.length,
      syncedAt: new Date().toISOString(),
      userEmail,
    };
  }

  /**
   * Saves a reply STRICTLY to the Gmail Drafts folder (creates or updates an existing draft).
   * NEVER sends email.
   */
  async saveToGmailDrafts({ clientId, threadId, to, subject, body, inReplyTo = '', references = '', existingDraftId = '' }) {
    if (!String(body || '').trim()) {
      throw new Error('Draft reply is blank. Produce a draft before saving to Gmail Drafts.');
    }

    await this.ensureAuthorized(clientId, { interactive: true });

    const mime = buildDraftMimeMessage({ to, subject, body, inReplyTo, references });
    const raw = encodeUtf8ToBase64Url(mime);
    const payload = {
      message: {
        raw,
        threadId,
      },
    };

    // Strictly creates or updates a Draft resource only (never transmits or dispatches email)
    if (existingDraftId) {
      const updated = await this.safeFetch(`/drafts/${encodeURIComponent(existingDraftId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return {
        draftId: updated.id || existingDraftId,
        savedAt: new Date().toISOString(),
      };
    }

    const created = await this.safeFetch('/drafts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      draftId: created.id,
      savedAt: new Date().toISOString(),
    };
  }
}
