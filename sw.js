// Offline-Speicher: Seite kommt sofort aus dem Speicher, neue Version wird im Hintergrund geholt und gilt beim nächsten Öffnen.
// Bei jeder Änderung an den Dateien STAND erhöhen (macht hochladen.sh von selbst).
const STAND = "dev";
const SPEICHER = "spl-" + STAND;
const DATEIEN = ["./", "index.html", "app.js", "texte.js", "stream.css", "spl.css", "manifest.webmanifest",
  "schrift/atkinson-next-latin.woff2", "schrift/atkinson-next-latin-ext.woff2",
  "bilder/icon-32.png", "bilder/icon-192.png", "bilder/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SPEICHER).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== SPEICHER).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(SPEICHER).then((c) => c.match(e.request, { ignoreSearch: true }).then((alt) => {
    const neu = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => alt);
    return alt || neu;
  })));
});
