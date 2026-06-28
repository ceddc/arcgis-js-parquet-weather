// Advanced UI helpers for the demo.
//
// This file was produced with AI assistance after the core sample was kept small.
// It exists to make the public page feel nicer without turning js/app.js into a
// long UI project. Treat js/app.js as the reusable ArcGIS ParquetLayer sample;
// treat this file as demo glue, not as a complete production architecture.
//
// Reading guide:
// 1. Renderer and legend helpers
// 2. Code dialog
// 3. Feature-count panel
// 4. Feature labels and info-card layout
// 5. Popup mode helpers
// 6. Time slider helpers
// 7. Hover and sticky-card interaction
// 8. Mobile panel behavior
// 9. Calcite control wiring
let centroidOperator = null;
let reactiveUtils = null;

// app.js imports ArcGIS modules and passes the few operators/utilities this file needs.
// That keeps this helper file focused on UI behavior.
export function setArcgisGeometryOperators(operators) {
  centroidOperator = operators.centroidOperator;
}

export function setArcgisReactiveUtils(utils) {
  reactiveUtils = utils;
}

// 1. Renderer and legend helpers.
//
// These functions translate the selected MeteoSwiss field into ArcGIS renderer
// visual variables. The color ramps are intentionally kept close to the source
// weather palette, then sampled down because MapView simplifies long stop lists.
const fieldKinds = {
  fu3010h0: "wind",
  nprohihs: "cloud",
  nprolohs: "cloud",
  npromths: "cloud",
  rp0003i0: "precipitation-probability",
  rre150h0: "precipitation-amount",
  tre200h0: "temperature",
};

const hitAreaAttribute = "data-forecast-hit-area-installed";
const hitAreaBufferPx = 18;
const forecastLocale = "fr-CH";
const forecastTimeZone = "Europe/Zurich";
const surfaceColorAlpha = 0.78;
const pointColorAlpha = 0.8;
// MapView displays up to eight color visual-variable stops before simplifying the renderer.
const maxMapViewColorStops = 8;

const cloudStyles = {
  nprolohs: {
    stops: [
      { value: 0, color: "#F4F8FF", alpha: 0, label: "0%" },
      { value: 50, color: "#A7BFE5", alpha: 0.6, label: "50%" },
      { value: 100, color: "#3F6FAB", alpha: 1, label: "100%" },
    ],
  },
  npromths: {
    stops: [
      { value: 0, color: "#F7F9FC", alpha: 0, label: "0%" },
      { value: 50, color: "#B9C4D4", alpha: 0.6, label: "50%" },
      { value: 100, color: "#6E829F", alpha: 1, label: "100%" },
    ],
  },
  nprohihs: {
    stops: [
      { value: 0, color: "#FAFCFF", alpha: 0, label: "0%" },
      { value: 50, color: "#DCEAFF", alpha: 0.6, label: "50%" },
      { value: 100, color: "#BFD8F2", alpha: 1, label: "100%" },
    ],
  },
};

const officialColorStops = {
  tre200h0: [
    { value: -4, color: "#94BDF0", label: "-4 °C" },
    { value: -2, color: "#73A6EB", label: "-2 °C" },
    { value: 0, color: "#DEE699", label: "0 °C" },
    { value: 2, color: "#A6D473", label: "2 °C" },
    { value: 4, color: "#6BBF4D", label: "4 °C" },
    { value: 6, color: "#33AB26", label: "6 °C" },
    { value: 8, color: "#009900", label: "8 °C" },
    { value: 10, color: "#33B300", label: "10 °C" },
    { value: 12, color: "#66CC00", label: "12 °C" },
    { value: 14, color: "#99E600", label: "14 °C" },
    { value: 16, color: "#CCFF00", label: "16 °C" },
    { value: 18, color: "#FFFF00", label: "18 °C" },
    { value: 20, color: "#FFCC00", label: "20 °C" },
    { value: 22, color: "#FF9900", label: "22 °C" },
    { value: 24, color: "#FF6600", label: "24 °C" },
    { value: 26, color: "#FF3300", label: "26 °C" },
    { value: 28, color: "#FF0000", label: "28 °C" },
    { value: 30, color: "#FF00FF", label: "30 °C" },
    { value: 32, color: "#FF40FF", label: "32 °C" },
    { value: 34, color: "#FF80FF", label: "34 °C" },
    { value: 36, color: "#FFBFFF", label: "36 °C" },
    { value: 38, color: "#FFFFFF", label: "38 °C" },
    { value: 40, color: "#FFFFFF", label: "40 °C" },
  ],
  rp0003i0: [
    { value: 0, color: "#FFFFFF", alpha: 0.1, label: "0%" },
    { value: 10, color: "#DDF8DE", alpha: 0.28, label: "10%" },
    { value: 20, color: "#A7E4B4", alpha: 0.45, label: "20%" },
    { value: 40, color: "#55BFA8", alpha: 0.66, label: "40%" },
    { value: 60, color: "#2386B8", alpha: 0.82, label: "60%" },
    { value: 80, color: "#075A9B", alpha: 0.94, label: "80%" },
    { value: 90, color: "#023858", alpha: 1, label: "90%" },
    { value: 100, color: "#011F33", alpha: 1, label: "100%" },
  ],
  rre150h0: [
    { value: 0, color: "#9A7E95", label: "0 mm" },
    { value: 1, color: "#0001FC", label: "1 mm" },
    { value: 2, color: "#058C2D", label: "2 mm" },
    { value: 4, color: "#05FF05", label: "4 mm" },
    { value: 6, color: "#FEFF01", label: "6 mm" },
    { value: 10, color: "#FFC703", label: "10 mm" },
    { value: 20, color: "#FF7D01", label: "20 mm" },
    { value: 40, color: "#FF1900", label: "40 mm" },
    { value: 60, color: "#AF00DD", label: "60 mm" },
  ],
  fu3010h0: [
    { value: 0, color: "#CCCCCC", label: "0 km/h" },
    { value: 12, color: "#59CC00", label: "12 km/h" },
    { value: 24, color: "#90CC00", label: "24 km/h" },
    { value: 36, color: "#C7CC00", label: "36 km/h" },
    { value: 48, color: "#CC9A00", label: "48 km/h" },
    { value: 60, color: "#CC2C00", label: "60 km/h" },
    { value: 72, color: "#CC000C", label: "72 km/h" },
    { value: 84, color: "#CC0043", label: "84 km/h" },
  ],
};

// Minimal code shown in the Code dialog. It intentionally excludes the custom UI helpers.
// This is the part a reader should copy first if they only want ParquetLayer loading.
const parquetLoadSnippet = `import "https://js.arcgis.com/5.1/";

const [Map, ParquetLayer, GeometryEncodingWkb, ParquetFilesData] = await $arcgis.import([
  "@arcgis/core/Map.js",
  "@arcgis/core/layers/ParquetLayer.js",
  "@arcgis/core/layers/support/GeometryEncodingWkb.js",
  "@arcgis/core/layers/support/ParquetFilesData.js",
]);

const mapElement = document.querySelector("arcgis-map");
const parquetFileUrl = new URL(
  "./data/meteoswiss_surface-hex-128x72_all-points_48h.parquet",
  window.location.href,
).href;

const layer = new ParquetLayer({
  title: "MeteoSwiss temperature forecast",
  copyright: "Source: MeteoSwiss; © Data: swisstopo",
  data: new ParquetFilesData({
    urls: [parquetFileUrl],
  }),
  geometryEncoding: new GeometryEncodingWkb({
    field: "geometry",
    orientation: "counter-clockwise",
  }),
  geometryType: "polygon",
  spatialReference: { wkid: 4326 },
  outFields: ["*"],
});

const timeInfoUrl = parquetFileUrl.replace(".parquet", ".arcgis-timeinfo.json");
const { timeInfo } = await fetch(timeInfoUrl).then((response) => response.json());
const forecastTimeUtc = new Date(timeInfo.epochSeconds[0] * 1000)
  .toISOString()
  .replace(".000Z", "Z");
layer.definitionExpression = "valid_time = '" + forecastTimeUtc + "'";

mapElement.map = new Map({
  basemap: "gray-vector",
  layers: [layer],
});`;

export function formatSwissForecastHour(epochSeconds) {
  return new Intl.DateTimeFormat(forecastLocale, {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: forecastTimeZone,
    year: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

function hexToRgba(hex, alpha) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);

  if (!match) {
    return hex;
  }

  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
    alpha,
  ];
}

function sampleColorStopsForMapView(stops) {
  if (stops.length <= maxMapViewColorStops) {
    return stops;
  }

  const lastIndex = stops.length - 1;
  const selectedIndexes = new Set([0, lastIndex]);

  for (let step = 1; step < maxMapViewColorStops - 1; step += 1) {
    selectedIndexes.add(Math.round((step * lastIndex) / (maxMapViewColorStops - 1)));
  }

  return [...selectedIndexes].sort((a, b) => a - b).map((index) => stops[index]);
}

function colorStopsWithAlpha(stops, geometryType) {
  const alpha = geometryType === "point" ? pointColorAlpha : surfaceColorAlpha;
  return sampleColorStopsForMapView(stops).map((stop) => {
    const { alpha: stopAlpha, ...colorStop } = stop;

    return {
      ...colorStop,
      color: hexToRgba(colorStop.color, stopAlpha ?? alpha),
    };
  });
}

function cloudColorStopsFor(fieldName, geometryType) {
  const style = cloudStyles[fieldName] ?? cloudStyles.nprolohs;
  return colorStopsWithAlpha(style.stops, geometryType);
}

function colorStopsFor(fieldName, geometryType = "polygon") {
  if (fieldKinds[fieldName] === "cloud") {
    return cloudColorStopsFor(fieldName, geometryType);
  }

  return colorStopsWithAlpha(officialColorStops[fieldName] ?? officialColorStops.fu3010h0, geometryType);
}

function opacityStopsFor(fieldName) {
  const kind = fieldKinds[fieldName];

  if (kind === "precipitation-amount") {
    return [
      { value: 0, opacity: 0, label: "0" },
      { value: 0.1, opacity: 0.44, label: "0.1" },
      { value: 1, opacity: 0.64, label: "1" },
      { value: 60, opacity: 0.84, label: "60" },
    ];
  }

  return [];
}

export function rendererForField(fieldName, geometryType = "polygon", legendTitle = fieldName) {
  const symbol =
    geometryType === "point"
      ? {
          type: "simple-marker",
          color: "#2f6f95",
          outline: {
            color: [255, 255, 255, 0.85],
            width: 0.8,
          },
          size: 7,
          style: "circle",
        }
      : {
          type: "simple-fill",
          color: "#2f6f95",
          outline: {
            color: [255, 255, 255, 0],
            width: 0,
          },
        };

  return {
    type: "simple",
    symbol,
    visualVariables: [
      {
        type: "color",
        field: fieldName,
        legendOptions: { title: legendTitle },
        stops: colorStopsFor(fieldName, geometryType),
      },
      ...opacityStopsFor(fieldName).map((stops) => ({
        type: "opacity",
        field: fieldName,
        stops,
        legendOptions: { showLegend: false },
      })),
    ],
  };
}

// The ArcGIS legend is a web component with nested shadow roots. The helper
// below reaches into those roots only to keep this narrow side panel readable:
// show the color ramp and hide duplicate opacity entries.
let legendCleanupRun = 0;

function installLegendFitStyle(root) {
  if (!root || root.querySelector("#forecast-legend-fit")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "forecast-legend-fit";
  style.textContent = `
    .layer-row {
      min-height: 5.9rem;
      overflow: visible;
    }

    .layer-cell-symbols,
    .layer-cell-info {
      overflow: visible;
      padding-block: 0.2rem;
    }

    .layer-cell-info {
      min-width: 3.25rem;
    }

    .ramps,
    .color-ramp,
    .color-ramp canvas,
    .ramp-labels {
      height: 5.6rem !important;
    }

    .ramp-labels {
      min-width: 3.15rem;
      overflow: visible;
    }

    .ramp-label {
      box-sizing: border-box;
      min-width: 3rem;
      padding-inline: 0.2rem;
      line-height: 1;
    }

    .ramp-label:first-child {
      margin-block-start: 0 !important;
    }
  `;
  root.append(style);
}

function fitColorRampLegendText(root) {
  installLegendFitStyle(root);

  for (const colorRamp of root?.querySelectorAll("arcgis-legend-classic-color-ramp") ?? []) {
    installLegendFitStyle(colorRamp.shadowRoot);
  }
}

function shadowQueryAll(host, selector, results = []) {
  const root = host?.shadowRoot;

  if (!root) {
    return results;
  }

  results.push(...root.querySelectorAll(selector));

  for (const child of root.querySelectorAll("*")) {
    shadowQueryAll(child, selector, results);
  }

  return results;
}

function applyColorRampLegendOnly() {
  const legendElements = shadowQueryAll(document.querySelector("#map-legend"), "arcgis-legend-classic-element");

  if (legendElements.length === 0) {
    return false;
  }

  let foundColorRamp = false;

  for (const element of legendElements) {
    const root = element.shadowRoot;
    const hasColorRamp = Boolean(root?.querySelector("arcgis-legend-classic-color-ramp"));

    element.hidden = !hasColorRamp;

    if (!hasColorRamp) {
      element.style.display = "none";
      continue;
    }

    element.style.removeProperty("display");

    foundColorRamp = true;

    const caption = root.querySelector(".layer-caption");

    if (caption) {
      caption.hidden = true;
      caption.style.display = "none";
    }

    fitColorRampLegendText(root);
  }

  return foundColorRamp;
}

// ArcGIS legend also emits opacity visual variables; the panel keeps only the color ramp.
function scheduleColorRampLegendOnly() {
  const runId = ++legendCleanupRun;
  let attempts = 0;

  const retry = () => {
    if (runId !== legendCleanupRun) {
      return;
    }

    applyColorRampLegendOnly();
    attempts += 1;

    if (attempts < 100) {
      window.setTimeout(retry, 100);
    }
  };

  window.requestAnimationFrame(retry);
}
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightJavaScript(code) {
  const tokenPattern = /(\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|const|let|new|return|async|await|function|if|else|true|false|null)\b|\b(\d+(?:\.\d+)?)\b/g;
  let output = "";
  let cursor = 0;

  for (const match of code.matchAll(tokenPattern)) {
    output += escapeHtml(code.slice(cursor, match.index));

    const className = match[1]
      ? "comment"
      : match[2]
        ? "string"
        : match[3]
          ? "keyword"
          : "number";

    output += `<span class="token-${className}">${escapeHtml(match[0])}</span>`;
    cursor = match.index + match[0].length;
  }

  output += escapeHtml(code.slice(cursor));
  return output;
}

// 2. Code dialog.
function setupCodePanel() {
  const codeButton = document.querySelector("#code-button");
  const codeDialog = document.querySelector("#code-dialog");
  const codeBlock = document.querySelector("#parquet-code");

  codeBlock.innerHTML = highlightJavaScript(parquetLoadSnippet);
  codeButton.addEventListener("click", () => {
    codeDialog.open = true;
  });
}

// 3. Feature-count panel.
const countFormatter = new Intl.NumberFormat("en-US");

function metadataNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatCount(value) {
  const numberValue = metadataNumber(value);
  return numberValue === null ? "..." : countFormatter.format(numberValue);
}

function formatMegabytes(value) {
  const numberValue = metadataNumber(value);
  return numberValue === null ? null : `${(numberValue / 1_000_000).toFixed(1)} MB`;
}

function totalFeatureCount(state) {
  return metadataNumber(state.sidecar?.feature_count);
}

function visibleFeatureCount(state) {
  const perTimeStep = metadataNumber(state.sidecar?.features_per_time_step);

  if (perTimeStep !== null) {
    return perTimeStep;
  }

  const total = totalFeatureCount(state);
  const timeStepCount = Array.isArray(state.sidecar?.timeInfo?.epochSeconds)
    ? state.sidecar.timeInfo.epochSeconds.length
    : 0;

  return total !== null && timeStepCount > 0 ? Math.round(total / timeStepCount) : null;
}

function setupParquetStatsPanel(state) {
  const panel = document.querySelector("#parquet-stats");
  const countsElement = document.querySelector("#feature-counts");

  function refresh() {
    if (!panel || !countsElement) {
      return;
    }

    if (!state.layer || !state.sidecar) {
      panel.hidden = true;
      return;
    }

    const visible = visibleFeatureCount(state);
    const total = totalFeatureCount(state);
    const sizeText = formatMegabytes(state.parquetBytes);
    const countsText = [
      `${formatCount(visible)} visible / ${formatCount(total)} total`,
      sizeText,
    ].filter(Boolean).join(" · ");

    countsElement.textContent = countsText;
    panel.setAttribute("aria-label", countsText);
    panel.hidden = false;
  }

  refresh();

  return { refresh };
}

// 4. Feature labels and info-card layout.
function formatMeasurementNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fahrenheitFromCelsius(value) {
  return (value * 9) / 5 + 32;
}

function secondaryTemperatureText(fieldName, value) {
  if (fieldName !== "tre200h0") {
    return "";
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${formatMeasurementNumber(fahrenheitFromCelsius(parsed))} °F` : "";
}

function formatValue(value, unit) {
  if (value == null || value === "") {
    return "No value";
  }

  const parsed = Number(value);

  if (Number.isFinite(parsed)) {
    return `${formatMeasurementNumber(parsed)} ${unit}`.trim();
  }

  return String(value);
}

function formatValueHtml(fieldName, value, unit) {
  const primaryValue = escapeHtml(formatValue(value, unit));
  const secondaryValue = secondaryTemperatureText(fieldName, value);

  if (!secondaryValue) {
    return primaryValue;
  }

  return `${primaryValue}<span class="temperature-secondary-value"> - ${escapeHtml(secondaryValue)}</span>`;
}

function hasForecastValue(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === "string" && value.trim() === "") {
    return false;
  }

  return Number.isFinite(Number(value));
}

function hasSelectedForecastValue(graphic, state) {
  return hasForecastValue(graphic?.attributes?.[state.selectedField]);
}

function splitPlaceNames(value) {
  if (typeof value !== "string") {
    return [];
  }

  const names = [];
  const seen = new Set();

  for (const part of value.split(/\s*(?:\/|,|;|\|)\s*/)) {
    const normalized = part.trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    names.push(normalized);
    seen.add(key);

    if (names.length >= 2) {
      break;
    }
  }

  return names;
}

function firstPlaceLabel(...values) {
  for (const value of values) {
    const labels = splitPlaceNames(value);

    if (labels.length > 0) {
      return labels.join(" / ");
    }
  }

  return null;
}

function stringAttribute(attributes, fieldName) {
  const value = attributes[fieldName];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberAttribute(attributes, fieldName) {
  const value = attributes[fieldName];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function featureLocation(attributes, geometryType) {
  const location = geometryType === "point"
    ? firstPlaceLabel(
        stringAttribute(attributes, "name"),
        stringAttribute(attributes, "station_abbr"),
        stringAttribute(attributes, "postal_code"),
      )
    : firstPlaceLabel(
        stringAttribute(attributes, "nearby_names"),
        stringAttribute(attributes, "nearby_name"),
        stringAttribute(attributes, "nearby_station_abbr"),
        stringAttribute(attributes, "nearby_postal_code"),
      );

  if (location) {
    return geometryType === "point" ? location : `near ${location}`;
  }

  return geometryType === "point" ? "Forecast point" : "Forecast surface cell";
}

function featureTimeLabel(attributes) {
  return formatSwissFeatureTime(attributes, { year: false });
}

export function formatSwissFeatureTime(attributes, options = {}) {
  const epochMs = numberAttribute(attributes, "valid_time_epoch_ms");
  let date = null;

  if (Number.isFinite(epochMs)) {
    date = new Date(epochMs > 10_000_000_000 ? epochMs : epochMs * 1000);
  } else if (typeof attributes.valid_time === "string") {
    const parsed = new Date(attributes.valid_time);
    date = Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  if (!date || !Number.isFinite(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(forecastLocale, {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: forecastTimeZone,
    ...(options.year === false ? {} : { year: "2-digit" }),
  }).format(date);
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function clearCardCallout(card) {
  card.removeAttribute("data-callout-side");
  card.style.removeProperty("--callout-x");
  card.style.removeProperty("--callout-y");
}

function setCardCallout(card, placement, anchorPoint) {
  if (!placement.calloutSide) {
    clearCardCallout(card);
    return;
  }

  const tailInset = 14;
  card.dataset.calloutSide = placement.calloutSide;

  if (placement.calloutSide === "top" || placement.calloutSide === "bottom") {
    const x = clamp(anchorPoint.x - placement.left, tailInset, placement.width - tailInset);
    card.style.setProperty("--callout-x", `${Math.round(x)}px`);
    card.style.removeProperty("--callout-y");
    return;
  }

  const y = clamp(anchorPoint.y - placement.top, tailInset, placement.height - tailInset);
  card.style.setProperty("--callout-y", `${Math.round(y)}px`);
  card.style.removeProperty("--callout-x");
}

function chooseCardPlacement(cardRect, stageRect, anchorPoint) {
  const padding = 10;
  const gap = 14;
  const width = cardRect.width;
  const height = cardRect.height;
  const maxLeft = Math.max(padding, stageRect.width - width - padding);
  const maxTop = Math.max(padding, stageRect.height - height - padding);
  const candidates = [
    { calloutSide: "bottom", left: anchorPoint.x - width / 2, top: anchorPoint.y - height - gap },
    { calloutSide: "top", left: anchorPoint.x - width / 2, top: anchorPoint.y + gap },
    { calloutSide: "left", left: anchorPoint.x + gap, top: anchorPoint.y - height / 2 },
    { calloutSide: "right", left: anchorPoint.x - width - gap, top: anchorPoint.y - height / 2 },
  ];

  const scored = candidates.map((candidate, index) => {
    const left = clamp(candidate.left, padding, maxLeft);
    const top = clamp(candidate.top, padding, maxTop);
    const overflow = Math.abs(left - candidate.left) + Math.abs(top - candidate.top);
    return { ...candidate, height, index, left, overflow, top, width };
  });

  return scored.reduce((winner, candidate) => {
    if (candidate.overflow < winner.overflow) {
      return candidate;
    }

    return candidate.overflow === winner.overflow && candidate.index < winner.index ? candidate : winner;
  });
}

function positionInfoCard(card, point, sticky, anchorPoint = point) {
  const stage = document.querySelector(".map-stage");

  if (!card || !stage || !point) {
    return null;
  }

  card.hidden = false;
  const stageRect = stage.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const placement = chooseCardPlacement(cardRect, stageRect, anchorPoint);

  card.style.transform = `translate(${Math.round(placement.left)}px, ${Math.round(placement.top)}px)`;

  if (sticky) {
    setCardCallout(card, placement, anchorPoint);
  } else {
    clearCardCallout(card);
  }

  return placement;
}

function resetInfoCard(card) {
  if (!card) {
    return;
  }

  card.classList.remove("map-hover-card--arming", "map-hover-card--loading", "map-hover-card--sticky");
  card.hidden = true;
  card.innerHTML = "";
  clearCardCallout(card);
}

function renderInfoCard(card, graphic, state, fields, point, sticky, anchorPoint = point, stickyDelayMs = 1200) {
  if (!card || !graphic) {
    return;
  }

  const attributes = graphic.attributes ?? {};
  const field = fields[state.selectedField];
  const timeLabel = featureTimeLabel(attributes);

  card.classList.toggle("map-hover-card--sticky", sticky);
  card.classList.remove("map-hover-card--loading");
  if (sticky) {
    card.classList.remove("map-hover-card--arming");
  }
  card.style.setProperty("--stick-delay-ms", `${stickyDelayMs}ms`);
  card.innerHTML = `
    <div class="map-hover-card__header">
      <div class="map-hover-card__heading">
        <div class="map-hover-card__context">
          <span class="map-hover-card__variable">${escapeHtml(field.label)}</span>
          <span class="map-hover-card__place">${escapeHtml(featureLocation(attributes, state.geometry.geometryType))}</span>
          ${timeLabel ? `<span class="map-hover-card__meta">${escapeHtml(timeLabel)}</span>` : ""}
        </div>
      </div>
      <div class="map-hover-card__tools">
        <span class="map-hover-card__loading" aria-hidden="true"></span>
        <span class="map-hover-card__stick-timer" aria-hidden="true"></span>
        <button class="map-hover-card__close" type="button" aria-label="Close info window" title="Close">&times;</button>
      </div>
    </div>
    <div class="map-hover-card__simple-value">${formatValueHtml(state.selectedField, attributes[state.selectedField], field.unit)}</div>
  `;

  positionInfoCard(card, point, sticky, anchorPoint);
}

function hideInfoWindow(state, options = {}) {
  if (state?.hoverDetails) {
    state.hoverDetails.hide(options);
    return;
  }

  if (state && options.clearPinned !== false) {
    state.infoPinned = false;
  }

  resetInfoCard(document.querySelector("#feature-window"));
  resetInfoCard(document.querySelector("#feature-window-sticky"));
}

// 5. Popup mode helpers.
function clearPopupFeatures(popup) {
  if (!popup) {
    return;
  }

  if (Array.isArray(popup.features)) {
    popup.features = [];
  } else if (typeof popup.features?.removeAll === "function") {
    popup.features.removeAll();
  } else {
    popup.features = [];
  }
}

function closeMapPopup(state) {
  const view = state?.mapElement?.view;
  const popup = view?.popup;

  view?.closePopup?.();
  popup?.close?.();

  if (!popup) {
    return;
  }

  clearPopupFeatures(popup);
  popup.selectedFeatureIndex = 0;
  popup.title = "";
  popup.visible = false;
}

function clearFeatureDetails(state) {
  hideInfoWindow(state);
  closeMapPopup(state);
}

function applyInfoMode(state) {
  const popupMode = state.infoMode === "popup";

  if (state.layer) {
    state.layer.popupEnabled = popupMode;
  }

  if (state.mapElement?.view) {
    state.mapElement.view.popupEnabled = popupMode;
  }

  if (state.mapElement) {
    state.mapElement.popupDisabled = !popupMode;
    state.mapElement.toggleAttribute("popup-disabled", !popupMode);
  }

  clearFeatureDetails(state);
}

function updateLayerStyle(state, fields, popupTemplateFor, createRenderer) {
  if (!state.layer) {
    return;
  }

  const fieldName = state.selectedField;
  state.layer.title = fields[fieldName].label;
  state.layer.renderer = createRenderer(fieldName, state.geometry.geometryType, fields[fieldName].label);
  state.layer.popupTemplate = popupTemplateFor(fieldName, state.geometry);
  scheduleColorRampLegendOnly();
}

// 6. Time slider helpers.
function sliderStops(slider) {
  const stops = Array.isArray(slider?.stops?.dates) ? slider.stops.dates : slider?.effectiveStops;

  return (stops ?? [])
    .filter((stop) => stop instanceof Date && Number.isFinite(stop.getTime()))
    .sort((first, second) => first.getTime() - second.getTime());
}

function dateForTrackPosition(slider, track, clientX) {
  const stops = sliderStops(slider);

  if (stops.length === 0) {
    return null;
  }

  const rect = track.getBoundingClientRect();

  if (rect.width <= 0) {
    return null;
  }

  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const stopIndex = Math.round(ratio * (stops.length - 1));
  return stops[stopIndex] ?? null;
}

function setSliderTime(slider, date) {
  const selectedTime = new Date(date.getTime());
  const instant = { start: selectedTime, end: selectedTime };
  slider.timeExtent = instant;

  if (slider.view) {
    slider.view.timeExtent = instant;
  }
}

// The visual slider is narrow; this adds a larger pointer hit zone without changing the UI.
function installBufferedHitArea(slider, root) {
  if (slider.getAttribute(hitAreaAttribute) === "true") {
    return;
  }

  const track = root.querySelector(".esri-slider__content");

  if (!track) {
    return;
  }

  let draggingPointerId = null;

  const isInsideBufferedTrack = (event) => {
    const rect = track.getBoundingClientRect();
    return event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top - hitAreaBufferPx &&
      event.clientY <= rect.bottom + hitAreaBufferPx;
  };

  const applyPointerTime = (event) => {
    const date = dateForTrackPosition(slider, track, event.clientX);

    if (!date) {
      return false;
    }

    setSliderTime(slider, date);
    return true;
  };

  const stopDragging = (event) => {
    if (draggingPointerId !== event.pointerId) {
      return;
    }

    draggingPointerId = null;
    window.removeEventListener("pointermove", handleWindowPointerMove, true);
    window.removeEventListener("pointerup", stopDragging, true);
    window.removeEventListener("pointercancel", stopDragging, true);
  };

  const handleWindowPointerMove = (event) => {
    if (draggingPointerId !== event.pointerId) {
      return;
    }

    if (applyPointerTime(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  root.addEventListener("pointerdown", (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 0 || !isInsideBufferedTrack(event)) {
      return;
    }

    if (!applyPointerTime(event)) {
      return;
    }

    draggingPointerId = event.pointerId;
    event.preventDefault();
    event.stopPropagation();
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", stopDragging, true);
    window.addEventListener("pointercancel", stopDragging, true);
  }, true);

  slider.setAttribute(hitAreaAttribute, "true");
}

function styleForecastTimeSlider(slider) {
  if (!slider) {
    return;
  }

  const apply = () => {
    const root = slider.shadowRoot;

    if (!root) {
      return;
    }

    installBufferedHitArea(slider, root);
  };

  apply();
  window.requestAnimationFrame(apply);
  window.setTimeout(apply, 250);
}
function syncTimeControls(state, formatTime) {
  const timeSelect = document.querySelector("#time-select");
  const timeSlider = document.querySelector("#time-slider");
  const epochs = state.sidecar.timeInfo.epochSeconds;

  timeSelect.replaceChildren();

  for (const epochSeconds of epochs) {
    const option = document.createElement("calcite-option");
    option.value = String(epochSeconds);
    option.textContent = formatTime(epochSeconds);
    timeSelect.append(option);
  }

  timeSelect.value = String(state.selectedEpoch);
  timeSlider.view = state.mapElement.view;
  timeSlider.disabled = false;
  timeSlider.mode = "instant";
  timeSlider.playRate = 450;
  timeSlider.fullTimeExtent = {
    start: new Date(epochs[0] * 1000),
    end: new Date(epochs[epochs.length - 1] * 1000),
  };
  timeSlider.stops = { dates: epochs.map((epochSeconds) => new Date(epochSeconds * 1000)) };
  timeSlider.timeExtent = {
    start: new Date(state.selectedEpoch * 1000),
    end: new Date(state.selectedEpoch * 1000),
  };
  styleForecastTimeSlider(timeSlider);
}

function nearestEpoch(epochs, timeMs) {
  return epochs.reduce((nearest, epochSeconds) =>
    Math.abs(epochSeconds * 1000 - timeMs) < Math.abs(nearest * 1000 - timeMs) ? epochSeconds : nearest,
  );
}

function createTimeFilterController(state, timeSelect, timeSlider, validTimeWhere) {
  // Slider dragging can emit updates faster than the layer should be filtered.
  // Keep only the latest requested epoch and apply it once per animation frame.
  let pendingEpoch = null;
  let frame = 0;

  return function scheduleTimeFilter(epochSeconds, options = {}) {
    pendingEpoch = epochSeconds;

    if (frame) {
      return;
    }

    frame = requestAnimationFrame(() => {
      frame = 0;

      if (!Number.isFinite(pendingEpoch) || !state.layer) {
        return;
      }

      const epoch = pendingEpoch;
      pendingEpoch = null;
      state.selectedEpoch = epoch;
      state.layer.definitionExpression = validTimeWhere(epoch);
      timeSelect.value = String(epoch);

      if (options.syncSlider !== false) {
        timeSlider.timeExtent = {
          start: new Date(epoch * 1000),
          end: new Date(epoch * 1000),
        };
      }

      state.parquetStats?.refresh?.();

      if (state.infoMode === "popup") {
        void refreshOpenPopup(state, epoch);
      } else if (state.hoverDetails) {
        state.hoverDetails.refresh({ immediate: true, quietSticky: true });
      } else {
        hideInfoWindow(state);
      }
    });
  };
}

// Shared feature lookup helpers for popups and hover cards.
//
// A rendered hit test is fast, but it can miss while ParquetLayer is refreshing
// after a definitionExpression change. These helpers fall back to queryFeatures
// so the visible card/popup can update at the same time as the map.
function isFiniteScreenPoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function graphicFromHit(hit, layer) {
  const graphic = hit?.graphic;

  if (!graphic) {
    return null;
  }

  const graphicLayer = graphic.layer ?? graphic.origin?.layer;
  return graphicLayer === layer || !graphicLayer ? graphic : null;
}

function featureCenterMapPoint(graphic) {
  const geometry = graphic.geometry;

  if (!geometry) {
    return null;
  }

  if (geometry.type === "point") {
    return geometry;
  }

  return centroidOperator?.execute?.(geometry) ?? geometry.extent?.center ?? null;
}

function closestGraphicToMapPoint(features, mapPoint) {
  if (!features || features.length === 0) {
    return null;
  }

  return features.reduce((closest, feature) => {
    const closestPoint = featureCenterMapPoint(closest);
    const featurePoint = featureCenterMapPoint(feature);

    if (!closestPoint || !featurePoint) {
      return closestPoint ? closest : feature;
    }

    const closestDistance = Math.hypot(closestPoint.x - mapPoint.x, closestPoint.y - mapPoint.y);
    const featureDistance = Math.hypot(featurePoint.x - mapPoint.x, featurePoint.y - mapPoint.y);
    return featureDistance < closestDistance ? feature : closest;
  });
}

function sqlLiteral(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function identityWhereForFeature(graphic, geometryType) {
  const attributes = graphic?.attributes ?? {};
  const candidates = geometryType === "point"
    ? [["station_abbr"], ["postal_code"], ["name"]]
    : [["hex_cell_id"], ["row", "column"], ["nearby_source_key"]];

  for (const fieldNames of candidates) {
    const parts = fieldNames.map((fieldName) => {
      const value = attributes[fieldName];

      if (value === null || value === undefined || value === "") {
        return null;
      }

      return `${fieldName} = ${sqlLiteral(value)}`;
    });

    if (parts.every(Boolean)) {
      return parts.join(" AND ");
    }
  }

  return null;
}

function filteredWhere(layer, where) {
  const layerWhere = layer.definitionExpression || "1=1";
  return where ? `(${layerWhere}) AND (${where})` : layerWhere;
}

async function queryLayerByIdentity(identityWhere, layer) {
  if (!identityWhere || !layer || typeof layer.queryFeatures !== "function") {
    return null;
  }

  try {
    const query = typeof layer.createQuery === "function" ? layer.createQuery() : {};
    query.returnGeometry = true;
    query.outFields = ["*"];
    query.num = 1;
    query.where = filteredWhere(layer, identityWhere);
    const result = await layer.queryFeatures(query);
    return result.features?.[0] ?? null;
  } catch {
    return null;
  }
}

function pointForLayerQuery(mapPoint, layer) {
  const layerWkid = layer?.spatialReference?.wkid;
  const mapWkid = mapPoint?.spatialReference?.wkid;

  if ((layerWkid === 4326 || !layerWkid) && mapWkid !== 4326) {
    const longitude = mapPoint.longitude;
    const latitude = mapPoint.latitude;

    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return {
        type: "point",
        x: longitude,
        y: latitude,
        longitude,
        latitude,
        spatialReference: { wkid: 4326 },
      };
    }
  }

  return mapPoint;
}

// Hit testing is fast for rendered features; queryFeatures handles dense point or polygon lookup misses.
async function queryLayerAtMapPoint(mapPoint, layer, state) {
  if (!layer || !mapPoint || typeof layer.queryFeatures !== "function") {
    return null;
  }

  try {
    const queryPoint = pointForLayerQuery(mapPoint, layer);
    const isPointGeometry = state.geometry.geometryType === "point";
    const query = typeof layer.createQuery === "function" ? layer.createQuery() : {};
    query.geometry = queryPoint;
    query.spatialRelationship = "intersects";
    query.returnGeometry = true;
    query.outFields = ["*"];
    query.num = isPointGeometry ? 8 : 1;
    query.where = filteredWhere(layer);

    if (isPointGeometry) {
      query.distance = 2000;
      query.units = "meters";
    }

    const result = await layer.queryFeatures(query);
    return isPointGeometry ? closestGraphicToMapPoint(result.features, queryPoint) : result.features?.[0] ?? null;
  } catch {
    return null;
  }
}

function selectedPopupFeature(popup) {
  if (popup?.selectedFeature) {
    return popup.selectedFeature;
  }

  if (Array.isArray(popup?.features)) {
    return popup.features[popup.selectedFeatureIndex ?? 0] ?? popup.features[0] ?? null;
  }

  if (typeof popup?.features?.getItemAt === "function") {
    return popup.features.getItemAt(popup.selectedFeatureIndex ?? 0) ?? popup.features.getItemAt(0) ?? null;
  }

  return null;
}

function popupAnchorMapPoint(popup) {
  return popup?.location ?? featureCenterMapPoint(selectedPopupFeature(popup));
}

async function popupGraphicForRefresh(popup, layer, state) {
  const selectedFeature = selectedPopupFeature(popup);
  const identityWhere = identityWhereForFeature(selectedFeature, state.geometry.geometryType);
  const identityGraphic = await queryLayerByIdentity(identityWhere, layer);

  if (identityGraphic) {
    return identityGraphic;
  }

  const mapPoint = popupAnchorMapPoint(popup);
  return mapPoint ? await queryLayerAtMapPoint(mapPoint, layer, state) : null;
}

async function refreshOpenPopup(state, expectedEpoch = state.selectedEpoch) {
  // Popup mode uses the native ArcGIS popup. When the time filter changes, the
  // selected feature object is stale, so we re-query the same feature identity
  // under the new layer definitionExpression and replace the popup feature.
  if (state.infoMode !== "popup" || !state.layer || !state.mapElement?.view?.popup) {
    return;
  }

  const view = state.mapElement.view;
  const popup = view.popup;

  if (!popup.visible) {
    return;
  }

  const mapPoint = popupAnchorMapPoint(popup);
  const graphic = await popupGraphicForRefresh(popup, state.layer, state);

  if (!graphic || state.infoMode !== "popup" || state.selectedEpoch !== expectedEpoch) {
    return;
  }

  if (Array.isArray(popup.features)) {
    popup.features = [graphic];
  } else if (typeof popup.features?.removeAll === "function") {
    popup.features.removeAll();
    popup.features.add(graphic);
  } else {
    popup.features = [graphic];
  }

  popup.selectedFeatureIndex = 0;
  popup.location = popup.location ?? mapPoint ?? featureCenterMapPoint(graphic);
  popup.title = state.layer.title;
}

// 7. Hover and sticky-card interaction.
//
// This is the longest part of the file because it handles several competing UI
// states: pointer hover, delayed sticky pinning, click pinning, map movement,
// time playback, and highlight cleanup. The important mental model is:
//
// - hover card: temporary, follows the pointer
// - sticky card: pinned by pause or click, keeps refreshing as time changes
// - request ids: prevent older async hit tests/queries from repainting the UI
// - graphics overlay: keeps selection feedback visible for points and polygons
// Hit tests and layer queries can resolve out of order while the time slider is
// changing definitionExpression, so hover and sticky cards use request ids.
function setupHoverDetails(mapElement, state, fields) {
  const hoverCardElement = document.querySelector("#feature-window");
  const stageElement = document.querySelector(".map-stage");
  const view = mapElement.view;
  const highlightGraphicAttribute = "__forecastInfoHighlight";
  // State naming:
  // - hover* belongs to the transient pointer-following card.
  // - sticky* belongs to the pinned card.
  // - pendingSticky* is the delayed "pause over a feature" promotion.
  // - dismissedSticky* prevents a just-closed card from reopening immediately.
  // Separate request ids and highlight handles keep those lifecycles independent.
  const stickyDelayMs = 1200;
  const queryDelayMs = 80;
  let hoverTimeoutHandle = 0;
  let stickyArmTimeoutHandle = 0;
  let stickyRefreshTimeoutHandle = 0;
  let stickyRepositionFrameHandle = 0;
  let hoverRequestId = 0;
  let stickyRequestId = 0;
  let hoverPoint = null;
  let hoverGraphic = null;
  let stickyPoint = null;
  let stickyMapPoint = null;
  let stickyFeatureWhere = null;
  let stickyFeatureKey = null;
  let dismissedStickyKey = null;
  let dismissedStickyPoint = null;
  let suppressViewClickUntil = 0;
  let suppressNextViewClick = false;
  let suppressNextViewClickTimeoutHandle = 0;
  let pendingStickyGraphic = null;
  let pendingStickyKey = null;
  let pendingStickyPoint = null;
  let pendingStickyHoverRequestId = 0;
  let stickyCardElement = null;
  let hoverHighlightHandle = null;
  let stickyHighlightHandle = null;
  let hoverHighlightGraphics = [];
  let stickyHighlightGraphics = [];
  let hoverHighlightRequestId = 0;
  let stickyHighlightRequestId = 0;
  let layerViewHandle = null;
  let layerViewRequestId = 0;
  let layerViewUpdating = false;
  let layerViewDataUpdating = false;

  if (hoverCardElement && stageElement) {
    stickyCardElement = document.querySelector("#feature-window-sticky");

    if (!stickyCardElement) {
      stickyCardElement = hoverCardElement.cloneNode(false);
      stickyCardElement.id = "feature-window-sticky";
      stickyCardElement.hidden = true;
      stickyCardElement.classList.add("map-hover-card--sticky-card");
      stageElement.append(stickyCardElement);
    }
  }

  function activeLayer() {
    return state.infoMode === "hover" ? state.layer : null;
  }

  function pointFromEvent(event) {
    return { x: event.x, y: event.y, mapPoint: event.mapPoint };
  }

  function mapPointFromScreen(point) {
    return point.mapPoint ?? view.toMap(point);
  }

  function stickyAnchorMapPoint(graphic, pointerPoint) {
    return featureCenterMapPoint(graphic) ?? mapPointFromScreen(pointerPoint) ?? pointerPoint.mapPoint;
  }

  function stickyScreenPoint() {
    if (stickyMapPoint) {
      const screenPoint = view.toScreen(stickyMapPoint);
      return isFiniteScreenPoint(screenPoint) ? { x: screenPoint.x, y: screenPoint.y, mapPoint: stickyMapPoint } : null;
    }

    return stickyPoint;
  }

  function stickyCardVisible() {
    return Boolean(stickyCardElement && !stickyCardElement.hidden);
  }

  function layerViewBusy() {
    return Boolean(!view.stationary || view.updating || layerViewUpdating || layerViewDataUpdating);
  }

  function armingStickyTimerActive() {
    return Boolean(stickyArmTimeoutHandle && !stickyCardVisible());
  }

  function markHoverWaiting() {
    if (hoverPoint && !stickyCardVisible()) {
      setCardLoading(hoverCardElement, true);
    }
  }

  function screenDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function featureScreenPoint(graphic) {
    const mapPoint = featureCenterMapPoint(graphic);
    const screenPoint = mapPoint ? view.toScreen(mapPoint) : null;

    return isFiniteScreenPoint(screenPoint) ? screenPoint : null;
  }

  function queriedGraphicNearPoint(graphic, point) {
    const screenPoint = featureScreenPoint(graphic);
    const tolerance = state.geometry.geometryType === "point" ? 32 : 44;

    return Boolean(screenPoint && screenDistance(screenPoint, point) <= tolerance);
  }

  function stickyTargetKey(graphic) {
    const attributes = graphic.attributes ?? {};
    const parts = [
      attributes.OBJECTID,
      attributes.ObjectID,
      attributes.objectid,
      attributes.FID,
      attributes.id,
      attributes.valid_time_epoch_ms,
      attributes.valid_time,
      attributes.station_abbr,
      attributes.nearby_station_abbr,
      attributes.hex_cell_id,
      attributes.row,
      attributes.column,
    ].filter((value) => value !== null && value !== undefined && value !== "");

    if (parts.length > 0) {
      return parts.map(String).join(":");
    }

    return `${graphic.geometry?.type ?? "unknown"}:${graphic.uid ?? ""}`;
  }

  function clearDismissedSticky() {
    dismissedStickyKey = null;
    dismissedStickyPoint = null;
  }

  function rememberDismissedSticky() {
    dismissedStickyKey = stickyFeatureKey ?? stickyFeatureWhere;
    const point = stickyScreenPoint() ?? stickyPoint;
    dismissedStickyPoint = isFiniteScreenPoint(point) ? { x: point.x, y: point.y } : null;
  }

  function sameDismissedSticky(graphic, point) {
    if (!dismissedStickyKey) {
      return false;
    }

    if (stickyTargetKey(graphic) !== dismissedStickyKey) {
      clearDismissedSticky();
      return false;
    }

    if (dismissedStickyPoint && screenDistance(dismissedStickyPoint, point) > 36) {
      clearDismissedSticky();
      return false;
    }

    return true;
  }

  function clearHoverTimeout() {
    if (hoverTimeoutHandle) {
      window.clearTimeout(hoverTimeoutHandle);
      hoverTimeoutHandle = 0;
    }
  }

  function clearViewClickSuppression() {
    if (suppressNextViewClickTimeoutHandle) {
      window.clearTimeout(suppressNextViewClickTimeoutHandle);
      suppressNextViewClickTimeoutHandle = 0;
    }

    suppressNextViewClick = false;
  }

  function suppressUpcomingViewClick() {
    clearViewClickSuppression();
    suppressNextViewClick = true;
    suppressViewClickUntil = performance.now() + 1500;
    suppressNextViewClickTimeoutHandle = window.setTimeout(() => {
      suppressNextViewClick = false;
      suppressNextViewClickTimeoutHandle = 0;
    }, 1500);
  }

  function clearStickyArmTimeout() {
    if (stickyArmTimeoutHandle) {
      window.clearTimeout(stickyArmTimeoutHandle);
      stickyArmTimeoutHandle = 0;
    }

    pendingStickyGraphic = null;
    pendingStickyKey = null;
    pendingStickyPoint = null;
    pendingStickyHoverRequestId = 0;
    hoverCardElement?.classList.remove("map-hover-card--arming");
  }

  function clearStickyRefreshTimeout() {
    if (stickyRefreshTimeoutHandle) {
      window.clearTimeout(stickyRefreshTimeoutHandle);
      stickyRefreshTimeoutHandle = 0;
    }
  }

  function clearStickyRepositionFrame() {
    if (stickyRepositionFrameHandle) {
      window.cancelAnimationFrame(stickyRepositionFrameHandle);
      stickyRepositionFrameHandle = 0;
    }
  }

  function clearLayerViewWatch() {
    layerViewRequestId += 1;
    layerViewHandle?.remove?.();
    layerViewHandle = null;
    layerViewUpdating = false;
    layerViewDataUpdating = false;
  }

  function syncLayerView() {
    // LayerView updating is the signal that the visual layer is still catching
    // up with a new time filter. While busy, the card shows loading and feature
    // lookup prefers queryFeatures over rendered hit testing.
    clearLayerViewWatch();
    const layer = activeLayer();

    if (!layer) {
      return;
    }

    const requestId = layerViewRequestId;

    view.whenLayerView(layer).then((layerView) => {
      if (requestId !== layerViewRequestId || layer !== activeLayer()) {
        return;
      }

      const updateLayerViewState = ([updating, dataUpdating] = [layerView.updating, layerView.dataUpdating]) => {
        layerViewUpdating = Boolean(updating);
        layerViewDataUpdating = Boolean(dataUpdating);

        if (layerViewUpdating || layerViewDataUpdating) {
          markHoverWaiting();
          return;
        }

        refresh({ immediate: true, quietSticky: true });
      };

      updateLayerViewState();
      layerViewHandle = reactiveUtils.watch(
        () => [layerView.updating, layerView.dataUpdating ?? false],
        updateLayerViewState,
      );
    }).catch(() => undefined);
  }

  function setCardLoading(card, loading) {
    card?.classList.toggle("map-hover-card--loading", loading);
  }

  // Feature feedback is drawn as a graphics overlay for every geometry type.
  // Point layers additionally use LayerView.highlight when the layer view is ready.
  function symbolForFeatureHighlight(geometryType, sticky) {
    const color = sticky ? [255, 204, 51] : [46, 196, 255];
    const fillOpacity = sticky ? 0.16 : 0.07;
    const outlineOpacity = sticky ? 0.95 : 0.62;
    const outlineWidth = sticky ? 2.1 : 1.3;

    if (geometryType === "point" || geometryType === "multipoint") {
      return {
        type: "simple-marker",
        color: [...color, fillOpacity],
        outline: { color: [...color, outlineOpacity], width: outlineWidth },
        size: sticky ? 14 : 11,
        style: "circle",
      };
    }

    if (geometryType === "polyline") {
      return {
        type: "simple-line",
        color: [...color, outlineOpacity],
        width: sticky ? 4 : 3,
      };
    }

    return {
      type: "simple-fill",
      color: [...color, fillOpacity],
      outline: { color: [...color, outlineOpacity], width: outlineWidth },
    };
  }

  function removeFeatureHighlightGraphic(sticky) {
    const highlightGraphics = sticky ? stickyHighlightGraphics : hoverHighlightGraphics;
    const highlightKind = sticky ? "sticky" : "hover";
    const graphicsCollection = view.graphics;
    const taggedGraphics = graphicsCollection?.toArray?.()
      .filter((graphic) => graphic?.attributes?.[highlightGraphicAttribute] === highlightKind) ?? [];
    const graphicsToRemove = [...new Set([...highlightGraphics, ...taggedGraphics])];

    for (const highlightGraphic of graphicsToRemove) {
      graphicsCollection?.remove?.(highlightGraphic);
    }

    if (sticky) {
      stickyHighlightGraphics = [];
      return;
    }

    hoverHighlightGraphics = [];
  }

  function setFeatureHighlightGraphic(graphic, sticky) {
    const geometryType = graphic.geometry?.type;
    const highlightGraphic = graphic.clone?.();

    if (!highlightGraphic) {
      return;
    }

    highlightGraphic.attributes = {
      [highlightGraphicAttribute]: sticky ? "sticky" : "hover",
    };
    highlightGraphic.popupTemplate = null;
    highlightGraphic.symbol = symbolForFeatureHighlight(geometryType, sticky);
    const highlightGraphics = [highlightGraphic];

    removeFeatureHighlightGraphic(sticky);

    if (sticky) {
      stickyHighlightGraphics = highlightGraphics;
    } else {
      hoverHighlightGraphics = highlightGraphics;
    }

    for (const featureHighlightGraphic of highlightGraphics) {
      view.graphics?.add?.(featureHighlightGraphic);
    }
  }

  function clearFeatureHighlight(sticky) {
    removeFeatureHighlightGraphic(sticky);

    if (sticky) {
      stickyHighlightRequestId += 1;
      stickyHighlightHandle?.remove?.();
      stickyHighlightHandle = null;
      return;
    }

    hoverHighlightRequestId += 1;
    hoverHighlightHandle?.remove?.();
    hoverHighlightHandle = null;
  }

  async function setFeatureHighlight(graphic, layer, sticky = false) {
    const requestId = sticky ? ++stickyHighlightRequestId : ++hoverHighlightRequestId;
    setFeatureHighlightGraphic(graphic, sticky);

    if (graphic.geometry?.type !== "point" && graphic.geometry?.type !== "multipoint") {
      if (sticky) {
        stickyHighlightHandle?.remove?.();
        stickyHighlightHandle = null;
      } else {
        hoverHighlightHandle?.remove?.();
        hoverHighlightHandle = null;
      }
      return;
    }

    try {
      const layerView = await view.whenLayerView(layer);

      if (requestId !== (sticky ? stickyHighlightRequestId : hoverHighlightRequestId) || layer !== activeLayer()) {
        return;
      }

      const nextHighlightHandle = layerView.highlight(graphic, { name: "default" });

      if (requestId !== (sticky ? stickyHighlightRequestId : hoverHighlightRequestId) || layer !== activeLayer()) {
        nextHighlightHandle?.remove?.();
        return;
      }

      if (sticky) {
        stickyHighlightHandle?.remove?.();
        stickyHighlightHandle = nextHighlightHandle;
        return;
      }

      hoverHighlightHandle?.remove?.();
      hoverHighlightHandle = nextHighlightHandle;
    } catch {
      // The graphics overlay above still provides visible feedback if LayerView highlighting is unavailable.
    }
  }

  function hideHoverCard(options = {}) {
    clearHoverTimeout();
    hoverRequestId += 1;
    if (options.clearHighlight !== false) {
      clearFeatureHighlight(false);
    }
    hoverPoint = null;
    hoverGraphic = null;
    resetInfoCard(hoverCardElement);
  }

  function hideStickyCard(options = {}) {
    if (options.rememberDismissed) {
      rememberDismissedSticky();
    } else {
      clearDismissedSticky();
    }

    clearStickyArmTimeout();
    clearStickyRefreshTimeout();
    clearStickyRepositionFrame();
    clearFeatureHighlight(true);
    stickyRequestId += 1;
    stickyPoint = null;
    stickyMapPoint = null;
    stickyFeatureWhere = null;
    stickyFeatureKey = null;
    state.infoPinned = false;
    resetInfoCard(stickyCardElement);
  }

  function hideAll(options = {}) {
    clearStickyArmTimeout();
    hideHoverCard();

    if (options.clearPinned !== false) {
      hideStickyCard(options);
    }
  }

  async function hitTestLayer(point, layer = activeLayer()) {
    if (!layer) {
      return null;
    }

    const response = await view.hitTest(point, { include: [layer] });
    return response.results
      .map((hit) => graphicFromHit(hit, layer))
      .find((graphic) => graphic !== null && !graphic.attributes?.[highlightGraphicAttribute]) ?? null;
  }

  // During playback the layer view can stay busy between frames. In that case,
  // query the filtered ParquetLayer first, then try the rendered hit test.
  async function featureAtPoint(point, layer = activeLayer(), options = {}) {
    if (!layer) {
      return null;
    }

    const mapPoint = mapPointFromScreen(point) ?? point.mapPoint;

    if (options.preferQuery) {
      const queriedGraphic = mapPoint ? await queryLayerAtMapPoint(mapPoint, layer, state) : null;

      if (queriedGraphic && queriedGraphicNearPoint(queriedGraphic, point)) {
        return queriedGraphic;
      }
    }

    const hitGraphic = await hitTestLayer(point, layer);

    if (hitGraphic) {
      return hitGraphic;
    }

    if (!options.preferQuery) {
      const queriedGraphic = mapPoint ? await queryLayerAtMapPoint(mapPoint, layer, state) : null;
      return queriedGraphic && queriedGraphicNearPoint(queriedGraphic, point) ? queriedGraphic : null;
    }

    return null;
  }

  async function stickyGraphicForRefresh(point, layer) {
    // Prefer a stable identity query. If the geometry or dataset variant does
    // not expose a reliable identity, fall back to the original map location.
    const identityGraphic = stickyFeatureWhere ? await queryLayerByIdentity(stickyFeatureWhere, layer) : null;

    if (identityGraphic) {
      return identityGraphic;
    }

    const mapPoint = stickyMapPoint ?? point.mapPoint ?? mapPointFromScreen(point);
    const queriedGraphic = mapPoint ? await queryLayerAtMapPoint(mapPoint, layer, state) : null;
    return queriedGraphic ?? await hitTestLayer(point, layer);
  }

  function scheduleStickyReposition() {
    if (stickyRepositionFrameHandle || !stickyCardVisible()) {
      return;
    }

    stickyRepositionFrameHandle = window.requestAnimationFrame(() => {
      stickyRepositionFrameHandle = 0;
      const point = stickyScreenPoint();

      if (!isFiniteScreenPoint(point)) {
        if (stickyCardElement) {
          clearCardCallout(stickyCardElement);
        }
        return;
      }

      stickyPoint = { ...point };
      positionInfoCard(stickyCardElement, point, true, point);
    });
  }

  function makeSticky(graphic, point, expectedHoverRequestId) {
    // Promotion from hover to sticky is only valid if no newer hover request
    // has replaced the target while the sticky timer was waiting.
    const layer = activeLayer();

    if (expectedHoverRequestId !== hoverRequestId || !layer || !stickyCardElement) {
      return;
    }

    clearStickyArmTimeout();
    stickyRequestId += 1;
    stickyMapPoint = stickyAnchorMapPoint(graphic, point);
    stickyFeatureWhere = identityWhereForFeature(graphic, state.geometry.geometryType);
    stickyFeatureKey = stickyTargetKey(graphic);
    const anchorPoint = stickyScreenPoint() ?? point;
    stickyPoint = { ...anchorPoint };
    state.infoPinned = true;
    renderInfoCard(stickyCardElement, graphic, state, fields, anchorPoint, true, anchorPoint, stickyDelayMs);
    void setFeatureHighlight(graphic, layer, true);
    hideHoverCard();
  }

  // Staying over the same feature promotes the hover card to a sticky card.
  function scheduleSticky(graphic, point, expectedHoverRequestId) {
    if (stickyCardVisible()) {
      clearStickyArmTimeout();
      return;
    }

    const targetKey = stickyTargetKey(graphic);

    if (stickyArmTimeoutHandle && pendingStickyKey === targetKey) {
      pendingStickyGraphic = graphic;
      pendingStickyPoint = { ...point };
      pendingStickyHoverRequestId = expectedHoverRequestId;
      hoverCardElement?.classList.add("map-hover-card--arming");
      return;
    }

    clearStickyArmTimeout();
    pendingStickyGraphic = graphic;
    pendingStickyKey = targetKey;
    pendingStickyPoint = { ...point };
    pendingStickyHoverRequestId = expectedHoverRequestId;
    hoverCardElement?.classList.add("map-hover-card--arming");
    stickyArmTimeoutHandle = window.setTimeout(() => {
      const graphicToStick = pendingStickyGraphic ?? graphic;
      const pointToStick = pendingStickyPoint ?? point;
      const hoverRequestIdForStick = pendingStickyHoverRequestId || expectedHoverRequestId;
      stickyArmTimeoutHandle = 0;
      pendingStickyGraphic = null;
      pendingStickyKey = null;
      pendingStickyPoint = null;
      pendingStickyHoverRequestId = 0;
      makeSticky(graphicToStick, pointToStick, hoverRequestIdForStick);
    }, stickyDelayMs);
  }

  // Every hover lookup is asynchronous. expectedHoverRequestId prevents older
  // lookups from replacing newer pointer or time-slider results.
  async function updateHover(point, expectedHoverRequestId, armSticky = true, preserveStickyArm = false) {
    const layer = activeLayer();

    if (!layer) {
      hideHoverCard();
      return;
    }

    const busy = layerViewBusy();

    if (busy) {
      clearFeatureHighlight(false);
      markHoverWaiting();
    }

    try {
      setCardLoading(hoverCardElement, !stickyCardVisible() && !armingStickyTimerActive());
      const graphic = await featureAtPoint(point, layer, { preferQuery: busy });

      if (expectedHoverRequestId !== hoverRequestId || layer !== activeLayer()) {
        return;
      }

      setCardLoading(hoverCardElement, false);

      if (!graphic || !hasSelectedForecastValue(graphic, state)) {
        clearStickyArmTimeout();
        hideHoverCard();
        return;
      }

      if (sameDismissedSticky(graphic, point)) {
        clearStickyArmTimeout();
        hideHoverCard();
        return;
      }

      const targetKey = stickyTargetKey(graphic);
      const preserveArmingCard = Boolean(
        (armSticky || preserveStickyArm) &&
        stickyArmTimeoutHandle &&
        pendingStickyKey === targetKey &&
        hoverCardElement &&
        !hoverCardElement.hidden &&
        hoverCardElement.classList.contains("map-hover-card--arming")
      );

      hoverGraphic = graphic;
      if (preserveArmingCard) {
        positionInfoCard(hoverCardElement, point, false, point);
      } else {
        renderInfoCard(hoverCardElement, graphic, state, fields, point, false, point, stickyDelayMs);
      }
      void setFeatureHighlight(graphic, layer, false);

      if (armSticky) {
        scheduleSticky(graphic, point, expectedHoverRequestId);
      } else if (preserveStickyArm && stickyArmTimeoutHandle) {
        pendingStickyGraphic = graphic;
        pendingStickyKey = stickyTargetKey(graphic);
        pendingStickyPoint = { ...point };
        pendingStickyHoverRequestId = expectedHoverRequestId;
      } else {
        clearStickyArmTimeout();
      }
    } catch {
      setCardLoading(hoverCardElement, false);
      clearStickyArmTimeout();
      hideHoverCard();
    }
  }

  function requestHover(point, delayMs = queryDelayMs, armSticky = true, preserveStickyArm = false) {
    clearHoverTimeout();
    hoverPoint = { ...point };
    const nextHoverRequestId = hoverRequestId + 1;
    hoverRequestId = nextHoverRequestId;

    if (preserveStickyArm && stickyArmTimeoutHandle) {
      pendingStickyPoint = { ...point };
      pendingStickyHoverRequestId = nextHoverRequestId;
    }

    hoverTimeoutHandle = window.setTimeout(() => {
      hoverTimeoutHandle = 0;
      void updateHover(point, nextHoverRequestId, armSticky, preserveStickyArm);
    }, delayMs);
  }

  // Sticky cards keep an identity query so their value can refresh when the
  // time filter changes without requiring the user to reopen the card.
  async function updateSticky(point, expectedStickyRequestId, showLoading = true) {
    const layer = activeLayer();

    if (!layer || !stickyCardElement) {
      hideStickyCard();
      return;
    }

    try {
      setCardLoading(stickyCardElement, showLoading);
      const graphic = await stickyGraphicForRefresh(point, layer);

      if (expectedStickyRequestId !== stickyRequestId || layer !== activeLayer()) {
        return;
      }

      setCardLoading(stickyCardElement, false);

      if (!graphic) {
        return;
      }

      if (!hasSelectedForecastValue(graphic, state)) {
        hideStickyCard();
        return;
      }

      const anchorPoint = stickyScreenPoint() ?? point;
      stickyPoint = { ...anchorPoint };
      stickyFeatureWhere = identityWhereForFeature(graphic, state.geometry.geometryType) ?? stickyFeatureWhere;
      stickyFeatureKey = stickyTargetKey(graphic);
      renderInfoCard(stickyCardElement, graphic, state, fields, anchorPoint, true, anchorPoint, stickyDelayMs);
      void setFeatureHighlight(graphic, layer, true);
    } catch {
      setCardLoading(stickyCardElement, false);
    }
  }

  function requestStickyRefresh(options = {}) {
    // Debounce refreshes from the time slider and layer view so playback does
    // not queue multiple stale Parquet queries for the same pinned card.
    if (!stickyCardVisible() || !stickyPoint || !activeLayer()) {
      return;
    }

    const point = stickyScreenPoint();

    if (!isFiniteScreenPoint(point)) {
      if (stickyCardElement) {
        clearCardCallout(stickyCardElement);
      }
      return;
    }

    stickyPoint = { ...point };
    clearStickyRefreshTimeout();
    const nextStickyRequestId = stickyRequestId + 1;
    stickyRequestId = nextStickyRequestId;
    const showLoading = !options.quietSticky;

    setCardLoading(stickyCardElement, false);
    stickyRefreshTimeoutHandle = window.setTimeout(() => {
      const refreshPoint = stickyScreenPoint();
      stickyRefreshTimeoutHandle = 0;

      if (refreshPoint && nextStickyRequestId === stickyRequestId) {
        stickyPoint = { ...refreshPoint };
        void updateSticky(refreshPoint, nextStickyRequestId, showLoading);
      }
    }, options.immediate ? 0 : 80);
  }

  // Re-run the visible card lookups after time, view, or layer-view updates.
  function refresh(options = {}) {
    scheduleStickyReposition();

    if (layerViewBusy()) {
      markHoverWaiting();
      if (stickyCardVisible() && !options.quietSticky) {
        setCardLoading(stickyCardElement, true);
      }
      return;
    }

    requestStickyRefresh(options);

    if (hoverPoint && !stickyCardVisible()) {
      requestHover(hoverPoint, options.immediate ? 0 : 80, false, true);
    }
  }

  // Pointer movement shows the lightweight hover card and arms the sticky timer.
  function schedule(event) {
    if (state.infoMode !== "hover" || !activeLayer()) {
      hideAll();
      return;
    }

    const point = pointFromEvent(event);

    if (dismissedStickyPoint && screenDistance(dismissedStickyPoint, point) > 36) {
      clearDismissedSticky();
    }

    if (pendingStickyPoint && screenDistance(pendingStickyPoint, point) > 24) {
      clearStickyArmTimeout();
    }

    if (!stickyCardVisible() && !armingStickyTimerActive()) {
      hideHoverCard({ clearHighlight: false });
    }

    requestHover(point);
  }

  // A click pins the current forecast feature so it can keep updating as time changes.
  async function showStickyAt(event) {
    if (state.infoMode !== "hover" || !activeLayer() || !stickyCardElement) {
      return;
    }

    const point = pointFromEvent(event);
    const layer = activeLayer();
    const clickedHoverGraphic = hoverGraphic && hoverPoint && screenDistance(hoverPoint, point) <= 24 ? hoverGraphic : null;

    clearStickyArmTimeout();
    clearStickyRefreshTimeout();
    clearStickyRepositionFrame();
    hideHoverCard();
    clearFeatureHighlight(true);
    clearDismissedSticky();
    stickyRequestId += 1;
    const expectedStickyRequestId = stickyRequestId;
    stickyMapPoint = null;
    stickyPoint = null;
    stickyFeatureWhere = null;
    stickyFeatureKey = null;
    state.infoPinned = false;
    resetInfoCard(stickyCardElement);

    try {
      setCardLoading(stickyCardElement, true);
      const graphic = clickedHoverGraphic ?? await featureAtPoint(point, layer);

      if (expectedStickyRequestId !== stickyRequestId || layer !== activeLayer()) {
        return;
      }

      setCardLoading(stickyCardElement, false);

      if (!graphic || !hasSelectedForecastValue(graphic, state)) {
        hideStickyCard();
        return;
      }

      stickyMapPoint = stickyAnchorMapPoint(graphic, point);
      stickyFeatureWhere = identityWhereForFeature(graphic, state.geometry.geometryType);
      stickyFeatureKey = stickyTargetKey(graphic);
      const anchorPoint = stickyScreenPoint() ?? point;
      stickyPoint = { ...anchorPoint };
      state.infoPinned = true;
      renderInfoCard(stickyCardElement, graphic, state, fields, anchorPoint, true, anchorPoint, stickyDelayMs);
      void setFeatureHighlight(graphic, layer, true);
    } catch {
      setCardLoading(stickyCardElement, false);
    }
  }

  const handles = [
    view.on("pointer-move", schedule),
    view.on("pointer-leave", () => {
      clearStickyArmTimeout();
      hideHoverCard();
    }),
    view.on("pointer-down", () => {
      if (!stickyCardVisible()) {
        clearStickyArmTimeout();
        hideHoverCard();
      }
    }),
    view.on("click", (event) => {
      if (suppressNextViewClick || performance.now() < suppressViewClickUntil) {
        clearViewClickSuppression();
        event.stopPropagation?.();
        return;
      }

      void showStickyAt(event);
    }),
    reactiveUtils.watch(
      () => [view.stationary, view.updating, view.timeExtent?.start?.getTime() ?? null],
      () => refresh({ immediate: true, quietSticky: true }),
    ),
  ];

  const closeSticky = (event) => {
    // The close button sits above the MapView. Suppress the next map click so
    // closing a card does not immediately reopen a card at the same screen spot.
    const target = event.target;

    if (target instanceof Element && target.closest(".map-hover-card__close")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      suppressUpcomingViewClick();
      hideHoverCard();
      hideStickyCard({ rememberDismissed: true });
    }
  };

  const stopClosePointer = (event) => {
    closeSticky(event);
  };

  hoverCardElement?.addEventListener("pointerdown", stopClosePointer, true);
  stickyCardElement?.addEventListener("pointerdown", stopClosePointer, true);
  hoverCardElement?.addEventListener("click", closeSticky, true);
  stickyCardElement?.addEventListener("click", closeSticky, true);
  syncLayerView();
  resetInfoCard(hoverCardElement);
  resetInfoCard(stickyCardElement);

  return {
    destroy() {
      handles.forEach((handle) => handle.remove?.());
      clearViewClickSuppression();
      hoverCardElement?.removeEventListener("pointerdown", stopClosePointer, true);
      stickyCardElement?.removeEventListener("pointerdown", stopClosePointer, true);
      hoverCardElement?.removeEventListener("click", closeSticky, true);
      stickyCardElement?.removeEventListener("click", closeSticky, true);
      clearLayerViewWatch();
      hideAll();
      stickyCardElement?.remove();
    },
    hide: hideAll,
    refresh,
    syncLayer: syncLayerView,
  };
}
// 8. Mobile panel behavior.
//
// Calcite handles the panel styling; this only switches the panel from docked
// desktop mode to a floating mobile drawer and keeps focus/aria state consistent.
function setupMobileControls() {
  const panel = document.querySelector("#forecast-panel");
  const openButton = document.querySelector("#mobile-controls-button");
  const closeButton = document.querySelector("#mobile-controls-close");
  const scrim = document.querySelector("#mobile-panel-scrim");

  if (!panel || !openButton || !closeButton || !scrim) {
    return;
  }

  const mobileQuery = window.matchMedia("(max-width: 700px), (max-height: 520px) and (orientation: landscape)");
  const desktopDisplayMode = panel.getAttribute("display-mode") || "dock";

  function controlsOpen() {
    return document.body.classList.contains("mobile-controls-open");
  }

  function setPanelInteractive(interactive) {
    if ("inert" in panel) {
      panel.inert = !interactive;
    }

    if (interactive) {
      panel.removeAttribute("aria-hidden");
    } else {
      panel.setAttribute("aria-hidden", "true");
    }
  }

  function syncMobileState() {
    const isMobile = mobileQuery.matches;
    openButton.hidden = !isMobile;
    closeButton.hidden = !isMobile;

    if (!isMobile) {
      document.body.classList.remove("mobile-controls-open");
      panel.setAttribute("display-mode", desktopDisplayMode);
      openButton.setAttribute("aria-expanded", "false");
      scrim.hidden = true;

      if ("inert" in panel) {
        panel.inert = false;
      }

      panel.removeAttribute("aria-hidden");
      return;
    }

    panel.setAttribute("display-mode", "float");
    const open = controlsOpen();
    openButton.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
    setPanelInteractive(open);
  }

  function openControls() {
    if (!mobileQuery.matches) {
      return;
    }

    document.body.classList.add("mobile-controls-open");
    syncMobileState();
    window.requestAnimationFrame(() => closeButton.focus?.());
  }

  function closeControls(options = {}) {
    document.body.classList.remove("mobile-controls-open");
    syncMobileState();

    if (options.returnFocus !== false && mobileQuery.matches) {
      openButton.focus?.();
    }
  }

  openButton.addEventListener("click", () => {
    if (controlsOpen()) {
      closeControls({ returnFocus: false });
    } else {
      openControls();
    }
  });
  closeButton.addEventListener("click", () => closeControls());
  closeButton.addEventListener("calciteActionSelect", () => closeControls());
  scrim.addEventListener("click", () => closeControls({ returnFocus: false }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && controlsOpen() && mobileQuery.matches) {
      closeControls();
    }
  });

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", syncMobileState);
  } else {
    mobileQuery.addListener(syncMobileState);
  }

  syncMobileState();
}

// 9. Calcite control wiring.
//
// This is the bridge between the small app.js state object and the optional UI:
// controls change geometry, field, time, or info-window mode; helpers keep the
// layer, legend, popup, hover card, and stats synchronized.
export function setupSampleControls(options) {
  const {
    fields,
    formatTime,
    loadGeometry,
    mapElement,
    popupTemplateFor,
    rendererForField: createRenderer,
    setStatus,
    state,
    validTimeWhere,
  } = options;

  const geometrySelect = document.querySelector("#geometry-select");
  const fieldSelect = document.querySelector("#field-select");
  const timeSelect = document.querySelector("#time-select");
  const infoModeControl = document.querySelector("#info-mode-control");
  const timeSlider = document.querySelector("#time-slider");
  const scheduleTimeFilter = createTimeFilterController(state, timeSelect, timeSlider, validTimeWhere);

  state.mapElement = mapElement;
  geometrySelect.value = state.geometryKey;
  fieldSelect.value = state.selectedField;
  infoModeControl.value = state.infoMode;
  hideInfoWindow(state);
  setupCodePanel();
  setupMobileControls();
  state.parquetStats = setupParquetStatsPanel(state);
  state.hoverDetails = setupHoverDetails(mapElement, state, fields);

  const controller = {
    syncLayer() {
      if (!state.layer || !state.sidecar) {
        return;
      }

      geometrySelect.value = state.geometryKey;
      fieldSelect.value = state.selectedField;
      infoModeControl.value = state.infoMode;
      syncTimeControls(state, formatTime);
      updateLayerStyle(state, fields, popupTemplateFor, createRenderer);
      applyInfoMode(state);
      state.parquetStats?.refresh?.();
      state.hoverDetails?.syncLayer?.();
    },
  };

  geometrySelect.addEventListener("calciteSelectChange", async () => {
    geometrySelect.disabled = true;
    clearFeatureDetails(state);

    try {
      await loadGeometry(geometrySelect.value || state.geometryKey);
      controller.syncLayer();
    } catch (error) {
      console.error(error);
      geometrySelect.value = state.geometryKey;
      setStatus(error instanceof Error ? error.message : "Geometry failed to load", "danger");
    } finally {
      geometrySelect.disabled = false;
    }
  });

  fieldSelect.addEventListener("calciteSelectChange", () => {
    state.selectedField = fieldSelect.value;
    updateLayerStyle(state, fields, popupTemplateFor, createRenderer);

    if (state.infoMode === "popup") {
      void refreshOpenPopup(state);
    } else {
      state.hoverDetails?.refresh({ immediate: true, quietSticky: true });
    }
  });

  timeSelect.addEventListener("calciteSelectChange", () => {
    scheduleTimeFilter(Number(timeSelect.value));
  });

  infoModeControl.addEventListener("calciteSegmentedControlChange", () => {
    state.infoMode = infoModeControl.value === "popup" ? "popup" : "hover";
    infoModeControl.value = state.infoMode;
    applyInfoMode(state);
  });

  reactiveUtils.watch(
    () => mapElement.view.timeExtent?.start?.getTime() ?? null,
    (timeMs) => {
      if (typeof timeMs !== "number" || !state.layer || !state.sidecar) {
        return;
      }

      scheduleTimeFilter(nearestEpoch(state.sidecar.timeInfo.epochSeconds, timeMs), { syncSlider: false });
    },
  );

  return controller;
}
