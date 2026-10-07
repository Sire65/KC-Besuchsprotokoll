// KC Besuchsprotokoll – stillgelegt (KC-TERMINE-UMZUG, 1.4.0). Alles ist jetzt in der Köcheclub-App.
// Dieser Helfer räumt nur noch auf: alten Speicher löschen und sich abmelden – danach kommt jede Seite direkt aus dem Netz.
const VERSION = "1.4.0";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("kc-besuche-")).map((k) => caches.delete(k))))
    .then(() => self.registration.unregister()).then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate(c.url).catch(() => {}))));
});
