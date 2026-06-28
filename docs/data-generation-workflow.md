# MeteoSwiss Forecast Data Generation

This page documents the Python workflow that creates the Parquet files used by the sample app.

## Outputs

Default point output:

- `data/meteoswiss_points_all-points_48h.parquet`

Optional visualization outputs:

- `data/meteoswiss_surface-square-128x72_all-points_48h.parquet`
- `data/meteoswiss_surface-hex-128x72_all-points_48h.parquet`

Each Parquet file has an `.arcgis-timeinfo.json` sidecar used by the app for time steps, field labels, value ranges, source links, and feature counts. The sidecar is not part of the Parquet format.

## Source Inputs

- MeteoSwiss E4 local forecast documentation: `https://opendatadocs.meteoswiss.ch/e-forecast-data/e4-local-forecast-data`
- Swiss federal STAC API: `https://data.geo.admin.ch/api/stac/v1`
- Forecast collection: `ch.meteoschweiz.ogd-local-forecasting`
- Point metadata CSV: `https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/ogd-local-forecasting_meta_point.csv`
- Swiss boundary GeoJSON: `data/swiss-boundary-ch.geojson`

The Swiss boundary file is used only when generating square or hexagon surfaces.

## Parquet Geometry

The generated files store geometry as WKB in a `geometry` column. GeoParquet metadata is written in the Parquet footer under the `geo` metadata key.

Point file geometry metadata:

| Metadata field | Value |
| --- | --- |
| GeoParquet version | `1.1.0` |
| Primary geometry column | `geometry` |
| Geometry encoding | `WKB` |
| Geometry type | `Point` |
| CRS | WGS84 longitude/latitude |

Surface files use WKB polygon geometry and include polygon orientation metadata. The JavaScript sample reads these files with `GeometryEncodingWkb`.

## Point Data Flow

1. Read the MeteoSwiss point metadata CSV.
2. Query the STAC collection for the latest E4 forecast item.
3. Select CSV assets for the configured weather parameters.
4. Parse forecast rows and join them to point metadata.
5. Convert forecast times to UTC `valid_time` values.
6. Write one row per point and forecast time with WKB point geometry.
7. Write the `.arcgis-timeinfo.json` sidecar for the sample UI.

The sample keeps 6 recent hours plus a 48 hour forecast horizon.

## Surface Data Flow

Square and hexagon files are derived from the same MeteoSwiss point forecasts:

1. Create a regular square or hexagon grid over Switzerland.
2. Clip cells to the Swiss boundary with Shapely.
3. Find nearby forecast points for each cell.
4. Write weighted values for each cell and forecast time.
5. Write WKB polygon geometry and GeoParquet metadata.

These surfaces are derived visualization layers, not MeteoSwiss gridded forecast products.

## Scripts

- `python/scripts/refresh_sample_data.py` checks freshness and runs the exporter.
- `python/scripts/meteoswiss_to_geoparquet.py` writes the point or surface Parquet files.
- `python/scripts/meteoswiss_forecast_source.py` handles STAC discovery, CSV parsing, metadata joins, and shared weighting helpers.

## Commands

Point-only refresh:

```powershell
uv run --project python python/scripts/refresh_sample_data.py --force
```

Full demo refresh:

```powershell
uv run --project python python/scripts/refresh_sample_data.py --geometry all --force
```

GitHub Pages runs the full refresh every six hours before deployment:

```powershell
uv run --project python python/scripts/refresh_sample_data.py --geometry all --max-age-hours 6
```

The refresh script regenerates files that are missing, incomplete, forced, or older than the configured freshness window.

## Dependencies

- `pyarrow` writes Parquet files and footer metadata.
- `shapely` is used for optional square and hexagon surface generation.
- `numpy` is present because Shapely depends on it.

The project writes WKB geometry directly and does not require GeoPandas.
