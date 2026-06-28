const parquetSuffix = ".parquet";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "claim-clients") {
    event.waitUntil(self.clients.claim());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "HEAD" || url.origin !== self.location.origin || !url.pathname.endsWith(parquetSuffix)) {
    return;
  }

  event.respondWith(headFromRange(url));
});

async function headFromRange(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Range: "bytes=0-0" },
    });
    const contentRange = response.headers.get("Content-Range");
    const totalBytes = contentRange?.match(/\/(\d+)$/)?.[1];

    if (!totalBytes) {
      continue;
    }

    // Use Content-Range from a one-byte raw request as the authoritative file
    // size. Normal GitHub Pages HEAD responses can describe a compressed body.
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": totalBytes,
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
    });
    const etag = response.headers.get("ETag");
    const lastModified = response.headers.get("Last-Modified");

    if (etag) {
      headers.set("ETag", etag);
    }

    if (lastModified) {
      headers.set("Last-Modified", lastModified);
    }

    return new Response(null, { headers });
  }

  return new Response(null, {
    status: 502,
    statusText: "Parquet HEAD range probe failed",
    headers: { "Cache-Control": "no-store" },
  });
}
