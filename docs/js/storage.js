/**
 * Persistent Workspace Storage (IndexedDB with localStorage mirror/fallback)
 *
 * Persists across reloads and offline sessions on Pixel & desktop:
 * - Vetted threads (notes, generated drafts, Gmail draft IDs, Active / Pending / Archived status)
 * - Audited & Excluded threads log
 * - Sync metadata & user settings
 */

const DB_NAME = 'daily-email-triage-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';
const STATE_KEY = 'currentState';
const LS_FALLBACK_KEY = 'detw_workspace_state_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  googleClientId: '',
  geminiApiKey: '',
  morningRefreshTime: '06:30',
  signOffName: 'David McAughtry',
  mode: 'demo', // 'demo' | 'gmail'
});

export function createInitialState() {
  return {
    version: 1,
    mode: 'demo',
    userEmail: 'david.mcaughtry@example.co.uk',
    syncedAt: '',
    lastMorningAutoSyncDate: '',
    threads: [],
    excludedThreads: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function normalizeState(raw) {
  const base = createInitialState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw.settings || {}),
    },
    threads: Array.isArray(raw.threads) ? raw.threads : [],
    excludedThreads: Array.isArray(raw.excludedThreads) ? raw.excludedThreads : [],
  };
}

export async function loadWorkspaceState() {
  try {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STATE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (record) return normalizeState(record);
  } catch {
    // Fall through to localStorage
  }

  try {
    const lsRaw = localStorage.getItem(LS_FALLBACK_KEY);
    if (lsRaw) return normalizeState(JSON.parse(lsRaw));
  } catch {
    // Ignore storage read error
  }

  return createInitialState();
}

export async function saveWorkspaceState(state) {
  const clean = normalizeState(state);

  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(clean));
  } catch {
    // Quota or private browsing fallback
  }

  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(clean, STATE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // localStorage already saved above
  }

  return clean;
}

/**
 * Merges newly fetched threads with persisted user work:
 * - Preserves existing notes, drafts, Gmail draft IDs, and pending/archived statuses
 * - Guarantees brand-new threads start strictly with blank notes ("") and blank draft ("")
 */
export function mergeTriagedThreads(existingThreads = [], freshThreads = []) {
  const existingMap = new Map(existingThreads.map((t) => [t.threadId, t]));

  const merged = freshThreads.map((fresh) => {
    const prev = existingMap.get(fresh.threadId);
    if (!prev) {
      return {
        ...fresh,
        notes: '',
        draft: '',
        gmailDraftId: '',
        gmailDraftSavedAt: '',
        status: 'active',
      };
    }

    // Keep user's in-progress notes, generated draft, Gmail draft ID, and Pending/Archived status
    return {
      ...fresh,
      notes: typeof prev.notes === 'string' ? prev.notes : '',
      draft: typeof prev.draft === 'string' ? prev.draft : '',
      draftEngine: prev.draftEngine || '',
      gmailDraftId: prev.gmailDraftId || '',
      gmailDraftSavedAt: prev.gmailDraftSavedAt || '',
      status: prev.status || 'active',
    };
  });

  // Also retain any Pending or Handled/Archived threads that have user notes or drafts even if they aged past 7 days
  const freshIds = new Set(freshThreads.map((t) => t.threadId));
  for (const prev of existingThreads) {
    if (!freshIds.has(prev.threadId) && (prev.status === 'pending' || prev.status === 'archived' || prev.status === 'no_action' || prev.notes || prev.draft)) {
      merged.push(prev);
    }
  }

  merged.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
  return merged;
}

/**
 * Exports all non-empty drafts into a formatted UTF-8 plain text string.
 */
export function buildDraftsExportText(threads = [], exportedAt = new Date()) {
  const withDrafts = threads.filter((t) => String(t.draft || '').trim().length > 0);
  if (withDrafts.length === 0) return '';

  const headerDate = exportedAt.toLocaleString('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const sections = withDrafts.map((t, idx) => {
    const replySubject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
    return [
      `====================================================================`,
      `DRAFT ${idx + 1} of ${withDrafts.length}`,
      `To: ${t.senderName} <${t.replyToEmail || t.senderEmail}>`,
      `Subject: ${replySubject}`,
      `Status: ${t.status === 'pending' ? 'Pending' : t.status === 'archived' ? 'Handled / Archived' : 'Active'}`,
      t.gmailDraftId ? `Gmail Draft: Saved (ID: ${t.gmailDraftId})` : `Gmail Draft: Not yet saved to Gmail`,
      `--------------------------------------------------------------------`,
      t.draft.trim(),
    ].join('\n');
  });

  return [
    `DAILY EMAIL TRIAGE & DRAFT WORKSPACE — EXPORTED DRAFTS`,
    `Owner: David McAughtry`,
    `Exported: ${headerDate}`,
    `Mode: Draft-Only (No automated sending)`,
    `Total Drafts: ${withDrafts.length}`,
    '',
    ...sections,
    '',
  ].join('\n');
}
