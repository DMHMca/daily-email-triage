/**
 * Daily Email Triage Engine (Shared between Browser PWA & Lenovo Morning Sync)
 *
 * Implements:
 * - Rolling 7-day window check
 * - Strict mandatory exclusions with transparent audit reasons
 * - Concise 1-2 sentence email summary extraction
 * - Strict blank-by-default initialization for Notes and Draft Reply fields
 */

export const ROLLING_WINDOW_DAYS = 7;
export const ROLLING_WINDOW_MS = ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const EBAY_DOMAIN_RE = /(?:^|[@.])ebay\.(?:co\.uk|com|de|fr|ie|com\.au)$/i;
const EBAY_TEXT_RE = /\b(ebay|item you (?:watched|won|bought|sold)|outbid|your ebay order|new message from ebay)\b/i;

const NOREPLY_LOCAL_RE = /^(?:no-?reply|donotreply|do-not-reply|noreply[-+.]|mailer-daemon|postmaster|bounce|notifications?|alerts?|automated|auto-?confirm|system|daemon|robot|updates?|news|newsletter|digest|marketing|promo|offers?|deals|hello@news|info@news)/i;

const RECEIPT_SUBJECT_RE = /\b(receipt|order confirmation|your order|order #|order number|invoice\b|statement is ready|payment (?:received|confirmation|processed|successful)|dispatch(?:ed)?|shipped|out for delivery|delivery (?:update|notification|confirmation)|tracking number|parcel|booking confirmation|e-?ticket|tax invoice|billing summary|subscription renewed|direct debit|your amazon|your paypal|your uber|your trainline|your apple|your google play)\b/i;

const RECEIPT_SENDER_DOMAIN_RE = /(?:^|[@.])(amazon\.co\.uk|amazon\.com|paypal\.co\.uk|paypal\.com|stripe\.com|royalmail\.com|dpd\.co\.uk|dpdlocal\.co\.uk|evri\.com|myhermes\.co\.uk|yodel\.co\.uk|dhl\.com|fedex\.com|ups\.com|uber\.com|deliveroo\.co\.uk|just-eat\.co\.uk|trainline\.com|tesco\.com|sainsburys\.co\.uk|ocado\.com|argos\.co\.uk|johnlewis\.com|screwfix\.com|toolstation\.com|currys\.co\.uk|apple\.com|itunes\.com|receipts\.|billing\.|orders\.)/i;

const ALERT_SUBJECT_RE = /\b(security alert|new sign-?in|verification code|one-time (?:passcode|code)|2fa|two-factor|password reset|login attempt|unusual activity|account alert|service alert|system alert|status notification|calendar reminder|reminder:|out of office|automatic reply|auto-reply|delivery status notification|undeliverable|failed login|backup (?:completed|failed)|weekly summary|daily digest|activity report|github.*notification|pull request|issue #)\b/i;

const NEWSLETTER_SUBJECT_RE = /\b(newsletter|weekly roundup|monthly digest|daily briefing|special offer|% off|flash sale|limited time|black friday|cyber monday|unsubscribe|edition #|issue \d+|top stories|what's new in|webinar invitation|exclusive deal|new arrivals|promo code)\b/i;

const NEWSLETTER_BODY_RE = /(unsubscribe\s+from\s+this\s+list|manage\s+(?:your\s+)?email\s+preferences|view\s+(?:this\s+email\s+)?in\s+your\s+browser|you\s+are\s+receiving\s+this\s+email\s+because\s+you\s+subscribed|opt\s+out\s+of\s+future\s+emails)/i;

const NO_REPLY_REQUESTED_RE = /\b(no reply (?:is )?(?:needed|required|necessary)|no action (?:is )?required|for your information only|fyi only|this is an automated (?:message|email|notification)|please do not reply to this email|do not reply directly to this email)\b/i;

const DIRECT_ACTION_CUE_RE = /(\?|\b(please let me know|could you|would you|can you|let us know|get back to me|your thoughts|confirm whether|confirm if|please reply|please respond|please confirm|please advise|are you available|are you free|when would|shall we|happy to discuss|give me a call|awaiting your)\b)/i;

/**
 * Normalizes an email address for comparison (handles Gmail dot-insensitivity and googlemail.com).
 */
export function normalizeEmailForCompare(email = '') {
  const lower = String(email || '').trim().toLowerCase();
  const atIdx = lower.indexOf('@');
  if (atIdx === -1) return lower;
  let local = lower.slice(0, atIdx);
  let domain = lower.slice(atIdx + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    const plusIdx = local.indexOf('+');
    if (plusIdx !== -1) local = local.slice(0, plusIdx);
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

/**
 * Parses an email address header such as "Sarah Jenkins <sarah@example.co.uk>"
 * into structured display name + lowercase email address.
 */
export function parseAddress(raw = '') {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return { name: '', email: '' };

  const angleMatch = cleaned.match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>/);
  if (angleMatch) {
    return {
      name: (angleMatch[1] || '').trim().replace(/^['"]|['"]$/g, ''),
      email: (angleMatch[2] || '').trim().toLowerCase(),
    };
  }

  const emailMatch = cleaned.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch) {
    return {
      name: cleaned.replace(emailMatch[0], '').replace(/[<>"]/g, '').trim(),
      email: emailMatch[1].toLowerCase(),
    };
  }

  return { name: cleaned, email: '' };
}

/**
 * Splits a multi-recipient header (To / Cc) cleanly even when display names contain commas inside quotes.
 */
export function parseAddressList(raw = '') {
  const input = String(raw || '');
  if (!input.trim()) return [];
  const parts = [];
  let current = '';
  let inQuotes = false;
  let angleDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"' && input[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '<' && !inQuotes) {
      angleDepth += 1;
      current += ch;
    } else if (ch === '>' && !inQuotes && angleDepth > 0) {
      angleDepth -= 1;
      current += ch;
    } else if (ch === ',' && !inQuotes && angleDepth === 0) {
      if (current.trim()) parts.push(parseAddress(current));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(parseAddress(current));
  return parts;
}

/**
 * Extracts a header value case-insensitively from a Gmail headers array or plain object.
 */
export function getHeader(headers, name) {
  if (!headers) return '';
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    const found = headers.find((h) => String(h.name || '').toLowerCase() === target);
    return found ? String(found.value || '') : '';
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return String(v || '');
  }
  return '';
}

/**
 * Strips HTML tags, quoted thread history, and boilerplate disclaimers to produce clean plain text.
 */
export function cleanEmailText(rawText = '') {
  let text = String(rawText || '');

  // Strip style/script blocks & HTML tags if present
  text = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Cut off standard quoted reply blocks
  const quoteMarkers = [
    /\r?\nOn\s.+wrote:\s*\r?\n[\s\S]*/i,
    /\r?\n-{2,}\s*Original Message\s*-{2,}[\s\S]*/i,
    /\r?\nFrom:\s.+\r?\nSent:\s[\s\S]*/i,
    /\r?\n_{5,}[\s\S]*/,
  ];
  for (const marker of quoteMarkers) {
    text = text.replace(marker, '');
  }

  // Remove quoted lines starting with '>' and standard signature blocks after '-- '
  const lines = text.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '--' || trimmed === '-- ' || trimmed.startsWith('Sent from my ')) break;
    if (trimmed.startsWith('>')) continue;
    if (trimmed) kept.push(trimmed);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generates a concise 1-2 sentence summary of what an email requires.
 */
export function summarizeEmail(subject = '', bodyText = '', snippet = '') {
  const cleaned = cleanEmailText(bodyText || snippet || '');
  if (!cleaned) {
    return subject ? `Regarding "${subject}" — review the message and decide on a reply.` : 'Review the email and note your response.';
  }

  // Remove common opening greetings so the summary jumps straight to the point
  const withoutGreeting = cleaned
    .replace(/^(?:dear|hi|hello|good\s+(?:morning|afternoon|evening))\s+[^,.!?:;]{1,40}[,!:;]\s*/i, '')
    .replace(/^(?:hope\s+(?:you(?:'re|\s+are)?|this\s+finds\s+you)\s+[^.!?]{1,70}[.!]\s*)/i, '')
    .trim();

  const source = withoutGreeting || cleaned;
  const sentences = source
    .match(/[^.!?]+(?:[.!?]+|$)/g)
    ?.map((s) => s.trim())
    .filter((s) => s.length > 8) || [source];

  // Prioritize sentences that contain a question or direct request
  const actionSentence = sentences.find((s) => DIRECT_ACTION_CUE_RE.test(s));
  let chosen = [];

  if (actionSentence) {
    const idx = sentences.indexOf(actionSentence);
    if (idx > 0 && sentences[0].length < 160) {
      chosen = [sentences[0], actionSentence];
    } else if (idx + 1 < sentences.length && (actionSentence.length + sentences[idx + 1].length) < 250) {
      chosen = [actionSentence, sentences[idx + 1]];
    } else {
      chosen = [actionSentence];
    }
  } else {
    chosen = sentences.slice(0, 2);
  }

  let summary = chosen.join(' ').replace(/\s+/g, ' ').trim();
  if (summary.length > 260) {
    summary = `${summary.slice(0, 257).replace(/\s+\S*$/, '')}…`;
  }
  return summary;
}

/**
 * Normalizes a thread object (from Gmail API or demo fixture) and evaluates whether it
 * should be INCLUDED in the triage queue or EXCLUDED with an explicit audit reason.
 *
 * @param {object} thread - Normalized thread object:
 *   { id, messages: [{ id, dateMs, labels, headers, snippet, bodyText }] }
 * @param {object} options
 * @param {string} [options.userEmail] - Authenticated user's email address (lowercase)
 * @param {number} [options.nowMs] - Reference timestamp (defaults to Date.now())
 * @returns {{ decision: 'include' | 'exclude', reason?: string, category?: string, record: object }}
 */
export function evaluateThread(thread, options = {}) {
  const userEmail = String(options.userEmail || '').trim().toLowerCase();
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
  const cutoffMs = nowMs - ROLLING_WINDOW_MS;

  const allMessages = Array.isArray(thread?.messages) ? thread.messages : [];
  // Ignore Gmail draft messages when determining the latest real exchanged message
  const exchangedMessages = allMessages.filter(
    (m) => !(Array.isArray(m.labels) && m.labels.includes('DRAFT'))
  );
  const messages = exchangedMessages.length > 0 ? exchangedMessages : allMessages;
  const sorted = [...messages].sort((a, b) => (a.dateMs || 0) - (b.dateMs || 0));
  const latest = sorted[sorted.length - 1];

  if (!latest) {
    return {
      decision: 'exclude',
      category: 'Empty Thread',
      reason: 'Thread contains no readable messages.',
      record: {
        threadId: thread?.id || 'unknown',
        senderName: 'Unknown',
        senderEmail: '',
        subject: '(No subject)',
        dateIso: new Date(nowMs).toISOString(),
        reason: 'Thread contains no readable messages.',
        category: 'Empty Thread',
      },
    };
  }

  const headers = latest.headers || {};
  const fromRaw = getHeader(headers, 'From');
  const toRaw = getHeader(headers, 'To');
  const ccRaw = getHeader(headers, 'Cc');
  const subject = getHeader(headers, 'Subject') || '(No subject)';
  const replyToRaw = getHeader(headers, 'Reply-To');
  const listUnsubscribe = getHeader(headers, 'List-Unsubscribe');
  const listId = getHeader(headers, 'List-Id');
  const precedence = getHeader(headers, 'Precedence');
  const autoSubmitted = getHeader(headers, 'Auto-Submitted');
  const autoReply = getHeader(headers, 'X-Autoreply') || getHeader(headers, 'X-Auto-Response-Suppress');
  const messageIdHeader = getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id');
  const referencesHeader = getHeader(headers, 'References');

  const sender = parseAddress(fromRaw);
  const replyTo = parseAddress(replyToRaw);
  const toList = parseAddressList(toRaw);
  const ccList = parseAddressList(ccRaw);
  const labels = Array.isArray(latest.labels) ? latest.labels : [];
  const dateMs = latest.dateMs || Date.now();
  const dateIso = new Date(dateMs).toISOString();
  const bodyClean = cleanEmailText(latest.bodyText || latest.snippet || '');

  const baseAuditRecord = {
    threadId: thread.id,
    senderName: sender.name || sender.email || 'Unknown sender',
    senderEmail: sender.email,
    subject,
    dateIso,
    dateMs,
  };

  const exclude = (category, reason) => ({
    decision: 'exclude',
    category,
    reason,
    record: {
      ...baseAuditRecord,
      category,
      reason,
    },
  });

  // Rule 0: Outside rolling 7-day window
  if (dateMs < cutoffMs) {
    return exclude('Outside 7-Day Window', 'Latest message is older than the rolling 7-day triage window.');
  }

  // Rule 1: Already answered — latest message is in SENT or sent by user
  const normalizedUser = normalizeEmailForCompare(userEmail);
  const normalizedSender = normalizeEmailForCompare(sender.email);
  const isLatestSentLabel = labels.includes('SENT');
  const isLatestFromUser = Boolean(normalizedUser && normalizedSender && normalizedSender === normalizedUser);
  if (isLatestSentLabel || isLatestFromUser) {
    return exclude(
      'Already Answered',
      'Latest message in thread is already in SENT (you have already replied).'
    );
  }

  // Rule 2: eBay messages
  if (EBAY_DOMAIN_RE.test(sender.email) || EBAY_TEXT_RE.test(subject)) {
    return exclude('eBay Message', 'Excluded eBay notification or marketplace message.');
  }

  // Rule 3: CC-only or not directly addressed to user
  if (normalizedUser) {
    const userInTo = toList.some((addr) => normalizeEmailForCompare(addr.email) === normalizedUser);
    const userInCc = ccList.some((addr) => normalizeEmailForCompare(addr.email) === normalizedUser);
    if (!userInTo && userInCc) {
      return exclude('CC-Only', 'Your address appears only in CC (not directly addressed in To).');
    }
    if (!userInTo && toList.length > 0) {
      return exclude('Not Directly Addressed', 'Not directly addressed to you in the To field (group/mailing list or BCC).');
    }
  } else if (toList.length === 0 && ccList.length > 0) {
    return exclude('CC-Only', 'No direct To recipient; appears to be CC-only.');
  }

  // Rule 4: Newsletters & marketing / bulk mail
  const isBulkPrecedence = /\b(bulk|list|junk|auto_reply)\b/i.test(precedence);
  const isPromoOrSocial =
    labels.includes('CATEGORY_PROMOTIONS') ||
    labels.includes('CATEGORY_SOCIAL') ||
    labels.includes('CATEGORY_FORUMS');
  if (
    listUnsubscribe ||
    listId ||
    isBulkPrecedence ||
    isPromoOrSocial ||
    NEWSLETTER_SUBJECT_RE.test(subject) ||
    NEWSLETTER_BODY_RE.test(bodyClean)
  ) {
    const detail = listUnsubscribe
      ? 'Contains List-Unsubscribe header (newsletter or marketing list).'
      : isPromoOrSocial
        ? 'Categorised by Gmail as promotional, social, or forum mail.'
        : 'Matches newsletter or bulk mailing patterns.';
    return exclude('Newsletter / Marketing', detail);
  }

  // Rule 5: Routine receipts, invoices, order & delivery confirmations
  if (RECEIPT_SUBJECT_RE.test(subject) || RECEIPT_SENDER_DOMAIN_RE.test(sender.email)) {
    const detail = RECEIPT_SENDER_DOMAIN_RE.test(sender.email)
      ? `Routine commercial/delivery sender (${sender.email}) — receipt or order update.`
      : 'Subject matches routine receipt, invoice, or order/delivery confirmation.';
    return exclude('Receipt / Order Confirmation', detail);
  }

  // Rule 6: Automated alerts & no-reply system messages
  const isAutoSubmitted = Boolean(autoSubmitted && autoSubmitted.toLowerCase() !== 'no');
  const isNoReplySender = NOREPLY_LOCAL_RE.test(sender.email);
  if (isAutoSubmitted || autoReply || isNoReplySender || ALERT_SUBJECT_RE.test(subject)) {
    const detail = isNoReplySender
      ? `Automated no-reply sender (${sender.email}).`
      : ALERT_SUBJECT_RE.test(subject)
        ? 'Automated system, security, calendar, or service alert.'
        : 'Marked with automated mail headers (Auto-Submitted / X-Autoreply).';
    return exclude('Automated Alert', detail);
  }

  // Rule 7: No direct reply requested (explicit FYI / automated update without questions)
  if (
    NO_REPLY_REQUESTED_RE.test(bodyClean) ||
    (labels.includes('CATEGORY_UPDATES') && !DIRECT_ACTION_CUE_RE.test(`${subject} ${bodyClean}`))
  ) {
    return exclude(
      'No Reply Requested',
      'Informational update or FYI message with no direct reply requested.'
    );
  }

  // Passed all checks -> Include in active triage queue with strictly BLANK notes & draft!
  const replyAddress = replyTo.email || sender.email;
  const displayName = sender.name || replyAddress.split('@')[0] || 'Sender';
  const summary = summarizeEmail(subject, latest.bodyText, latest.snippet);

  return {
    decision: 'include',
    record: {
      threadId: thread.id,
      latestMessageId: latest.id || '',
      messageIdHeader,
      referencesHeader,
      senderName: displayName,
      senderEmail: sender.email,
      replyToEmail: replyAddress,
      toRaw,
      ccRaw,
      subject,
      dateIso,
      dateMs,
      summary,
      snippet: (latest.snippet || bodyClean.slice(0, 280)).trim(),
      bodyPreview: bodyClean.slice(0, 2400),
      status: 'active',
      // STRICT SPEC REQUIREMENT: Always blank by default
      notes: '',
      draft: '',
      gmailDraftId: '',
      gmailDraftSavedAt: '',
    },
  };
}

/**
 * Evaluates a list of threads and returns sorted active queue + excluded audit log.
 */
export function triageThreads(threads = [], options = {}) {
  const activeThreads = [];
  const excludedThreads = [];

  for (const thread of threads) {
    const result = evaluateThread(thread, options);
    if (result.decision === 'include') {
      activeThreads.push(result.record);
    } else {
      excludedThreads.push(result.record);
    }
  }

  // Most recent first
  activeThreads.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
  excludedThreads.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));

  return {
    activeThreads,
    excludedThreads,
    evaluatedCount: threads.length,
    syncedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
  };
}
