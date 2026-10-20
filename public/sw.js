// Ringtools service worker
//
// Caching is bewust zeer terughoudend: alleen statische, niet-gevoelige
// bestanden (iconen, gebouwde CSS/JS-bundels, het manifest, de offline-
// pagina) mogen in de Cache Storage terechtkomen. Alle API-aanroepen,
// paginadata, server actions en RSC-payloads gaan altijd rechtstreeks over
// het netwerk, zodat er nooit vertrouwelijke gegevens (stemmen, roepingen,
// persoonsgegevens) offline bewaard worden.

const CACHE_NAME = "ringtools-static-v1";
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isSafeToCacheStatic(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === OFFLINE_URL
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // server actions/POST: nooit onderscheppen

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigatie (het openen van een pagina): altijd verse data van het
  // netwerk; alleen bij een netwerkstoring de offline-pagina tonen. Nooit de
  // laatst bekeken pagina (met mogelijk vertrouwelijke inhoud) hergebruiken.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  if (isSafeToCacheStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Alle overige requests (API's, RSC-data, afbeeldingen van gebruikersdata
  // enz.): gewoon naar het netwerk, nooit cachen.
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Ringtools", body: event.data.text() };
  }

  const title = payload.title || "Ringtools";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/dashboard" },
    tag: payload.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Bepaalt veilig waar een melding naartoe leidt: uitsluitend een pad op deze site.
// Alles wat naar een andere herkomst wijst (of niet te lezen is) valt terug op het dashboard.
function resolveNotificationTarget(raw) {
  try {
    if (typeof raw !== "string" || !raw.startsWith("/")) return "/dashboard";
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) return "/dashboard";
    if (url.pathname.includes("\\")) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/dashboard";
  }
}

// Klik op een melding: focus een al geopende Ringtools-window (de geïnstalleerde app of
// een browsertab) en navigeer daar naar het voorstel; is er geen window (app gesloten),
// open er dan een. De bestemming is alleen een intern pad: toegang en ringrechten worden
// bij het openen van de pagina op de server gecontroleerd, niet hier.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = resolveNotificationTarget(event.notification.data && event.notification.data.url);
  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const candidate =
        windows.find((c) => c.focused) || windows.find((c) => c.visibilityState === "visible") || windows[0];

      if (candidate) {
        try {
          const focused = (await candidate.focus()) || candidate;
          if (typeof focused.navigate === "function") {
            await focused.navigate(absolute);
            return;
          }
        } catch {
          // navigeren/focussen niet ondersteund of mislukt: val terug op een nieuw window
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(absolute);
      }
    })()
  );
});
