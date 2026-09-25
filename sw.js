// KC Besuchsprotokoll – Service Worker. Seite immer zuerst aus dem Netz, nur ohne Netz aus dem Speicher.
// VERSION muss bei jeder neuen Version mit version.json und APP_VERSION in index.html übereinstimmen.
const VERSION = "1.1.0";
const CACHE = "kc-besuche-" + VERSION;
const DATEIEN = ["./", "index.html", "manifest.webmanifest", "kc-kochmuetze-weiss.webp", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kc-besuche-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "jetzt-aktivieren") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Datenbank-Anfragen und version.json nie aus dem Speicher
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith("version.json")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const kopie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopie)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
