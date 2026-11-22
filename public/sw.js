// Service worker de DELTA: deja la app instalable, funciona sin conexión básica y muestra avisos.
const CACHE = "delta-v20";
const ARCHIVOS = ["/", "/index.html", "/estilos.css", "/app.js", "/tableros.js", "/sonidos.js", "/manifest.webmanifest", "/icons/logo.svg", "/icons/icono-192.png", "/icons/icono-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/webhook")) return;
  // Primero la red (para tener siempre la última versión); si no hay conexión, la copia guardada.
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { cuerpo: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "DELTA", {
    body: d.cuerpo || "",
    icon: "/icons/icono-192.png",
    badge: "/icons/icono-192.png",
    vibrate: [120, 60, 120],
    tag: "delta-" + Date.now(),
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((ws) => (ws[0] ? ws[0].focus() : self.clients.openWindow("/"))));
});
