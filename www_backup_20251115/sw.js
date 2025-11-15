const CACHE_NAME = 'verum-omnis-cache-v5.2.7';
const urlsToCache = [
  '/',
  '/index.html',
  // Key CDN assets
  'https://cdn.tailwindcss.com',
  'https://aistudiocdn.com/@google/genai@^1.29.0',
  'https://aistudiocdn.com/react@^19.2.0',
  'https://aistudiocdn.com/react-dom@^19.2.0',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/+esm',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  // Tesseract dependencies (these URLs are found from network tab during OCR)
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
  'https://tessdata.projectnaptha.com/4.0.0_best/eng.traineddata.gz'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        const promises = urlsToCache.map(url => {
            // Use no-cors for opaque resources from CDNs
            return cache.add(new Request(url, { mode: 'no-cors' })).catch(err => {
                console.warn(`Failed to cache ${url}:`, err);
            });
        });
        return Promise.all(promises);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Clone the request because it's a stream and can only be consumed once.
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(
          (response) => {
            // Don't cache failed requests or non-GET requests
            if (!response || (response.status !== 200 && response.status !== 0) || event.request.method !== 'GET') {
              return response;
            }

            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
