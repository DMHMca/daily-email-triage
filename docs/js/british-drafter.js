/**
 * British English Draft Composer
 *
 * Strictly invoked ONLY when the user explicitly clicks "Produce Draft".
 * Produces plain, polite British English prose addressed appropriately
 * to a person or company, with optional Gemini API enhancement when configured.
 */

const US_TO_UK_REPLACEMENTS = [
  [/\bapologize\b/gi, 'apologise'],
  [/\bapologized\b/gi, 'apologised'],
  [/\bapologizing\b/gi, 'apologising'],
  [/\borganize\b/gi, 'organise'],
  [/\borganized\b/gi, 'organised'],
  [/\borganizing\b/gi, 'organising'],
  [/\borganization\b/gi, 'organisation'],
  [/\brealize\b/gi, 'realise'],
  [/\brealized\b/gi, 'realised'],
  [/\bfinalize\b/gi, 'finalise'],
  [/\bfinalized\b/gi, 'finalised'],
  [/\bsummarize\b/gi, 'summarise'],
  [/\bprioritize\b/gi, 'prioritise'],
  [/\bfavor\b/gi, 'favour'],
  [/\bfavors\b/gi, 'favours'],
  [/\bcolor\b/gi, 'colour'],
  [/\bcolors\b/gi, 'colours'],
  [/\bcenter\b/gi, 'centre'],
  [/\bcenters\b/gi, 'centres'],
  [/\binquiry\b/gi, 'enquiry'],
  [/\binquiries\b/gi, 'enquiries'],
  [/\bcanceled\b/gi, 'cancelled'],
  [/\bcanceling\b/gi, 'cancelling'],
  [/\btraveling\b/gi, 'travelling'],
  [/\btraveled\b/gi, 'travelled'],
  [/\bneighbor\b/gi, 'neighbour'],
  [/\bhonor\b/gi, 'honour'],
  [/\blabor\b/gi, 'labour'],
  [/\bbehavior\b/gi, 'behaviour'],
  [/\bfulfill\b/gi, 'fulfil'],
  [/\benrollment\b/gi, 'enrolment'],
  [/\bdefense\b/gi, 'defence'],
  [/\blicense\s+(?:number|plate|renewal)\b/gi, (m) => m.replace(/license/i, 'licence')],
  [/\bcheck\s+(?:in the post|by post|enclosed)\b/gi, (m) => m.replace(/check/i, 'cheque')],
  [/\bgotten\b/gi, 'received'],
];

const COMPANY_ROLE_LOCAL_RE = /^(?:info|enquiries|inquiries|support|help|hello|contact|admin|accounts|billing|sales|service|services|customer\.?service|team|office|reception|bookings|reservations|appointments|hr|legal|press|feedback)@/i;
const COMPANY_NAME_CUE_RE = /\b(ltd|limited|plc|llp|inc|corp|company|co\.|group|partners|associates|services|solutions|council|surgery|practice|clinic|hospital|bank|insurance|energy|water|telecom|broadband|support|team|office|department|hotel|airways|rail|property|estates|lettings|garage|motors)\b/i;

function matchCase(source, replacement) {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Normalizes common US English spellings to British English.
 */
export function toBritishSpelling(text = '') {
  let out = String(text || '');
  for (const [pattern, replacement] of US_TO_UK_REPLACEMENTS) {
    if (typeof replacement === 'function') {
      out = out.replace(pattern, replacement);
    } else {
      out = out.replace(pattern, (matched) => matchCase(matched, replacement));
    }
  }
  return out;
}

/**
 * Determines an appropriate British English salutation for either an individual or an organisation.
 */
export function buildSalutation(senderName = '', senderEmail = '') {
  const cleanName = String(senderName || '').replace(/["<>]/g, '').trim();
  const cleanEmail = String(senderEmail || '').trim().toLowerCase();

  // Check if clearly a company/department mailbox
  const isRoleMailbox = COMPANY_ROLE_LOCAL_RE.test(cleanEmail);
  const looksLikeCompany = COMPANY_NAME_CUE_RE.test(cleanName);

  if (isRoleMailbox || looksLikeCompany) {
    if (cleanName && !cleanName.includes('@')) {
      const cleanedOrg = cleanName.replace(/\bteam\b$/i, '').trim();
      return cleanedOrg ? `Dear ${cleanedOrg} Team,` : 'Dear Sir or Madam,';
    }
    return 'Dear Sir or Madam,';
  }

  // Handle titled names like "Dr Patel", "Dr Martin Patel", "Mr Smith", "Mrs Jones"
  const titleMatch = cleanName.match(/^(Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+(.+)$/i);
  if (titleMatch) {
    const title = titleMatch[1][0].toUpperCase() + titleMatch[1].slice(1).toLowerCase();
    const restParts = titleMatch[2].trim().split(/\s+/).filter((p) => /^[A-Za-z'-]+$/.test(p));
    const surname = restParts[restParts.length - 1];
    if (surname) {
      return `Dear ${title} ${surname},`;
    }
  }

  // Handle "Surname, Firstname" format
  if (cleanName.includes(',')) {
    const [, firstPart] = cleanName.split(',');
    const first = (firstPart || '').trim().split(/\s+/)[0];
    if (first && /^[A-Za-z'-]{2,}$/.test(first)) {
      return `Dear ${first},`;
    }
  }

  // Standard personal name "Sarah Jenkins" -> "Dear Sarah,"
  const firstToken = cleanName.split(/\s+/)[0];
  if (firstToken && /^[A-Za-z'-]{2,}$/.test(firstToken) && !firstToken.includes('@')) {
    return `Dear ${firstToken},`;
  }

  return 'Dear Sir or Madam,';
}

function polishNoteLine(rawLine) {
  let line = toBritishSpelling(rawLine)
    .replace(/^[-*•\d.)]+\s*/, '')
    .trim();
  if (!line) return '';

  // Gentle expansion of common shorthand dictated phrases into polite British prose
  line = line
    .replace(/^say\s+thanks?\s+(for\s+)?/i, 'Thank you very much for ')
    .replace(/^thank\s+them\s+(for\s+)?/i, 'Thank you very much for ')
    .replace(/^thanks?\s+for\s+/i, 'Thank you for ')
    .replace(/^tell\s+(?:them|him|her)\s+(?:that\s+)?/i, '')
    .replace(/^let\s+(?:them|him|her)\s+know\s+(?:that\s+)?/i, 'I wanted to let you know that ')
    .replace(/^ask\s+(?:them|him|her)\s+(?:if|whether)\s+/i, 'Could you please confirm whether ')
    .replace(/^ask\s+(?:them|him|her)\s+to\s+/i, 'Could you please ')
    .replace(/^ask\s+for\s+/i, 'Could you please provide ')
    .replace(/^confirm\s+that\s+/i, 'I can confirm that ')
    .replace(/^confirm\s+/i, 'I am pleased to confirm ')
    .replace(/^apologise\s+for\s+/i, 'Please accept my apologies for ')
    .replace(/^sorry\s+(?:for|about)\s+/i, 'Please accept my apologies for ')
    .replace(/^happy\s+(?:with|to)\s+/i, (m) => `I am ${m.toLowerCase()}`)
    .replace(/^free\s+/i, 'I am available ')
    .replace(/^i['’]?m\s+free\s+/i, 'I am available ')
    .replace(/^can\s+do\s+/i, 'I would be happy to do ')
    .replace(/^will\s+send\s+/i, 'I shall send ')
    .replace(/^will\s+check\s+/i, 'I shall look into ')
    .replace(/^can['’]?t\s+make\s+/i, 'Unfortunately, I am unable to make ')
    .replace(/^unable\s+to\s+/i, 'Unfortunately, I am unable to ')
    .replace(/^yes[,]?\s+/i, 'Yes, certainly — ')
    .replace(/^no[,]?\s+thanks\b/i, 'Thank you for thinking of me, though I shall pass on this occasion')
    .trim();

  // Capitalize first letter
  line = line.charAt(0).toUpperCase() + line.slice(1);

  // Ensure proper ending punctuation
  if (!/[.!?]$/.test(line)) {
    const looksLikeQuestion = /^(?:Could|Would|Can|May|Shall|Do|Does|Did|Are|Is|When|Where|What|Which|Who)\b/.test(line);
    line += looksLikeQuestion ? '?' : '.';
  }

  return line;
}

/**
 * Local deterministic plain, polite British English draft generator.
 * Works 100% offline with zero external dependencies.
 */
export function composeLocalBritishDraft({
  senderName = '',
  senderEmail = '',
  subject = '',
  notes = '',
  signOffName = 'David McAughtry',
}) {
  const trimmedNotes = String(notes || '').trim();
  if (!trimmedNotes) {
    throw new Error('Please add brief notes or dictate the essence of your reply before producing a draft.');
  }

  const salutation = buildSalutation(senderName, senderEmail);
  const rawSegments = trimmedNotes
    .split(/\r?\n+|(?<=[.!?])\s+(?=[A-Za-z0-9])|;\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const polished = rawSegments.map(polishNoteLine).filter(Boolean);

  // Add a natural polite opening if the notes don't already begin with thanks or an apology
  const firstSentence = polished[0] || '';
  const alreadyOpensPolitely = /^(?:Thank you|Many thanks|Please accept my apologies|I am sorry)/i.test(firstSentence);

  const paragraphs = [];
  if (!alreadyOpensPolitely) {
    const cleanSubject = String(subject || '').replace(/^(?:re|fwd?):\s*/i, '').trim();
    if (cleanSubject && cleanSubject.length <= 70 && cleanSubject !== '(No subject)') {
      paragraphs.push(`Thank you for your email regarding ${cleanSubject}.`);
    } else {
      paragraphs.push('Thank you for your email.');
    }
  }

  // Group polished sentences cleanly into readable paragraphs (max 2 sentences per paragraph)
  for (let i = 0; i < polished.length; i += 2) {
    paragraphs.push(polished.slice(i, i + 2).join(' '));
  }

  // Gentle closing line unless the last sentence is already a closing/question
  const lastText = paragraphs[paragraphs.length - 1] || '';
  const endsWithClosing = /(?:let me know|look forward|please do not hesitate|speak soon|grateful if|hear from you)/i.test(lastText);
  if (!endsWithClosing) {
    paragraphs.push('Please let me know if you need anything further from me.');
  }

  return `${salutation}\n\n${paragraphs.join('\n\n')}\n\nKind regards,\n${signOffName}`;
}

/**
 * Generates a British English draft reply.
 * Uses Gemini API when an optional API key is provided in Settings,
 * with automatic fallback to the local British English composer.
 */
export async function produceBritishDraft({
  senderName = '',
  senderEmail = '',
  subject = '',
  summary = '',
  notes = '',
  geminiApiKey = '',
  signOffName = 'David McAughtry',
  fetchImpl = globalThis.fetch,
}) {
  const trimmedNotes = String(notes || '').trim();
  if (!trimmedNotes) {
    throw new Error('Please enter or dictate your Essence / Notes first.');
  }

  const cleanKey = String(geminiApiKey || '').trim();
  if (!cleanKey || typeof fetchImpl !== 'function') {
    return {
      draft: composeLocalBritishDraft({ senderName, senderEmail, subject, notes: trimmedNotes, signOffName }),
      engine: 'local-british',
    };
  }

  const prompt = [
    'You are drafting an email reply on behalf of David McAughtry.',
    'Rules:',
    '- Write in plain, polite, natural British English (UK spelling and phrasing).',
    '- Address the recipient appropriately (first name for an individual, team/company greeting for an organisation).',
    '- Faithfully convey ONLY the points in David\'s notes; do not invent commitments, prices, dates, or facts.',
    '- Keep it concise, clear, and warm without sounding stiff or verbose.',
    `- Sign off with "Kind regards,\\n${signOffName}".`,
    '- Output ONLY the email body text (no subject line, no markdown fences, no commentary).',
    '',
    `Original sender: ${senderName || 'Unknown'} <${senderEmail || ''}>`,
    `Original subject: ${subject || '(No subject)'}`,
    `Email summary: ${summary || '(none)'}`,
    `David's notes: ${trimmedNotes}`,
  ].join('\n');

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(cleanKey)}`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 500,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    const generated = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();

    if (!generated) {
      throw new Error('Empty Gemini draft response');
    }

    return {
      draft: toBritishSpelling(generated),
      engine: 'gemini',
    };
  } catch (err) {
    return {
      draft: composeLocalBritishDraft({ senderName, senderEmail, subject, notes: trimmedNotes, signOffName }),
      engine: 'local-british-fallback',
      warning: err instanceof Error ? err.message : 'Gemini unavailable; used local British English composer.',
    };
  }
}
