// Minimal service worker so the app installs to the home screen. Network-first; nothing cached long-term.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {});
