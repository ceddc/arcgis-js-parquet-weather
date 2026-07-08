import {
  formatSwissFeatureTime,
  formatSwissForecastHour,
  rendererForField,
  setArcgisGeometryOperators,
  setArcgisReactiveUtils,
  setupSampleControls,
} from "./forecast-extras.js";
import { prepareGitHubPagesParquetHead } from "./github-pages-parquet-head.js";
import { completeLoadingPage, failLoadingPage, setLoadingPageStatus } from "./loading-page.js";

// This file is the core sample path:
// 1. define the local Parquet files,
// 2. create the active ArcGIS ParquetLayer,
// 3. let forecast-extras.js wire the optional UI around it.
const parquetHeadReady = prepareGitHubPagesParquetHead();

const [Map, ParquetLayer, GeometryEncodingWkb, ParquetFilesData, reactiveUtils, centroidOperator] = await $arcgis.import([
  "@arcgis/core/Map.js",
  "@arcgis/core/layers/ParquetLayer.js",
  "@arcgis/core/layers/support/GeometryEncodingWkb.js",
  "@arcgis/core/layers/support/ParquetFilesData.js",
  "@arcgis/core/core/reactiveUtils.js",
  "@arcgis/core/geometry/operators/centroidOperator.js",
]);

setArcgisGeometryOperators({ centroidOperator });
setArcgisReactiveUtils(reactiveUtils);

// Each option points to one generated Parquet file. The files share the same
// weather fields and forecast hours, but expose different geometry shapes.
const geometries = {
  hex: {
    label: "Hexagon",
    path: "./data/meteoswiss_surface-hex-128x72_all-points_48h.parquet",
    geometryType: "polygon",
    opacity: 0.66,
  },
  square: {
    label: "Polygon",
    path: "./data/meteoswiss_surface-square-128x72_all-points_48h.parquet",
    geometryType: "polygon",
    opacity: 0.62,
  },
  points: {
    label: "Raw points",
    path: "./data/meteoswiss_points_all-points_48h.parquet",
    geometryType: "point",
    opacity: 0.8,
  },
};

// Forecast columns exposed in the field picker, renderer, popup, and hover card.
const fields = {
  tre200h0: { label: "Temperature 2 m", unit: "°C" },
  rp0003i0: { label: "Precipitation probability (3 h)", unit: "%" },
  rre150h0: { label: "Hourly precipitation", unit: "mm" },
  fu3010h0: { label: "Wind speed", unit: "km/h" },
  nprolohs: { label: "Low cloud cover", unit: "%" },
  npromths: { label: "Medium cloud cover", unit: "%" },
  nprohihs: { label: "High cloud cover", unit: "%" },
};

const attribution = {
  points: "Source: MeteoSwiss",
  surface: "Source: MeteoSwiss; © Data: swisstopo",
};
const mapElement = document.querySelector("#map");
const status = document.querySelector("#status");

mapElement.map = new Map({
  basemap: "gray-vector",
});

const state = {
  geometryKey: "hex",
  geometry: geometries.hex,
  infoMode: "hover",
  infoPinned: false,
  layer: null,
  parquetBytes: null,
  selectedEpoch: null,
  selectedField: "tre200h0",
  sidecar: null,
};

const geometryLayerCache = new globalThis.Map();
const geometryLayerRequests = new globalThis.Map();
const geometryLayerViewRequests = new globalThis.Map();
const preloadStartDelayMs = 3000;
const preloadIdleWindowMs = 1500;
let lastUserInteractionAt = 0;

function setStatus(message, kind = "brand", open = true) {
  status.kind = kind;
  status.hidden = !open;
  status.open = open;
  status.querySelector("[slot='message']").textContent = message;
}

// The time slider updates this SQL expression so ParquetLayer shows one
// forecast hour at a time.
function validTimeWhere(epochSeconds) {
  const iso = new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
  return `valid_time = '${iso}'`;
}

function nearestEpochToDate(epochs, date = new Date()) {
  const targetMs = date.getTime();

  return epochs.reduce((nearest, epochSeconds) =>
    Math.abs(epochSeconds * 1000 - targetMs) < Math.abs(nearest * 1000 - targetMs) ? epochSeconds : nearest,
  );
}

function urlsForGeometry(geometry) {
  const parquetUrl = new URL(geometry.path, window.location.href).toString();
  const sidecarUrl = parquetUrl.replace(".parquet", ".arcgis-timeinfo.json");

  return { parquetUrl, sidecarUrl };
}

function versionedParquetUrl(parquetUrl, sidecar) {
  const generatedAt = sidecar?.generated_at;

  if (!generatedAt) {
    return parquetUrl;
  }

  const url = new URL(parquetUrl);
  url.searchParams.set("v", generatedAt);

  return url.toString();
}

function expandedExtent(extent, factor = 1.08) {
  const xmin = extent?.xmin ?? extent?.west;
  const ymin = extent?.ymin ?? extent?.south;
  const xmax = extent?.xmax ?? extent?.east;
  const ymax = extent?.ymax ?? extent?.north;

  if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) {
    return null;
  }

  const widthPadding = ((xmax - xmin) * (factor - 1)) / 2;
  const heightPadding = ((ymax - ymin) * (factor - 1)) / 2;

  return {
    spatialReference: { wkid: 4326 },
    type: "extent",
    xmax: xmax + widthPadding,
    xmin: xmin - widthPadding,
    ymax: ymax + heightPadding,
    ymin: ymin - heightPadding,
  };
}

function sidecarExtent(sidecar) {
  return expandedExtent(sidecar?.surface_resolution?.extent ?? sidecar?.point_extent ?? sidecar?.extent);
}

async function readParquetByteSize(parquetUrl) {
  const response = await fetch(parquetUrl, { method: "HEAD", cache: "no-cache" }).catch(() => null);
  const contentLength = response?.headers.get("Content-Length");
  const byteSize = Number(contentLength);

  return Number.isFinite(byteSize) && byteSize > 0 ? byteSize : null;
}

async function readGeometrySource(geometry) {
  const { parquetUrl, sidecarUrl } = urlsForGeometry(geometry);
  const [sidecar, parquetBytes] = await Promise.all([
    fetch(sidecarUrl, { cache: "no-cache" }).then((response) => response.json()),
    readParquetByteSize(parquetUrl),
  ]);

  return {
    layerParquetUrl: versionedParquetUrl(parquetUrl, sidecar),
    parquetBytes,
    sidecar,
  };
}

function geometryEncodingFor(geometry) {
  const options = { field: "geometry" };

  if (geometry.geometryType === "polygon") {
    options.orientation = "counter-clockwise";
  }

  return new GeometryEncodingWkb(options);
}

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

function popupDisplayValue(value, unit = "") {
  if (value == null || value === "") {
    return "";
  }

  const numberValue = Number(value);

  if (Number.isFinite(numberValue)) {
    const formatted = formatMeasurementNumber(numberValue);
    return `${formatted} ${unit}`.trim();
  }

  return String(value);
}

function appendPopupDisplayValue(cell, row) {
  const primaryValue = popupDisplayValue(row.value, row.unit);
  const secondaryValue = secondaryTemperatureText(row.fieldName, row.value);
  const primary = document.createElement("span");

  primary.textContent = primaryValue;
  cell.append(primary);

  if (secondaryValue) {
    const secondary = document.createElement("span");
    secondary.className = "temperature-secondary-value";
    secondary.textContent = ` - ${secondaryValue}`;
    cell.append(secondary);
  }
}

function popupContentFor(fieldName, geometry) {
  const field = fields[fieldName];
  const placeFields = geometry.geometryType === "point"
    ? [
        { fieldName: "name", label: "Place" },
        { fieldName: "station_abbr", label: "Station" },
        { fieldName: "postal_code", label: "Postal code" },
        { fieldName: "altitude_m", label: "Altitude m" },
      ]
    : [
        { fieldName: "nearby_name", label: "Nearby place" },
        { fieldName: "nearby_station_abbr", label: "Nearby station" },
        { fieldName: "nearby_postal_code", label: "Nearby postal code" },
      ];

  return ({ graphic }) => {
    const attributes = graphic?.attributes ?? {};
    const rows = [
      { label: "Forecast time", value: formatSwissFeatureTime(attributes) },
      { fieldName, label: field.label, unit: field.unit, value: attributes[fieldName] },
      ...placeFields.map((placeField) => ({
        label: placeField.label,
        value: attributes[placeField.fieldName],
      })),
    ].filter((row) => popupDisplayValue(row.value, row.unit) !== "");

    const table = document.createElement("table");
    table.className = "esri-widget__table";

    for (const row of rows) {
      const tableRow = document.createElement("tr");
      const labelCell = document.createElement("th");
      const valueCell = document.createElement("td");

      labelCell.textContent = row.label;
      appendPopupDisplayValue(valueCell, row);
      tableRow.append(labelCell, valueCell);
      table.append(tableRow);
    }

    return table;
  };
}

function popupTemplateFor(fieldName, geometry = state.geometry) {
  const field = fields[fieldName];

  return {
    title: field.label,
    content: popupContentFor(fieldName, geometry),
  };
}

function configureForecastLayer(layer, geometry) {
  const field = fields[state.selectedField];

  layer.title = field.label;
  layer.opacity = geometry.opacity;
  layer.popupEnabled = state.infoMode === "popup";
  layer.popupTemplate = popupTemplateFor(state.selectedField, geometry);
  layer.renderer = rendererForField(state.selectedField, geometry.geometryType, field.label);
  layer.definitionExpression = validTimeWhere(state.selectedEpoch);
}

// Core ArcGIS sample: load one Parquet URL, declare the WKB geometry column, and
// apply the current renderer/popup configuration.
function createForecastLayer(geometry, parquetUrl) {
  const layer = new ParquetLayer({
    title: fields[state.selectedField].label,
    copyright: geometry.geometryType === "point" ? attribution.points : attribution.surface,
    data: new ParquetFilesData({ urls: [parquetUrl] }),
    geometryEncoding: geometryEncodingFor(geometry),
    geometryType: geometry.geometryType,
    opacity: geometry.opacity,
    outFields: ["*"],
    popupEnabled: state.infoMode === "popup",
    popupTemplate: popupTemplateFor(state.selectedField, geometry),
    renderer: rendererForField(state.selectedField, geometry.geometryType, fields[state.selectedField].label),
    spatialReference: { wkid: 4326 },
  });

  configureForecastLayer(layer, geometry);
  return layer;
}

async function ensureGeometryLayer(geometryKey) {
  const geometry = geometries[geometryKey];

  if (!geometry) {
    throw new Error(`Unknown geometry: ${geometryKey}`);
  }

  if (geometryLayerCache.has(geometryKey)) {
    return geometryLayerCache.get(geometryKey);
  }

  if (geometryLayerRequests.has(geometryKey)) {
    return geometryLayerRequests.get(geometryKey);
  }

  const request = (async () => {
    const { layerParquetUrl, parquetBytes, sidecar } = await readGeometrySource(geometry);
    const epochs = sidecar.timeInfo.epochSeconds;

    if (!state.selectedEpoch || !epochs.includes(state.selectedEpoch)) {
      state.selectedEpoch = nearestEpochToDate(epochs);
    }

    const layer = createForecastLayer(geometry, layerParquetUrl);
    const entry = { geometry, layer, layerParquetUrl, parquetBytes, sidecar };

    await layer.load();
    geometryLayerCache.set(geometryKey, entry);

    return entry;
  })();

  geometryLayerRequests.set(geometryKey, request);

  try {
    return await request;
  } catch (error) {
    geometryLayerCache.delete(geometryKey);
    throw error;
  } finally {
    geometryLayerRequests.delete(geometryKey);
  }
}

function mapHasLayer(layer) {
  return mapElement.map.layers.toArray().includes(layer);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function noteUserInteraction() {
  lastUserInteractionAt = performance.now();
}

function setLayerActive(entry, active) {
  const { geometry, layer } = entry;

  layer.visible = active;
  layer.opacity = active ? geometry.opacity : 0;
  layer.popupEnabled = active && state.infoMode === "popup";
  layer.legendEnabled = active;
  layer.listMode = active ? "show" : "hide";
}

function setLayerDormant(entry) {
  const { layer } = entry;

  layer.visible = true;
  layer.opacity = 0;
  layer.popupEnabled = false;
  layer.legendEnabled = false;
  layer.listMode = "hide";
}

function setLayerPreparing(layer) {
  layer.visible = true;
  layer.opacity = 0;
  layer.popupEnabled = false;
  layer.legendEnabled = false;
  layer.listMode = "hide";
}

function deactivateInactiveGeometryLayers(activeLayer) {
  for (const cachedEntry of geometryLayerCache.values()) {
    if (cachedEntry.layer !== activeLayer && mapHasLayer(cachedEntry.layer)) {
      setLayerDormant(cachedEntry);
    }
  }
}

function syncCachedGeometryLayers(options = {}) {
  const updateStyle = options.style !== false;
  const expression = state.selectedEpoch ? validTimeWhere(state.selectedEpoch) : null;

  for (const cachedEntry of geometryLayerCache.values()) {
    const { geometry, layer } = cachedEntry;

    if (updateStyle) {
      configureForecastLayer(layer, geometry);
    } else if (expression) {
      layer.definitionExpression = expression;
    }

    if (layer === state.layer) {
      setLayerActive(cachedEntry, true);
    } else if (mapHasLayer(layer)) {
      setLayerDormant(cachedEntry);
    }
  }

  syncActiveLegendLayer(state.layer);
}

function syncActiveLegendLayer(activeLayer) {
  const legendElement = document.querySelector("#map-legend");

  if (legendElement) {
    legendElement.layerInfos = activeLayer ? [{ layer: activeLayer }] : [];
  }
}

async function crossfadeToLayer(previousLayer, nextLayer, nextOpacity) {
  if (!previousLayer || previousLayer === nextLayer || !mapHasLayer(previousLayer)) {
    nextLayer.opacity = nextOpacity;
    return;
  }

  const previousOpacity = Number.isFinite(previousLayer.opacity) ? previousLayer.opacity : 1;
  const durationMs = 180;

  await new Promise((resolve) => {
    const startedAt = performance.now();

    const step = (timestamp) => {
      const progress = Math.min(1, (timestamp - startedAt) / durationMs);
      nextLayer.opacity = nextOpacity * progress;
      previousLayer.opacity = previousOpacity * (1 - progress);

      if (progress < 1) {
        window.requestAnimationFrame(step);
        return;
      }

      resolve();
    };

    window.requestAnimationFrame(step);
  });
}

async function activateGeometry(geometryKey) {
  const entry = await ensureGeometryLayer(geometryKey);
  const { geometry, layer: nextLayer, parquetBytes, sidecar } = entry;
  const epochs = sidecar.timeInfo.epochSeconds;
  const previousLayer = state.layer;
  const smoothSwitch = Boolean(previousLayer && previousLayer !== nextLayer);

  if (!state.selectedEpoch || !epochs.includes(state.selectedEpoch)) {
    state.selectedEpoch = nearestEpochToDate(epochs);
  }

  configureForecastLayer(nextLayer, geometry);

  if (smoothSwitch) {
    setLayerPreparing(nextLayer);
  }

  if (!mapHasLayer(nextLayer)) {
    mapElement.map.add(nextLayer);
  }

  state.geometryKey = geometryKey;
  state.geometry = geometry;
  state.infoPinned = false;
  state.layer = nextLayer;
  state.parquetBytes = parquetBytes;
  state.sidecar = sidecar;

  if (!smoothSwitch) {
    setLayerActive(entry, true);
    syncActiveLegendLayer(nextLayer);
  }

  const targetExtent = sidecarExtent(sidecar) ?? expandedExtent(nextLayer.fullExtent);

  if (!smoothSwitch && targetExtent) {
    await mapElement.view.goTo(targetExtent, { animate: false }).catch(() => undefined);
  }

  await waitForGeometryLayerView(geometryKey, nextLayer);
  await waitForViewIdle();

  if (smoothSwitch) {
    nextLayer.popupEnabled = state.infoMode === "popup";
    nextLayer.legendEnabled = true;
    nextLayer.listMode = "show";
    syncActiveLegendLayer(nextLayer);
    await crossfadeToLayer(previousLayer, nextLayer, geometry.opacity);
  }

  deactivateInactiveGeometryLayers(nextLayer);
  setStatus("", "success", false);
}

// Swap the active Parquet file while preserving the selected forecast time when possible.
async function loadGeometry(geometryKey) {
  const geometry = geometries[geometryKey];

  if (!geometry) {
    throw new Error(`Unknown geometry: ${geometryKey}`);
  }

  setStatus(`Loading ${geometry.label}`);
  setLoadingPageStatus(`Loading ${geometry.label}`, "72%");
  await activateGeometry(geometryKey);
}

async function waitForMapView() {
  await customElements.whenDefined("arcgis-map");
  await mapElement.componentOnReady?.();
  await mapElement.viewOnReady?.();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (mapElement.view?.map) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  throw new Error("ArcGIS MapView is not ready.");
}

async function waitForViewIdle() {
  const view = mapElement.view;

  if (!view) {
    return false;
  }

  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (!view.updating) {
      return true;
    }

    await delay(100);
  }

  return false;
}

async function waitForLayerViewIdle(layer) {
  const layerView = await mapElement.view.whenLayerView(layer);

  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (!layerView.updating && !layerView.dataUpdating) {
      return true;
    }

    await delay(100);
  }

  return false;
}

async function waitForGeometryLayerView(geometryKey, layer) {
  if (geometryLayerViewRequests.has(geometryKey)) {
    return geometryLayerViewRequests.get(geometryKey);
  }

  const request = waitForLayerViewIdle(layer).finally(() => {
    geometryLayerViewRequests.delete(geometryKey);
  });

  geometryLayerViewRequests.set(geometryKey, request);
  return request;
}

async function preloadResidentGeometry(geometryKey) {
  const entry = await ensureGeometryLayer(geometryKey);

  if (entry.layer === state.layer) {
    return entry;
  }

  configureForecastLayer(entry.layer, entry.geometry);
  setLayerDormant(entry);

  if (!mapHasLayer(entry.layer)) {
    mapElement.map.add(entry.layer);
  }

  await waitForGeometryLayerView(geometryKey, entry.layer);

  if (entry.layer !== state.layer && mapHasLayer(entry.layer)) {
    setLayerDormant(entry);
  }

  return entry;
}

async function preloadInactiveGeometries() {
  if (state.layer) {
    const activeLayerIsReady = await waitForLayerViewIdle(state.layer).catch(() => false);

    if (!activeLayerIsReady) {
      return;
    }
  }

  const viewIsIdle = await waitForViewIdle();

  if (!viewIsIdle) {
    return;
  }

  for (const geometryKey of Object.keys(geometries)) {
    if (geometryKey !== state.geometryKey) {
      await waitForPreloadIdleWindow();
      await preloadResidentGeometry(geometryKey).catch(() => null);
    }
  }
}

async function waitForPreloadIdleWindow() {
  while (performance.now() - lastUserInteractionAt < preloadIdleWindowMs) {
    await delay(250);
  }

  await new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(resolve, { timeout: 1500 });
      return;
    }

    window.setTimeout(resolve, 250);
  });
}

async function scheduleInactiveGeometryPreload() {
  lastUserInteractionAt = performance.now();
  await delay(preloadStartDelayMs);
  await preloadInactiveGeometries();
}

state.syncGeometryLayers = syncCachedGeometryLayers;

async function start() {
  setLoadingPageStatus("Preparing ArcGIS view...", "34%");

  await waitForMapView();
  setLoadingPageStatus("Preparing hosted Parquet data...", "52%");
  await parquetHeadReady;
  setLoadingPageStatus("Loading forecast layer...", "68%");

  const controls = setupSampleControls({
    fields,
    formatTime: formatSwissForecastHour,
    geometries,
    loadGeometry,
    mapElement,
    popupTemplateFor,
    rendererForField,
    setStatus,
    state,
    validTimeWhere,
  });

  await loadGeometry(state.geometryKey);
  controls.syncLayer();
  for (const eventName of ["pointermove", "pointerdown", "wheel", "keydown"]) {
    window.addEventListener(eventName, noteUserInteraction, { capture: true, passive: true });
  }
  completeLoadingPage();
  void scheduleInactiveGeometryPreload();
}

start().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Forecast layer failed to load";
  setStatus(message, "danger");
  failLoadingPage(message);
});
