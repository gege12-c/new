/*
 * Service worker de TriCoach : page hors connexion uniquement.
 * Aucune donnée n'est mise en cache (séances, activités, comptes) : les requêtes passent telles
 * quelles au réseau. Seule une navigation impossible faute de réseau reçoit la page /offline.html.
 */
const CACHE = "tricoach-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(async () => {
      const offline = await caches.match(OFFLINE_URL);
      return offline ?? Response.error();
    }),
  );
});
