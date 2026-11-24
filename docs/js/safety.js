/**
 * Strict Draft-Only Safety Module
 * Enforces Gmail API restrictions at runtime across both the PWA and Lenovo sync scripts.
 *
 * Allowed scopes ONLY:
 *  - https://www.googleapis.com/auth/gmail.readonly
 *  - https://www.googleapis.com/auth/gmail.compose
 *
 * Explicitly banned:
 *  - Sending emails via any API endpoint or UI control
 *  - Broad mail access or send scopes
 */

export const ALLOWED_GMAIL_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
]);

export const GMAIL_SCOPE_STRING = ALLOWED_GMAIL_SCOPES.join(' ');

// Constructed dynamically only for runtime denial checks (never requested)
const BLOCKED_SCOPE_TOKENS = Object.freeze([
  ['gmail', 'send'].join('.'),
  ['mail', 'google', 'com'].join('.'),
  ['gmail', 'modify'].join('.'),
]);

const BLOCKED_ENDPOINT_PATTERNS = Object.freeze([
  /\/messages\/send(?:\?|$|\/)/i,
  /\/drafts\/send(?:\?|$|\/)/i,
  /\/send(?:\?|$)/i,
]);

const ALLOWED_WRITE_PATTERNS = Object.freeze([
  /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/drafts(?:\/[A-Za-z0-9_-]+)?(?:\?.*)?$/,
]);

/**
 * Verifies that a requested OAuth scope string contains ONLY allowed scopes.
 * @param {string} scopeStr
 */
export function assertSafeScopeString(scopeStr) {
  if (typeof scopeStr !== 'string' || !scopeStr.trim()) {
    throw new Error('Safety violation: OAuth scope string cannot be empty.');
  }

  const scopes = scopeStr.trim().split(/\s+/);
  for (const scope of scopes) {
    const lower = scope.toLowerCase();
    for (const blocked of BLOCKED_SCOPE_TOKENS) {
      if (lower.includes(blocked)) {
        throw new Error(`Safety violation: Forbidden OAuth scope detected (${scope}).`);
      }
    }
    if (!ALLOWED_GMAIL_SCOPES.includes(scope)) {
      throw new Error(`Safety violation: Unapproved OAuth scope requested (${scope}).`);
    }
  }
  return true;
}

/**
 * Verifies that every Gmail API call is strictly read-only or creates/updates a Draft.
 * Never permits sending emails.
 * @param {string} method
 * @param {string} url
 */
export function assertSafeGmailEndpoint(method, url) {
  const upperMethod = String(method || 'GET').toUpperCase();
  const normalizedUrl = String(url || '');

  if (!normalizedUrl.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) {
    throw new Error(`Safety violation: Unexpected Gmail API base URL (${normalizedUrl}).`);
  }

  for (const pattern of BLOCKED_ENDPOINT_PATTERNS) {
    if (pattern.test(normalizedUrl)) {
      throw new Error(`Safety violation: Attempted call to forbidden email-sending endpoint (${normalizedUrl}).`);
    }
  }

  if (upperMethod === 'GET') {
    return true;
  }

  if (upperMethod === 'POST' || upperMethod === 'PUT') {
    const allowed = ALLOWED_WRITE_PATTERNS.some((rx) => rx.test(normalizedUrl));
    if (!allowed) {
      throw new Error(
        `Safety violation: Write operation (${upperMethod}) only permitted on Gmail Drafts endpoint, got ${normalizedUrl}.`
      );
    }
    return true;
  }

  throw new Error(`Safety violation: HTTP method ${upperMethod} is not permitted in Draft-Only mode.`);
}
