// Offline support: always try the network first (so updates show up right away),
// and fall back to the last copy we saw when there's no connection.
// The live game (site root) and the dev build (/dev/) each run their own copy of this file
// with their own cache, and never touch each other's files or caches.
const BASE = new URL('./', self.location).pathname;
const DEV = BASE.endsWith('/dev/');
const CACHE = DEV ? 'kingdom-dev-v1' : 'kingdom-v1';
const OURS = (k) => (DEV ? k.startsWith('kingdom-dev-') : k.startsWith('kingdom-') && !k.startsWith('kingdom-dev-'));

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => OURS(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // The live worker leaves the dev build alone
  if (!DEV && url.pathname.startsWith(BASE + 'dev/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .open(CACHE)
          .then((c) => c.match(req).then((hit) => hit || (req.mode === 'navigate' ? c.match('./') : undefined)))
          .then((hit) => hit || Response.error()),
      ),
  );
});
