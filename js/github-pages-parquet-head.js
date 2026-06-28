const controllerWaitMs = 3000;

// GitHub Pages can report compressed metadata for Parquet HEAD requests.
// The service worker below normalizes only those HEAD responses before the
// ArcGIS ParquetLayer starts reading byte ranges.
function waitForServiceWorkerController(timeoutMs = controllerWaitMs) {
  if (navigator.serviceWorker.controller) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let isDone = false;
    const finish = (isControlled) => {
      if (isDone) {
        return;
      }

      isDone = true;
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      resolve(isControlled);
    };

    const handleControllerChange = () => {
      finish(Boolean(navigator.serviceWorker.controller));
    };

    const timeoutId = window.setTimeout(() => {
      finish(Boolean(navigator.serviceWorker.controller));
    }, timeoutMs);

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
  });
}

async function registerParquetHeadWorker({ waitForUpdate = false } = {}) {
  const registration = await navigator.serviceWorker.register("./github-pages-parquet-head-worker.js", {
    updateViaCache: "none",
  });

  const updateReady = registration.update().catch(() => undefined);

  if (waitForUpdate) {
    await updateReady;
  }

  return registration;
}

function requestClientClaim(registration) {
  registration.active?.postMessage({ type: "claim-clients" });
}

export async function prepareGitHubPagesParquetHead() {
  if (!("serviceWorker" in navigator) || !window.location.hostname.endsWith("github.io")) {
    return;
  }

  if (navigator.serviceWorker.controller) {
    registerParquetHeadWorker().catch(() => undefined);
    return;
  }

  await registerParquetHeadWorker({ waitForUpdate: true });
  const registration = await navigator.serviceWorker.ready;

  if (navigator.serviceWorker.controller) {
    return;
  }

  const controllerReady = waitForServiceWorkerController();
  requestClientClaim(registration);
  const isControlled = await controllerReady;

  if (isControlled) {
    return;
  }

  throw new Error("GitHub Pages Parquet helper is not controlling this page yet.");
}
