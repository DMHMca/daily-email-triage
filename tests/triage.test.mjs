import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_GMAIL_SCOPES,
  GMAIL_SCOPE_STRING,
  assertSafeScopeString,
  assertSafeGmailEndpoint,
} from '../docs/js/safety.js';
import { triageThreads, evaluateThread } from '../docs/js/triage-engine.js';
import { buildDemoRawThreads } from '../docs/js/demo-data.js';
import {
  composeLocalBritishDraft,
  toBritishSpelling,
  buildSalutation,
} from '../docs/js/british-drafter.js';
import { mergeTriagedThreads, buildDraftsExportText } from '../docs/js/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('Safety: Allowed scopes are gmail.readonly, gmail.compose, and gmail.send', () => {
  assert.deepEqual([...ALLOWED_GMAIL_SCOPES], [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
  ]);
  assert.equal(assertSafeScopeString(GMAIL_SCOPE_STRING), true);

  const fullScope = `https://${['mail', 'google', 'com'].join('.')}/`;
  assert.throws(() => assertSafeScopeString(fullScope), /Forbidden OAuth scope/);
  assert.throws(() => assertSafeScopeString('https://www.googleapis.com/auth/gmail.modify'), /Forbidden OAuth scope/);
});

test('Safety: Gmail API runtime guard allows read, drafts, and send, and blocks DELETE or broad writes', () => {
  assert.equal(
    assertSafeGmailEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads?q=newer_than:7d'),
    true
  );
  assert.equal(
    assertSafeGmailEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'),
    true
  );
  assert.equal(
    assertSafeGmailEndpoint('PUT', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/r12345'),
    true
  );
  assert.equal(
    assertSafeGmailEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'),
    true
  );
  assert.equal(
    assertSafeGmailEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send'),
    true
  );

  assert.throws(
    () => assertSafeGmailEndpoint('DELETE', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/123'),
    /not permitted/i
  );
});

test('UI & Client Audit: Send Email button and sendReply method are wired up', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'docs', 'js', 'app.js'), 'utf8');
  const gmailJs = fs.readFileSync(path.join(ROOT, 'docs', 'js', 'gmail-client.js'), 'utf8');

  assert.match(appJs, /Send Email/);
  assert.match(gmailJs, /async sendReply\s*\(/);
  assert.match(gmailJs, /\/messages\/send/);
});

test('Triage Engine: Includes direct unreplied 7-day threads and excludes all mandatory categories with reasons', () => {
  const nowMs = Date.UTC(2026, 10, 24, 9, 0, 0);
  const userEmail = 'david.mcaughtry@example.co.uk';
  const rawThreads = buildDemoRawThreads(userEmail, nowMs);

  // Also add an 8-day-old thread to test rolling 7-day cutoff
  rawThreads.push({
    id: 'demo-excl-old',
    messages: [
      {
        id: 'old-1',
        dateMs: nowMs - 8 * 24 * 60 * 60 * 1000,
        labels: ['INBOX'],
        headers: {
          From: 'Alex Morgan <alex@example.org>',
          To: `David McAughtry <${userEmail}>`,
          Subject: 'Last week catch-up',
        },
        bodyText: 'Could we meet next week?',
      },
    ],
  });

  const result = triageThreads(rawThreads, { userEmail, nowMs });

  assert.equal(result.activeThreads.length, 4, 'Should include the 4 genuine direct unreplied emails');
  assert.equal(result.excludedThreads.length, 7, 'Should exclude all 7 filtered threads (including 8-day-old)');

  // Strict Blank-by-Default invariant on every vetted thread
  for (const thread of result.activeThreads) {
    assert.equal(thread.notes, '', `Notes must be blank by default for ${thread.threadId}`);
    assert.equal(thread.draft, '', `Draft must be blank by default for ${thread.threadId}`);
    assert.equal(thread.status, 'active');
    assert.ok(thread.summary.length > 15, 'Summary should be populated concisely');
  }

  // Verify exact exclusion categories logged
  const categories = new Set(result.excludedThreads.map((e) => e.category));
  assert.ok(categories.has('Already Answered'));
  assert.ok(categories.has('CC-Only'));
  assert.ok(categories.has('eBay Message'));
  assert.ok(categories.has('Receipt / Order Confirmation'));
  assert.ok(categories.has('Automated Alert'));
  assert.ok(categories.has('Newsletter / Marketing'));
  assert.ok(categories.has('Outside 7-Day Window'));

  for (const excl of result.excludedThreads) {
    assert.ok(excl.reason && excl.reason.length > 10, 'Every excluded thread must record an explicit reason');
  }
});

test('Triage Engine: Handles angle-bracket-only addresses like <user@example.com> without crashing', () => {
  const nowMs = Date.now();
  const userEmail = 'david@example.co.uk';
  const res = evaluateThread(
    {
      id: 'angle-only-1',
      messages: [
        {
          id: 'm1',
          dateMs: nowMs - 1000 * 60 * 60,
          labels: ['INBOX'],
          headers: {
            From: '<jane@example.co.uk>',
            To: `<${userEmail}>`,
            Subject: 'Quick question',
          },
          bodyText: 'Could you confirm Tuesday at 10am?',
        },
      ],
    },
    { userEmail, nowMs }
  );
  assert.equal(res.decision, 'include');
  assert.equal(res.record.senderEmail, 'jane@example.co.uk');
});

test('Triage Engine: Excludes FYI / no reply requested messages', () => {
  const nowMs = Date.now();
  const userEmail = 'david@example.co.uk';
  const res = evaluateThread(
    {
      id: 'fyi-1',
      messages: [
        {
          id: 'm1',
          dateMs: nowMs - 1000 * 60 * 60,
          labels: ['INBOX'],
          headers: {
            From: 'Building Office <office@estate.co.uk>',
            To: userEmail,
            Subject: 'Window cleaning tomorrow',
          },
          bodyText: 'For your information only — window cleaners will visit tomorrow morning. No reply is needed.',
        },
      ],
    },
    { userEmail, nowMs }
  );
  assert.equal(res.decision, 'exclude');
  assert.equal(res.category, 'No Reply Requested');
});

test('British English Drafter: Refuses blank notes and produces plain polite UK prose', () => {
  assert.throws(
    () => composeLocalBritishDraft({ senderName: 'Sarah Jenkins', notes: '   ' }),
    /notes/i
  );

  assert.equal(buildSalutation('Sarah Jenkins', 'sarah@harbour.co.uk'), 'Dear Sarah,');
  assert.equal(buildSalutation('Dr Martin Patel', 'm.patel@oakwooddental.co.uk'), 'Dear Dr Patel,');
  assert.equal(
    buildSalutation('Cotswold Heating Services', 'enquiries@cotswoldheating.co.uk'),
    'Dear Cotswold Heating Services Team,'
  );

  assert.equal(toBritishSpelling('I apologize for the color inquiry and canceled favor.'), 'I apologise for the colour enquiry and cancelled favour.');

  const draft = composeLocalBritishDraft({
    senderName: 'Sarah Jenkins',
    senderEmail: 'sarah@harbourarchitects.co.uk',
    subject: 'Garden studio drawings',
    notes: 'happy with cedar cladding. apologize for delay. free Thursday 10:30 for call',
  });

  assert.match(draft, /^Dear Sarah,/);
  assert.match(draft, /I am happy with cedar cladding\./);
  assert.match(draft, /Please accept my apologies for delay\./);
  assert.match(draft, /I am available Thursday 10:30 for call\./);
  assert.match(draft, /Kind regards,\nDavid McAughtry$/);
});

test('Storage merge & export: Preserves user work across syncs and exports non-empty drafts only', () => {
  const existing = [
    {
      threadId: 't1',
      senderName: 'Sarah Jenkins',
      senderEmail: 'sarah@example.co.uk',
      subject: 'Studio drawings',
      dateMs: 2000,
      notes: 'Happy with cedar cladding',
      draft: 'Dear Sarah,\n\nThank you for your email.\n\nKind regards,\nDavid McAughtry',
      status: 'pending',
      gmailDraftId: 'dr-99',
    },
  ];
  const fresh = [
    { threadId: 't1', senderName: 'Sarah Jenkins', senderEmail: 'sarah@example.co.uk', subject: 'Studio drawings', dateMs: 2000, notes: '', draft: '', status: 'active' },
    { threadId: 't2', senderName: 'Dr Patel', senderEmail: 'patel@example.co.uk', subject: 'Check-up', dateMs: 3000, notes: '', draft: '', status: 'active' },
  ];

  const merged = mergeTriagedThreads(existing, fresh);
  const t1 = merged.find((t) => t.threadId === 't1');
  const t2 = merged.find((t) => t.threadId === 't2');

  assert.equal(t1.notes, 'Happy with cedar cladding');
  assert.equal(t1.status, 'pending');
  assert.equal(t1.gmailDraftId, 'dr-99');
  assert.equal(t2.notes, '');
  assert.equal(t2.draft, '');

  const exportTxt = buildDraftsExportText(merged);
  assert.match(exportTxt, /Total Drafts: 1/);
  assert.match(exportTxt, /Re: Studio drawings/);
  assert.doesNotMatch(exportTxt, /Check-up/);
});

test('PWA Assets: Valid manifest.json, Service Worker, and PNG icons exist', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Tri-Mail');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.length >= 2);

  for (const icon of manifest.icons) {
    const iconPath = path.join(ROOT, 'docs', icon.src.replace(/^\.\//, ''));
    const bytes = fs.readFileSync(iconPath);
    // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }

  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'sw.js')));
});
