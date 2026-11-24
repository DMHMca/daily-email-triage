/**
 * Service Worker for Daily Email Triage & Draft Workspace
 * Caches static PWA shell files ONLY (never caches Gmail API responses or OAuth tokens).
 */

const CACHE_NAME = 'email-triage-shell-v1';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/safety.js',
  './js/triage-engine.js',
  './js/british-drafter.js',
  './js/demo-data.js',
  './js/gmail-client.js',
  './js/storage.js',
  './js/speech.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept Google OAuth, Gmail API, or Gemini API traffic
  if (url.origin !== self.location.origin) {
    return;
  }

  // Network-first for HTML & JS so deployments propagate immediately, with offline fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
