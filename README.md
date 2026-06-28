# ArcGIS ParquetLayer with MeteoSwiss Forecasts

This is a small ArcGIS Maps SDK for JavaScript 5.1 prototype that loads MeteoSwiss Open Data from Apache Parquet files directly in the browser.

[Open the live app](https://ceddc.github.io/arcgis-js-parquet-weather/)

The app uses MeteoSwiss E4 local forecasts: hourly weather values for about 6,000 locations in Switzerland, including temperature, precipitation, wind, and cloud cover. The data is converted to Parquet with Python, hosted as static files, and displayed with `ParquetLayer`.

## The idea

This project is a practical test of a simple pattern:

```text
Open data snapshots
-> Python download and parsing
-> pyarrow writes Apache Parquet
-> shapely prepares derived geometries
-> ArcGIS Maps SDK for JavaScript loads the files with ParquetLayer
```

The result is a static forecast explorer that can step through time and switch between raw points, square cells, and hexagons. The same approach can fit open data portals, forecast snapshots, generated model outputs, and read-only layers that are refreshed on a schedule.

## Start with these files

- `index.html` is the Calcite and ArcGIS web-component shell.
- `js/app.js` is the core ArcGIS `ParquetLayer` setup.
- `js/forecast-extras.js` contains the renderers, legend, time controls, hover cards, and popups.
- `python/scripts/refresh_sample_data.py` refreshes the generated sample data.
- `docs/data-generation-workflow.md` explains the data parsing and Parquet export.

If you only want the ArcGIS loading pattern, start with `js/app.js`.

## Load Parquet in ArcGIS Maps SDK

The important part is small: create a `ParquetLayer`, point it at a Parquet URL, and describe the WKB geometry column.

```js
const layer = new ParquetLayer({
  data: new ParquetFilesData({ urls: [parquetUrl] }),
  geometryEncoding: new GeometryEncodingWkb({
    field: "geometry",
    orientation: "counter-clockwise",
  }),
  geometryType: "polygon",
  spatialReference: { wkid: 4326 },
  outFields: ["*"],
});

layer.definitionExpression = "valid_time = '2026-06-28T11:00:00Z'";
```

In this app, `definitionExpression` selects one forecast hour at a time. A small `.arcgis-timeinfo.json` sidecar provides the UI with forecast times, labels, value ranges, source links, and feature counts. The ArcGIS layer itself reads the Parquet file.

## Build the same kind of app

1. Start with a dataset that can be represented as points, lines, or polygons.
2. Write an Apache Parquet file with a `geometry` column encoded as WKB.
3. Add GeoParquet metadata so the geometry column is explicit.
4. Host the Parquet file over HTTP with the rest of the static app.
5. Load it with `ParquetLayer` and `ParquetFilesData`.
6. Use attributes such as `valid_time`, category, model run, or scenario ID in `definitionExpression` when the app needs filtering.

## Data files

- `data/meteoswiss_points_all-points_48h.parquet` contains direct MeteoSwiss forecast points.
- `data/meteoswiss_surface-square-128x72_all-points_48h.parquet` contains a derived square-cell visualization.
- `data/meteoswiss_surface-hex-128x72_all-points_48h.parquet` contains a derived hexagon visualization.

The square and hexagon files are derived visualization layers, not MeteoSwiss gridded forecast products.

## Run locally

Serve the repository root over HTTP. Do not open `index.html` as a `file://` URL.

```powershell
npx vite --host 0.0.0.0 --port 3107
```

Open `http://localhost:3107/`.

Vite is only used as a local static server. The published app has no Vite config, package.json, bundling step, or npm dependency tree.

## Refresh the data

Point-only refresh:

```powershell
uv run --project python python/scripts/refresh_sample_data.py --force
```

Full demo refresh with point, square, and hexagon files:

```powershell
uv run --project python python/scripts/refresh_sample_data.py --geometry all --force
```

GitHub Actions runs the full refresh every six hours before deploying GitHub Pages:

```powershell
uv run --project python python/scripts/refresh_sample_data.py --geometry all --max-age-hours 6
```

## Source data

- [MeteoSwiss Open Data catalog](https://data.geo.admin.ch/browser/index.html#/collections/ch.meteoschweiz.ogd-local-forecasting)
- [E4 local forecast documentation](https://opendatadocs.meteoswiss.ch/e-forecast-data/e4-local-forecast-data)
- [FSDI STAC collection](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting)
- [MeteoSwiss Open Data terms](https://opendatadocs.meteoswiss.ch/general/terms-of-use)

## Attribution and license

Project code is released under the MIT License. See `LICENSE`.

The generated data is derived from [MeteoSwiss Open Data](https://www.meteoswiss.admin.ch/services-and-publications/service/open-data.html), published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) according to the [MeteoSwiss terms of use](https://opendatadocs.meteoswiss.ch/general/terms-of-use). When reproducing or redistributing the meteorological data, cite: `Source: MeteoSwiss`.

The square and hexagon surfaces also use the Swiss boundary from FSDI/swisstopo for clipping. When publishing those surfaces, cite: `Source: MeteoSwiss; © Data: swisstopo`.

This app sets those notices with `ParquetLayer.copyright`, so they appear in the ArcGIS map attribution control.

## References

- [ArcGIS ParquetLayer sample](https://developers.arcgis.com/javascript/latest/sample-code/layers-parquetlayer/)
- [ArcGIS ParquetLayer API](https://developers.arcgis.com/javascript/latest/references/core/layers/ParquetLayer/)
- [ArcGIS ParquetFilesData API](https://developers.arcgis.com/javascript/latest/references/core/layers/support/ParquetFilesData/)
- [Esri blog: Parquet feature layer beta in ArcGIS Online](https://www.esri.com/arcgis-blog/products/arcgis-online/announcements/scaling-your-gis-workflows-with-the-new-parquet-feature-layer-beta-in-arcgis-online)
- [Apache Parquet](https://parquet.apache.org/)
- [GeoParquet 1.1.0](https://geoparquet.org/releases/v1.1.0/)
