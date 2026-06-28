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
// 2. create one ArcGIS ParquetLayer,
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

async function readParquetByteSize(parquetUrl) {
  const response = await fetch(parquetUrl, { method: "HEAD", cache: "no-cache" }).catch(() => null);
  const contentLength = response?.headers.get("Content-Length");
  const byteSize = Number(contentLength);

  return Number.isFinite(byteSize) && byteSize > 0 ? byteSize : null;
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

  layer.definitionExpression = validTimeWhere(state.selectedEpoch);
  return layer;
}

// Swap the active Parquet file while preserving the selected forecast time when possible.
async function loadGeometry(geometryKey) {
  const geometry = geometries[geometryKey];

  if (!geometry) {
    throw new Error(`Unknown geometry: ${geometryKey}`);
  }

  setStatus(`Loading ${geometry.label}`);
  setLoadingPageStatus(`Loading ${geometry.label}`, "72%");

  const { parquetUrl, sidecarUrl } = urlsForGeometry(geometry);
  const [sidecar, parquetBytes] = await Promise.all([
    fetch(sidecarUrl, { cache: "no-cache" }).then((response) => response.json()),
    readParquetByteSize(parquetUrl),
  ]);
  const layerParquetUrl = versionedParquetUrl(parquetUrl, sidecar);
  const epochs = sidecar.timeInfo.epochSeconds;

  if (!state.selectedEpoch || !epochs.includes(state.selectedEpoch)) {
    state.selectedEpoch = nearestEpochToDate(epochs);
  }

  const nextLayer = createForecastLayer(geometry, layerParquetUrl);
  const previousLayer = state.layer;

  await nextLayer.load();
  mapElement.map.add(nextLayer);

  state.geometryKey = geometryKey;
  state.geometry = geometry;
  state.infoPinned = false;
  state.layer = nextLayer;
  state.parquetBytes = parquetBytes;
  state.sidecar = sidecar;

  if (previousLayer) {
    mapElement.map.remove(previousLayer);
  }

  const queriedExtent = nextLayer.fullExtent ? null : await nextLayer.queryExtent().catch(() => null);
  const targetExtent = nextLayer.fullExtent ?? queriedExtent?.extent;

  if (targetExtent) {
    await mapElement.view.goTo(targetExtent.expand(1.08), { animate: false }).catch(() => undefined);
  }

  setStatus("", "success", false);
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
  completeLoadingPage();
}

start().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Forecast layer failed to load";
  setStatus(message, "danger");
  failLoadingPage(message);
});
