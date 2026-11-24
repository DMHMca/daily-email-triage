/**
 * Daily Email Triage & Draft Workspace — Main PWA Controller
 * Owner: David McAughtry
 * Mode: Strict Draft-Only (No Send UI, No Send Scope, Blank-by-Default Notes & Drafts)
 */

import { ALLOWED_GMAIL_SCOPES } from './safety.js';
import { triageThreads } from './triage-engine.js';
import { produceBritishDraft } from './british-drafter.js';
import { buildDemoRawThreads } from './demo-data.js';
import { SafeGmailClient } from './gmail-client.js';
import {
  loadWorkspaceState,
  saveWorkspaceState,
  mergeTriagedThreads,
  buildDraftsExportText,
} from './storage.js';
import { BritishDictationController, isSpeechRecognitionSupported } from './speech.js';

const gmailClient = new SafeGmailClient();
const dictation = new BritishDictationController();

let state = null;
let currentTab = 'active'; // 'active' | 'pending' | 'archived'
let isSyncing = false;
let excludedFilterQuery = '';
let saveTimer = null;

// DOM refs
const el = {
  syncStatusText: document.getElementById('syncStatusText'),
  syncErrorBox: document.getElementById('syncErrorBox'),
  modeBanner: document.getElementById('modeBanner'),
  refreshBtn: document.getElementById('refreshBtn'),
  exportBtn: document.getElementById('exportBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  updateAppBtn: document.getElementById('updateAppBtn'),
  tabButtons: Array.from(document.querySelectorAll('[data-tab]')),
  countActive: document.getElementById('count-active'),
  countPending: document.getElementById('count-pending'),
  countArchived: document.getElementById('count-archived'),
  threadList: document.getElementById('threadList'),
  excludedCountBadge: document.getElementById('excludedCountBadge'),
  excludedSearchInput: document.getElementById('excludedSearchInput'),
  excludedList: document.getElementById('excludedList'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  checkUpdateBtn: document.getElementById('checkUpdateBtn'),
  settingsForm: document.getElementById('settingsForm'),
  clientIdInput: document.getElementById('clientIdInput'),
  geminiKeyInput: document.getElementById('geminiKeyInput'),
  morningTimeInput: document.getElementById('morningTimeInput'),
  signOffNameInput: document.getElementById('signOffNameInput'),
  connectGmailBtn: document.getElementById('connectGmailBtn'),
  disconnectGmailBtn: document.getElementById('disconnectGmailBtn'),
  loadDemoBtn: document.getElementById('loadDemoBtn'),
  connectionStatusPill: document.getElementById('connectionStatusPill'),
  originDisplay: document.getElementById('originDisplay'),
  scopeListDisplay: document.getElementById('scopeListDisplay'),
  toastContainer: document.getElementById('toastContainer'),
};

function showToast(message, variant = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  el.toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 260);
  }, 3600);
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveWorkspaceState(state);
  }, 180);
}

async function persistNow() {
  clearTimeout(saveTimer);
  await saveWorkspaceState(state);
}

function formatUkDateTime(isoOrMs) {
  if (!isoOrMs) return '';
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name = '') {
  const parts = String(name || '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isPastMorningRefreshTime(timeStr = '06:30', now = new Date()) {
  const [hStr, mStr] = String(timeStr || '06:30').split(':');
  const targetH = Number(hStr) || 6;
  const targetM = Number(mStr) || 30;
  return now.getHours() > targetH || (now.getHours() === targetH && now.getMinutes() >= targetM);
}

function renderStatusHeader() {
  const syncStamp = state.syncedAt ? formatUkDateTime(state.syncedAt) : 'Not synced yet';
  const modeLabel = state.mode === 'gmail' ? `Gmail (${state.userEmail || 'Connected'})` : 'Preview Mode (Sample Inbox)';
  el.syncStatusText.textContent = isSyncing
    ? 'Syncing rolling 7-day inbox…'
    : `${modeLabel} · Last refresh: ${syncStamp}`;

  if (state.mode === 'demo') {
    el.modeBanner.hidden = false;
    el.modeBanner.innerHTML = '';
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Preview Mode is active with sample UK emails so you can test dictation, drafting, and exclusions right away.';
    const setupAction = document.createElement('button');
    setupAction.type = 'button';
    setupAction.className = 'btn btn-inline';
    setupAction.textContent = 'Connect Gmail (Read-Only + Drafts)';
    setupAction.addEventListener('click', openSettingsModal);
    el.modeBanner.append(textSpan, setupAction);
  } else {
    el.modeBanner.hidden = true;
  }

  const activeCount = state.threads.filter((t) => t.status === 'active').length;
  const pendingCount = state.threads.filter((t) => t.status === 'pending').length;
  const archivedCount = state.threads.filter((t) => t.status === 'archived').length;

  el.countActive.textContent = String(activeCount);
  el.countPending.textContent = String(pendingCount);
  el.countArchived.textContent = String(archivedCount);

  for (const btn of el.tabButtons) {
    const selected = btn.dataset.tab === currentTab;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-selected', String(selected));
  }

  const nonEmptyDrafts = state.threads.filter((t) => String(t.draft || '').trim().length > 0).length;
  el.exportBtn.textContent = nonEmptyDrafts > 0 ? `Export Drafts (${nonEmptyDrafts})` : 'Export Drafts';
}

function createEmailCard(thread) {
  const card = document.createElement('article');
  card.className = `email-card status-${thread.status}`;
  card.dataset.threadId = thread.threadId;

  // 1. Header: Avatar, Sender Name & Email, Date, Subject
  const header = document.createElement('header');
  header.className = 'card-header';

  const avatar = document.createElement('div');
  avatar.className = 'sender-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = getInitials(thread.senderName);

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const senderRow = document.createElement('div');
  senderRow.className = 'sender-row';

  const senderName = document.createElement('span');
  senderName.className = 'sender-name';
  senderName.textContent = thread.senderName;

  const dateSpan = document.createElement('time');
  dateSpan.className = 'email-date';
  dateSpan.dateTime = thread.dateIso;
  dateSpan.textContent = formatUkDateTime(thread.dateIso);

  senderRow.append(senderName, dateSpan);

  const senderEmail = document.createElement('div');
  senderEmail.className = 'sender-email';
  senderEmail.textContent = thread.senderEmail;

  const subjectEl = document.createElement('h2');
  subjectEl.className = 'email-subject';
  subjectEl.textContent = thread.subject;

  meta.append(senderRow, senderEmail, subjectEl);
  header.append(avatar, meta);

  // 2. Concise 1-2 sentence Summary + optional original email disclosure
  const summaryBox = document.createElement('div');
  summaryBox.className = 'summary-box';

  const summaryLabel = document.createElement('span');
  summaryLabel.className = 'summary-label';
  summaryLabel.textContent = 'Requires';

  const summaryText = document.createElement('p');
  summaryText.className = 'summary-text';
  summaryText.textContent = thread.summary;

  summaryBox.append(summaryLabel, summaryText);

  if (thread.bodyPreview) {
    const origDetails = document.createElement('details');
    origDetails.className = 'original-disclosure';
    const origSummary = document.createElement('summary');
    origSummary.textContent = 'View original email';
    const origBody = document.createElement('p');
    origBody.className = 'original-body';
    origBody.textContent = thread.bodyPreview;
    origDetails.append(origSummary, origBody);
    summaryBox.append(origDetails);
  }

  // 3. Essence / Notes Input (STRICTLY blank by default) + en-GB Voice Dictation
  const notesGroup = document.createElement('div');
  notesGroup.className = 'field-group';

  const notesLabelRow = document.createElement('div');
  notesLabelRow.className = 'field-label-row';

  const notesLabel = document.createElement('label');
  const notesId = `notes-${thread.threadId}`;
  notesLabel.htmlFor = notesId;
  notesLabel.className = 'field-label';
  notesLabel.textContent = 'Essence / Notes';

  const dictateBtn = document.createElement('button');
  dictateBtn.type = 'button';
  dictateBtn.className = 'btn btn-mic';
  dictateBtn.dataset.action = 'dictate';
  dictateBtn.setAttribute('aria-pressed', 'false');
  dictateBtn.textContent = isSpeechRecognitionSupported()
    ? 'Dictate (en-GB)'
    : 'Voice (Keyboard)';

  notesLabelRow.append(notesLabel, dictateBtn);

  const interimLine = document.createElement('div');
  interimLine.className = 'dictation-interim';
  interimLine.hidden = true;

  const notesInput = document.createElement('textarea');
  notesInput.id = notesId;
  notesInput.className = 'field-textarea notes-input';
  notesInput.rows = 3;
  notesInput.lang = 'en-GB';
  notesInput.placeholder = 'Tap Dictate (en-GB) or type brief notes for your reply…';
  notesInput.value = thread.notes || '';
  notesInput.addEventListener('input', () => {
    thread.notes = notesInput.value;
    schedulePersist();
  });

  notesGroup.append(notesLabelRow, interimLine, notesInput);

  // 4. Draft Reply Output (STRICTLY blank by default until "Produce Draft" clicked)
  const draftGroup = document.createElement('div');
  draftGroup.className = 'field-group';

  const draftLabelRow = document.createElement('div');
  draftLabelRow.className = 'field-label-row';

  const draftLabel = document.createElement('label');
  const draftId = `draft-${thread.threadId}`;
  draftLabel.htmlFor = draftId;
  draftLabel.className = 'field-label';
  draftLabel.textContent = 'Draft Reply (British English)';

  const draftBadge = document.createElement('span');
  draftBadge.className = 'draft-status-badge';
  updateDraftBadge(draftBadge, thread);

  draftLabelRow.append(draftLabel, draftBadge);

  const draftInput = document.createElement('textarea');
  draftInput.id = draftId;
  draftInput.className = 'field-textarea draft-output';
  draftInput.rows = 6;
  draftInput.lang = 'en-GB';
  draftInput.placeholder = 'Remains blank until you add notes and tap Produce Draft.';
  draftInput.value = thread.draft || '';
  draftInput.addEventListener('input', () => {
    thread.draft = draftInput.value;
    renderStatusHeader();
    schedulePersist();
  });

  draftGroup.append(draftLabelRow, draftInput);

  // 5. Per-Thread Actions (NO "Send" button anywhere!)
  const actionsBar = document.createElement('div');
  actionsBar.className = 'card-actions';

  const produceBtn = document.createElement('button');
  produceBtn.type = 'button';
  produceBtn.className = 'btn btn-primary';
  produceBtn.textContent = 'Produce Draft';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-secondary';
  copyBtn.textContent = 'Copy Draft';

  const saveDraftBtn = document.createElement('button');
  saveDraftBtn.type = 'button';
  saveDraftBtn.className = 'btn btn-secondary btn-gmail-draft';
  saveDraftBtn.textContent = thread.gmailDraftId ? 'Update Gmail Draft' : 'Save to Gmail Drafts';

  const statusActions = document.createElement('div');
  statusActions.className = 'status-actions';

  const pendBtn = document.createElement('button');
  pendBtn.type = 'button';
  pendBtn.className = 'btn btn-ghost btn-pend';
  pendBtn.textContent = thread.status === 'pending' ? 'Move to Active' : 'Pend';

  const archiveBtn = document.createElement('button');
  archiveBtn.type = 'button';
  archiveBtn.className = 'btn btn-ghost btn-archive';
  archiveBtn.textContent = thread.status === 'archived' ? 'Reopen' : 'Archive / Done';

  statusActions.append(pendBtn, archiveBtn);
  actionsBar.append(produceBtn, copyBtn, saveDraftBtn, statusActions);

  // Wire up per-card event handlers
  dictateBtn.addEventListener('click', () => {
    const started = dictation.start({
      threadId: thread.threadId,
      onFinalText: (chunk) => {
        const existing = notesInput.value.trim();
        const combined = existing ? `${existing} ${chunk}` : chunk;
        notesInput.value = combined;
        thread.notes = combined;
        schedulePersist();
      },
      onInterimText: (interim) => {
        if (interim) {
          interimLine.hidden = false;
          interimLine.textContent = `Listening (en-GB): ${interim}`;
        } else {
          interimLine.hidden = true;
          interimLine.textContent = '';
        }
      },
      onStateChange: ({ listening }) => {
        dictateBtn.classList.toggle('recording', listening);
        dictateBtn.setAttribute('aria-pressed', String(listening));
        dictateBtn.textContent = listening ? 'Stop Dictation' : 'Dictate (en-GB)';
        if (!listening) {
          interimLine.hidden = true;
          interimLine.textContent = '';
        }
      },
      onError: (msg) => showToast(msg, 'warn'),
    });
    if (started) {
      notesInput.focus();
    }
  });

  produceBtn.addEventListener('click', async () => {
    const notesText = notesInput.value.trim();
    if (!notesText) {
      showToast('Add brief notes or dictate in Essence / Notes before producing a draft.', 'warn');
      notesInput.focus();
      return;
    }

    produceBtn.disabled = true;
    const originalLabel = produceBtn.textContent;
    produceBtn.textContent = 'Drafting…';

    try {
      const result = await produceBritishDraft({
        senderName: thread.senderName,
        senderEmail: thread.replyToEmail || thread.senderEmail,
        subject: thread.subject,
        summary: thread.summary,
        notes: notesText,
        geminiApiKey: state.settings.geminiApiKey,
        signOffName: state.settings.signOffName || 'David McAughtry',
      });

      thread.draft = result.draft;
      thread.draftEngine = result.engine;
      draftInput.value = result.draft;
      updateDraftBadge(draftBadge, thread);
      renderStatusHeader();
      await persistNow();

      if (result.warning) {
        showToast(`Draft ready (local British English composer used: ${result.warning})`, 'warn');
      } else {
        showToast('British English draft ready for review.', 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to produce draft.', 'error');
    } finally {
      produceBtn.disabled = false;
      produceBtn.textContent = originalLabel;
    }
  });

  copyBtn.addEventListener('click', async () => {
    const draftText = draftInput.value.trim();
    if (!draftText) {
      showToast('No draft text to copy yet. Click Produce Draft first.', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(draftText);
      showToast('Draft copied to clipboard.', 'success');
    } catch {
      draftInput.select();
      document.execCommand('copy');
      showToast('Draft copied to clipboard.', 'success');
    }
  });

  saveDraftBtn.addEventListener('click', async () => {
    const draftText = draftInput.value.trim();
    if (!draftText) {
      showToast('Generate a draft reply before saving to Gmail Drafts.', 'warn');
      return;
    }

    if (state.mode !== 'gmail' || !state.settings.googleClientId) {
      showToast('Connect Gmail in Settings to save directly into your Gmail Drafts folder (draft-only, never sent).', 'warn');
      openSettingsModal();
      return;
    }

    saveDraftBtn.disabled = true;
    const prevLabel = saveDraftBtn.textContent;
    saveDraftBtn.textContent = 'Saving Draft…';

    try {
      const saved = await gmailClient.saveToGmailDrafts({
        clientId: state.settings.googleClientId,
        threadId: thread.threadId,
        to: thread.replyToEmail || thread.senderEmail,
        subject: thread.subject,
        body: draftText,
        inReplyTo: thread.messageIdHeader,
        references: thread.referencesHeader,
        existingDraftId: thread.gmailDraftId,
      });

      thread.gmailDraftId = saved.draftId;
      thread.gmailDraftSavedAt = saved.savedAt;
      saveDraftBtn.textContent = 'Update Gmail Draft';
      updateDraftBadge(draftBadge, thread);
      await persistNow();
      showToast('Saved strictly to Gmail Drafts for your manual review.', 'success');
    } catch (err) {
      saveDraftBtn.textContent = prevLabel;
      showToast(err instanceof Error ? err.message : 'Could not save Gmail draft.', 'error');
    } finally {
      saveDraftBtn.disabled = false;
    }
  });

  pendBtn.addEventListener('click', async () => {
    if (dictation.activeThreadId === thread.threadId) dictation.stop();
    thread.status = thread.status === 'pending' ? 'active' : 'pending';
    await persistNow();
    renderAll();
    showToast(
      thread.status === 'pending' ? 'Moved to Pending.' : 'Returned to All Active.',
      'info'
    );
  });

  archiveBtn.addEventListener('click', async () => {
    if (dictation.activeThreadId === thread.threadId) dictation.stop();
    thread.status = thread.status === 'archived' ? 'active' : 'archived';
    await persistNow();
    renderAll();
    showToast(
      thread.status === 'archived' ? 'Marked Handled / Archived.' : 'Reopened in All Active.',
      'info'
    );
  });

  card.append(header, summaryBox, notesGroup, draftGroup, actionsBar);
  return card;
}

function updateDraftBadge(badgeEl, thread) {
  if (thread.gmailDraftId) {
    badgeEl.textContent = 'Saved in Gmail Drafts';
    badgeEl.className = 'draft-status-badge saved';
  } else if (String(thread.draft || '').trim()) {
    badgeEl.textContent = thread.draftEngine === 'gemini' ? 'Draft ready · Gemini UK' : 'Draft ready · Local UK';
    badgeEl.className = 'draft-status-badge ready';
  } else {
    badgeEl.textContent = 'Blank by default';
    badgeEl.className = 'draft-status-badge';
  }
}

function renderThreadList() {
  const filtered = state.threads.filter((t) => t.status === currentTab);
  el.threadList.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h3');
    const body = document.createElement('p');
    if (currentTab === 'active') {
      title.textContent = 'All clear in All Active';
      body.textContent = 'No unreplied emails from the past 7 days require a response right now.';
    } else if (currentTab === 'pending') {
      title.textContent = 'No Pending threads';
      body.textContent = 'Use Pend on any email card to park it here for later review.';
    } else {
      title.textContent = 'No Handled / Archived threads yet';
      body.textContent = 'Threads you mark Archive / Done will appear here.';
    }
    empty.append(title, body);
    el.threadList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const thread of filtered) {
    fragment.appendChild(createEmailCard(thread));
  }
  el.threadList.appendChild(fragment);
}

function renderExcludedLog() {
  const allExcluded = state.excludedThreads || [];
  el.excludedCountBadge.textContent = String(allExcluded.length);

  const q = excludedFilterQuery.trim().toLowerCase();
  const visible = q
    ? allExcluded.filter(
        (item) =>
          item.senderName.toLowerCase().includes(q) ||
          item.senderEmail.toLowerCase().includes(q) ||
          item.subject.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q)
      )
    : allExcluded;

  el.excludedList.innerHTML = '';

  if (visible.length === 0) {
    const li = document.createElement('li');
    li.className = 'excluded-empty';
    li.textContent = allExcluded.length === 0
      ? 'No threads excluded in the current 7-day audit.'
      : 'No excluded threads match your filter.';
    el.excludedList.appendChild(li);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    const li = document.createElement('li');
    li.className = 'excluded-item';

    const topRow = document.createElement('div');
    topRow.className = 'excluded-top';

    const badge = document.createElement('span');
    badge.className = 'excluded-category';
    badge.textContent = item.category;

    const dateEl = document.createElement('time');
    dateEl.className = 'excluded-date';
    dateEl.textContent = formatUkDateTime(item.dateIso);

    topRow.append(badge, dateEl);

    const subjectEl = document.createElement('div');
    subjectEl.className = 'excluded-subject';
    subjectEl.textContent = item.subject;

    const senderEl = document.createElement('div');
    senderEl.className = 'excluded-sender';
    senderEl.textContent = item.senderEmail
      ? `${item.senderName} <${item.senderEmail}>`
      : item.senderName;

    const reasonEl = document.createElement('div');
    reasonEl.className = 'excluded-reason';
    reasonEl.textContent = `Reason: ${item.reason}`;

    li.append(topRow, subjectEl, senderEl, reasonEl);
    fragment.appendChild(li);
  }

  el.excludedList.appendChild(fragment);
}

function renderAll() {
  renderStatusHeader();
  renderThreadList();
  renderExcludedLog();
}

async function runSync({ interactive = true, forceDemo = false } = {}) {
  if (isSyncing) return;
  isSyncing = true;
  el.syncErrorBox.hidden = true;
  el.syncErrorBox.textContent = '';
  el.refreshBtn.disabled = true;
  el.refreshBtn.textContent = 'Syncing…';
  renderStatusHeader();

  try {
    if (!forceDemo && state.mode === 'gmail' && state.settings.googleClientId) {
      const result = await gmailClient.syncRollingSevenDays(state.settings.googleClientId, {
        interactive,
        onProgress: (msg) => {
          el.syncStatusText.textContent = msg;
        },
      });

      state.userEmail = result.userEmail;
      state.syncedAt = result.syncedAt;
      state.lastMorningAutoSyncDate = getLocalDateKey();
      state.threads = mergeTriagedThreads(state.threads, result.activeThreads);
      state.excludedThreads = result.excludedThreads;
      await persistNow();
      showToast(
        `Synced ${result.evaluatedCount} threads: ${result.activeThreads.length} requiring reply, ${result.excludedThreads.length} excluded.`,
        'success'
      );
    } else {
      const demoEmail = 'david.mcaughtry@example.co.uk';
      const rawDemo = buildDemoRawThreads(demoEmail, Date.now());
      const triaged = triageThreads(rawDemo, { userEmail: demoEmail, nowMs: Date.now() });
      state.mode = 'demo';
      state.userEmail = demoEmail;
      state.syncedAt = triaged.syncedAt;
      state.threads = mergeTriagedThreads(state.threads, triaged.activeThreads);
      state.excludedThreads = triaged.excludedThreads;
      await persistNow();
      showToast(
        `Preview inbox refreshed: ${triaged.activeThreads.length} active, ${triaged.excludedThreads.length} excluded & audited.`,
        'info'
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Sync failed.';
    el.syncErrorBox.hidden = false;
    el.syncErrorBox.textContent = `Sync issue: ${errMsg}`;
    showToast(errMsg, 'error');
  } finally {
    isSyncing = false;
    el.refreshBtn.disabled = false;
    el.refreshBtn.textContent = 'Refresh / Sync Now';
    renderAll();
  }
}

function exportDraftsToTxt() {
  const content = buildDraftsExportText(state.threads, new Date());
  if (!content) {
    showToast('No non-empty drafts to export yet.', 'warn');
    return;
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = getLocalDateKey(new Date());
  link.href = url;
  link.download = `daily-email-drafts-${dateStamp}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported drafts to daily-email-drafts-${dateStamp}.txt`, 'success');
}

function openSettingsModal() {
  el.clientIdInput.value = state.settings.googleClientId || '';
  el.geminiKeyInput.value = state.settings.geminiApiKey || '';
  el.morningTimeInput.value = state.settings.morningRefreshTime || '06:30';
  el.signOffNameInput.value = state.settings.signOffName || 'David McAughtry';
  el.originDisplay.textContent = window.location.origin;
  el.scopeListDisplay.textContent = ALLOWED_GMAIL_SCOPES.join('\n');

  const connected = state.mode === 'gmail' && gmailClient.isSignedIn();
  el.connectionStatusPill.textContent = connected
    ? `Connected to ${state.userEmail || 'Gmail'} (Draft-Only)`
    : state.mode === 'gmail'
      ? 'Gmail configured — tap Connect / Refresh to sign in'
      : 'Currently in Preview Mode (Sample Inbox)';
  el.connectionStatusPill.className = `conn-pill ${connected ? 'connected' : ''}`;

  el.settingsModal.showModal();
}

function closeSettingsModal() {
  if (el.settingsModal.open) el.settingsModal.close();
}

async function handleSettingsSave(event) {
  event.preventDefault();
  state.settings.googleClientId = el.clientIdInput.value.trim();
  state.settings.geminiApiKey = el.geminiKeyInput.value.trim();
  state.settings.morningRefreshTime = el.morningTimeInput.value || '06:30';
  state.settings.signOffName = el.signOffNameInput.value.trim() || 'David McAughtry';
  await persistNow();
  showToast('Settings saved on this device.', 'success');
  closeSettingsModal();
  renderAll();
}

async function handleConnectGmail() {
  const clientId = el.clientIdInput.value.trim();
  if (!clientId) {
    showToast('Paste your Google OAuth Client ID first.', 'warn');
    el.clientIdInput.focus();
    return;
  }
  state.settings.googleClientId = clientId;
  state.settings.geminiApiKey = el.geminiKeyInput.value.trim();
  state.settings.morningRefreshTime = el.morningTimeInput.value || '06:30';
  state.settings.signOffName = el.signOffNameInput.value.trim() || 'David McAughtry';
  state.mode = 'gmail';
  // Clear sample demo threads when switching to real Gmail
  state.threads = state.threads.filter((t) => !String(t.threadId).startsWith('demo-'));
  state.excludedThreads = [];
  await persistNow();
  closeSettingsModal();
  await runSync({ interactive: true });
}

async function handleDisconnectGmail() {
  gmailClient.signOut();
  state.mode = 'demo';
  await persistNow();
  showToast('Disconnected Gmail session.', 'info');
  openSettingsModal();
  renderAll();
}

async function handleResetPreview() {
  state.mode = 'demo';
  state.threads = [];
  state.excludedThreads = [];
  await persistNow();
  closeSettingsModal();
  await runSync({ forceDemo: true });
}

let swRegistration = null;
let reloadingForUpdate = false;

function showUpdateAvailableButton() {
  if (el.updateAppBtn) {
    el.updateAppBtn.textContent = 'Update Available';
    el.updateAppBtn.className = 'btn btn-update-ready btn-sm';
  }
}

function promptOrApplyAppUpdate() {
  if (reloadingForUpdate) return;
  showUpdateAvailableButton();
  const activeTag = document.activeElement?.tagName;
  if (activeTag !== 'TEXTAREA' && activeTag !== 'INPUT') {
    reloadingForUpdate = true;
    window.location.reload();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    promptOrApplyAppUpdate();
  });

  window.addEventListener('load', async () => {
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      swRegistration.update().catch(() => {});
    } catch {
      // Non-fatal in non-secure dev environments
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swRegistration) {
      swRegistration.update().catch(() => {});
    }
  });
}

async function handleCheckForUpdate() {
  if (!('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }
  try {
    const reg = swRegistration || (await navigator.serviceWorker.getRegistration('./'));
    if (reg) {
      await reg.update();
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        showToast('Applying update…', 'info');
        return;
      }
    }
    showToast('Reloading latest version of Tri-Mail…', 'info');
    setTimeout(() => window.location.reload(), 300);
  } catch {
    window.location.reload();
  }
}

async function init() {
  registerServiceWorker();

  state = await loadWorkspaceState();

  // First run: populate Preview Mode sample queue (strictly blank Notes & Drafts)
  if (state.threads.length === 0 && state.excludedThreads.length === 0 && state.mode === 'demo') {
    const demoEmail = 'david.mcaughtry@example.co.uk';
    const triaged = triageThreads(buildDemoRawThreads(demoEmail, Date.now()), {
      userEmail: demoEmail,
      nowMs: Date.now(),
    });
    state.userEmail = demoEmail;
    state.syncedAt = triaged.syncedAt;
    state.threads = triaged.activeThreads;
    state.excludedThreads = triaged.excludedThreads;
    await persistNow();
  }

  // Tab navigation
  for (const btn of el.tabButtons) {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderAll();
    });
  }

  // Global actions
  el.refreshBtn.addEventListener('click', () => runSync({ interactive: true }));
  el.exportBtn.addEventListener('click', exportDraftsToTxt);
  el.settingsBtn.addEventListener('click', openSettingsModal);
  el.updateAppBtn.addEventListener('click', handleCheckForUpdate);
  el.closeSettingsBtn.addEventListener('click', closeSettingsModal);
  el.checkUpdateBtn.addEventListener('click', handleCheckForUpdate);
  el.settingsForm.addEventListener('submit', handleSettingsSave);
  el.connectGmailBtn.addEventListener('click', handleConnectGmail);
  el.disconnectGmailBtn.addEventListener('click', handleDisconnectGmail);
  el.loadDemoBtn.addEventListener('click', handleResetPreview);

  el.excludedSearchInput.addEventListener('input', () => {
    excludedFilterQuery = el.excludedSearchInput.value;
    renderExcludedLog();
  });

  // Close dialog on backdrop click
  el.settingsModal.addEventListener('click', (event) => {
    if (event.target === el.settingsModal) closeSettingsModal();
  });

  renderAll();

  // Automatic morning refresh check when Gmail is configured and opened after 06:30
  if (
    state.mode === 'gmail' &&
    state.settings.googleClientId &&
    state.lastMorningAutoSyncDate !== getLocalDateKey() &&
    isPastMorningRefreshTime(state.settings.morningRefreshTime)
  ) {
    // Attempt non-intrusive refresh notice (GIS requires user gesture if token expired)
    showToast('Morning queue ready to refresh — tap Refresh / Sync Now to pull the latest 7-day emails.', 'info');
  }
}

init();
