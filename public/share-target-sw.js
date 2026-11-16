/*
 * Web Share Target for the installed PWA (imported into the Workbox service worker via importScripts).
 * The OS share sheet POSTs multipart/form-data to ./share-target (see the manifest in vite.config.ts).
 * We store the files in a Cache and redirect to ./?share-target, where src/platform/webLaunch.ts
 * reads them and hands them to the import queue. Shared plain text (no file) becomes a .txt file.
 * Names here must match src/platform/webLaunch.ts.
 */
/* eslint-disable no-restricted-globals */
const SHARE_CACHE = 'tempo-share-target';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      const base = new URL('./', self.registration.scope);
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const files = form.getAll('files').filter((f) => f && typeof f === 'object' && 'size' in f);
        let i = 0;
        const stamp = Date.now();
        for (const file of files) {
          await cache.put(
            new Request(new URL(`share-target/${stamp}-${i++}`, base).href),
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name || 'Shared file'),
              },
            }),
          );
        }
        if (!files.length) {
          const title = String(form.get('title') || '').trim();
          const text = [form.get('text'), form.get('url')].filter(Boolean).join('\n\n').trim();
          if (text) {
            const name = `${(title || 'Shared text').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.txt`;
            await cache.put(
              new Request(new URL(`share-target/${stamp}-text`, base).href),
              new Response(new Blob([text], { type: 'text/plain' }), {
                headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent(name) },
              }),
            );
          }
        }
      } catch (e) {
        // fall through to the app; nothing to import
      }
      return Response.redirect(new URL('./?share-target#/', base).href, 303);
    })(),
  );
});
