const iconUrl = new URL("../assets/switzerland-weather-logo.png", import.meta.url).href;

const state = {
  completed: false,
  initialized: false,
  messageElement: null,
  progressElement: null,
  screenElement: null,
};

function createLoadingPage() {
  if (state.initialized || !document.body) {
    return;
  }

  state.initialized = true;
  document.body.classList.add("app-booting");

  const screen = document.createElement("div");
  screen.className = "boot-screen";
  screen.id = "boot-screen";
  screen.role = "status";
  screen.ariaLive = "polite";
  screen.setAttribute("aria-label", "Preparing MeteoSwiss forecast map");
  screen.innerHTML = `
    <div class="boot-card">
      <img class="boot-logo" src="${iconUrl}" alt="" loading="eager" decoding="async" />
      <div class="boot-title">ArcGIS ParquetLayer: MeteoSwiss Forecasts</div>
      <div class="boot-subtitle" id="boot-subtitle">Preparing MeteoSwiss forecast map...</div>
      <div class="boot-progress" id="boot-progress" aria-hidden="true"></div>
    </div>
  `;

  document.body.prepend(screen);

  state.screenElement = screen;
  state.messageElement = screen.querySelector("#boot-subtitle");
  state.progressElement = screen.querySelector("#boot-progress");
}

function whenBodyReady(callback) {
  if (document.body) {
    callback();
    return;
  }

  window.addEventListener("DOMContentLoaded", callback, { once: true });
}

function ensureLoadingPage() {
  whenBodyReady(createLoadingPage);
}

export function setLoadingPageStatus(message, progress = "68%") {
  if (state.completed) {
    return;
  }

  ensureLoadingPage();

  if (state.messageElement) {
    state.messageElement.textContent = message;
  }

  state.progressElement?.style.setProperty("--boot-progress", progress);
}

export function completeLoadingPage(message = "Forecast map ready.") {
  if (state.completed) {
    return;
  }

  setLoadingPageStatus(message, "100%");
  state.completed = true;

  window.setTimeout(() => {
    document.body?.classList.remove("app-booting");
    state.screenElement?.setAttribute("aria-hidden", "true");
  }, 120);

  window.setTimeout(() => {
    state.screenElement?.remove();
    state.screenElement = null;
  }, 480);
}

export function failLoadingPage(message = "Forecast layer failed to load") {
  if (state.completed) {
    return;
  }

  ensureLoadingPage();
  state.screenElement?.classList.add("boot-screen--error");
  completeLoadingPage(message);
}

ensureLoadingPage();
