/**
 * One-Time Lenovo Server OAuth Setup Helper (Strictly Draft-Only Scopes)
 *
 * Authorizes the local Lenovo 06:30 Windows Scheduled Task with ONLY:
 *  - https://www.googleapis.com/auth/gmail.readonly
 *  - https://www.googleapis.com/auth/gmail.compose
 *
 * Saves refresh token locally to secrets/lenovo-oauth.json (gitignored).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { GMAIL_SCOPE_STRING, assertSafeScopeString } from '../docs/js/safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SECRETS_DIR = path.join(ROOT_DIR, 'secrets');
const SECRETS_PATH = path.join(SECRETS_DIR, 'lenovo-oauth.json');
const PORT = 8789;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

async function main() {
  assertSafeScopeString(GMAIL_SCOPE_STRING);

  const rl = readline.createInterface({ input, output });
  console.log('\n=== Daily Email Triage — Lenovo Morning Sync OAuth Setup ===');
  console.log('Strict Draft-Only Scopes:', GMAIL_SCOPE_STRING);
  console.log(`Make sure "${REDIRECT_URI}" is added as an Authorised redirect URI (or use a Desktop App OAuth Client).\n`);

  const clientId = (await rl.question('Google OAuth Client ID: ')).trim();
  const clientSecret = (await rl.question('Google OAuth Client Secret: ')).trim();
  rl.close();

  if (!clientId || !clientSecret) {
    throw new Error('Both Client ID and Client Secret are required.');
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_SCOPE_STRING);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\nOpen this URL in Chrome on your Lenovo PC to grant Read-Only + Drafts-Only access:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting for callback on ${REDIRECT_URI} ...`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
      if (reqUrl.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const err = reqUrl.searchParams.get('error');
      const authCode = reqUrl.searchParams.get('code');
      if (err || !authCode) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Authorisation cancelled or failed.</h2><p>You may close this tab.</p>');
        server.close();
        reject(new Error(err || 'Missing authorization code'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Draft-Only Gmail Authorisation Complete</h2><p>You may close this tab and return to the terminal.</p>');
      server.close();
      resolve(authCode);
    });
    server.listen(PORT, '127.0.0.1');
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.refresh_token) {
    throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error || 'No refresh_token returned'}`);
  }

  if (tokenData.scope) {
    assertSafeScopeString(tokenData.scope);
  }

  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(
    SECRETS_PATH,
    JSON.stringify(
      {
        clientId,
        clientSecret,
        refreshToken: tokenData.refresh_token,
        scopes: GMAIL_SCOPE_STRING,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\nSaved Lenovo morning-sync credentials safely to ${SECRETS_PATH} (gitignored).`);
  console.log('Test now with: npm.cmd run sync:morning\n');
}

main().catch((err) => {
  console.error('Setup failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
