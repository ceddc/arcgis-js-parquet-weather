#!/usr/bin/env python3
"""Export MeteoSwiss E4 local forecasts to ArcGIS-compatible Parquet.

The default output is a direct point Parquet file: one MeteoSwiss local forecast
point per row and no surface interpolation. Surface outputs are optional derived
visualization grids computed by this sample.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import shutil
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ModuleNotFoundError as error:
    raise SystemExit(
        "pyarrow is required to write Parquet. Install dependencies with "
        "`python -m pip install pyarrow` or use the python/pyproject.toml environment."
    ) from error

from meteoswiss_forecast_source import (
    DEFAULT_SURFACE_COLUMNS,
    DEFAULT_SURFACE_ROWS,
    DEFAULT_SURFACE_SHAPE,
    ForecastRecord,
    POINT_TYPE_LABELS,
    PARAMETERS,
    SURFACE_CLIP_MODE,
    SURFACE_EXTENT,
    SWISS_BOUNDARY_LAYER_ID,
    SWISS_BOUNDARY_LOCAL_PATH,
    SWISS_BOUNDARY_SOURCE_ATTRIBUTION,
    SWISS_BOUNDARY_TERMS_URL,
    SWISS_BOUNDARY_URL,
    PointMetadata,
    create_surface_cells_from_points,
    discover_latest_asset,
    fetch_forecast_asset_text,
    fetch_point_metadata_text,
    iso_utc,
    load_swiss_boundary,
    parse_forecast_records,
    parse_now,
    parse_point_metadata,
    surface_cell_rings,
)

PARAMETER_IDS = (
    "tre200h0",
    "rp0003i0",
    "rre150h0",
    "fu3010h0",
    "nprolohs",
    "npromths",
    "nprohihs",
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
GEO_PARQUET_VERSION = "1.1.0"
METEOSWISS_OPEN_DATA_URL = "https://www.meteoswiss.admin.ch/services-and-publications/service/open-data.html"
METEOSWISS_DOCUMENTATION_URL = "https://opendatadocs.meteoswiss.ch/e-forecast-data/e4-local-forecast-data"
METEOSWISS_TERMS_URL = "https://opendatadocs.meteoswiss.ch/general/terms-of-use"
METEOSWISS_LICENSE = "CC BY 4.0"
METEOSWISS_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
METEOSWISS_SOURCE_ATTRIBUTION = "Source: MeteoSwiss"
RESOLUTION_REFERENCE_LATITUDE = 46.85


def little_endian_polygon_wkb(rings: tuple[tuple[tuple[float, float], ...], ...]) -> bytes:
    payload = bytearray()
    payload.extend(struct.pack("<BII", 1, 3, len(rings)))

    for ring in rings:
        payload.extend(struct.pack("<I", len(ring)))

        for longitude, latitude in ring:
            payload.extend(struct.pack("<dd", longitude, latitude))

    return bytes(payload)


def little_endian_point_wkb(longitude: float, latitude: float) -> bytes:
    return struct.pack("<BIdd", 1, 1, longitude, latitude)


def write_gzip_copy(path: Path) -> None:
    gzip_path = path.with_name(f"{path.name}.gz")
    with path.open("rb") as source, gzip.open(gzip_path, "wb", compresslevel=6) as target:
        shutil.copyfileobj(source, target, length=1024 * 1024)


def write_json(path: Path, data: dict[str, Any], pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(
            data,
            output,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
        output.write("\n")
    write_gzip_copy(path)


def records_by_time(records: list[ForecastRecord]) -> dict[datetime, dict[str, float]]:
    grouped: dict[datetime, dict[str, float]] = {}

    for record in records:
        grouped.setdefault(record.valid_time, {})[record.source_key] = record.value

    return grouped


def weighted_surface_value(
    values: dict[str, float],
    neighbors: tuple[tuple[str, float], ...],
    decimals: int,
) -> tuple[float | None, int]:
    """Blend nearby MeteoSwiss point values for one derived surface cell.

    The neighbor weights are normalized inverse-distance weights. The returned
    sample count is how many nearby points had a value for this parameter and
    forecast time.
    """
    weighted_value = 0.0
    weight_total = 0.0
    samples = 0

    for source_key, weight in neighbors:
        value = values.get(source_key)

        if value is None:
            continue

        weighted_value += value * weight
        weight_total += weight
        samples += 1

    if samples == 0 or weight_total == 0:
        return None, 0

    return round(weighted_value / weight_total, decimals), samples


def nearest_neighbor_source_key(neighbors: tuple[tuple[str, float], ...]) -> str | None:
    if not neighbors:
        return None

    return max(neighbors, key=lambda item: item[1])[0]


def display_point_label(point: PointMetadata | None) -> str | None:
    if point is None:
        return None

    for label in (point.name, point.station_abbr, point.postal_code):
        normalized = label.strip() if label else ""

        if normalized:
            return normalized

    return None


def nearby_point_labels(
    cell_neighbors: tuple[tuple[str, float], ...],
    points: dict[str, PointMetadata],
    limit: int = 2,
) -> str | None:
    labels: list[str] = []
    seen: set[str] = set()

    for source_key, _weight in sorted(cell_neighbors, key=lambda item: item[1], reverse=True):
        label = display_point_label(points.get(source_key))

        if label is None:
            continue

        key = label.casefold()

        if key in seen:
            continue

        labels.append(label)
        seen.add(key)

        if len(labels) >= limit:
            break

    return " / ".join(labels) if labels else None


def nearby_point_attributes(
    cell_neighbors: tuple[tuple[str, float], ...],
    points: dict[str, PointMetadata],
) -> dict[str, str | None]:
    source_key = nearest_neighbor_source_key(cell_neighbors)
    point = points.get(source_key) if source_key else None

    return {
        "nearby_source_key": source_key,
        "nearby_station_abbr": point.station_abbr if point else None,
        "nearby_name": point.name if point else None,
        "nearby_names": nearby_point_labels(cell_neighbors, points),
        "nearby_postal_code": point.postal_code if point else None,
    }


def geo_metadata(bbox: list[float], geometry_type: str) -> bytes:
    # ArcGIS reads these files through GeometryEncodingWkb, so the geometry
    # column is plain WKB plus the standard `geo` metadata block.
    column_metadata: dict[str, Any] = {
        "encoding": "WKB",
        "geometry_types": [geometry_type],
        "bbox": bbox,
    }

    if geometry_type == "Polygon":
        column_metadata["orientation"] = "counterclockwise"

    metadata = {
        "version": GEO_PARQUET_VERSION,
        "primary_column": "geometry",
        "columns": {"geometry": column_metadata},
    }
    return json.dumps(metadata, separators=(",", ":")).encode("utf-8")


def time_sorting_columns(schema: pa.Schema) -> tuple[pq.SortingColumn, ...]:
    return pq.SortingColumn.from_ordering(schema, [("valid_time_epoch_s", "ascending")])


def approximate_resolution(columns: int, rows: int) -> dict[str, Any]:
    cell_width_degrees = (SURFACE_EXTENT["east"] - SURFACE_EXTENT["west"]) / columns
    cell_height_degrees = (SURFACE_EXTENT["north"] - SURFACE_EXTENT["south"]) / rows
    meters_per_degree_latitude = 111_320
    meters_per_degree_longitude = meters_per_degree_latitude * math.cos(math.radians(RESOLUTION_REFERENCE_LATITUDE))

    return {
        "extent": SURFACE_EXTENT,
        "cell_width_degrees": cell_width_degrees,
        "cell_height_degrees": cell_height_degrees,
        "reference_latitude": RESOLUTION_REFERENCE_LATITUDE,
        "approx_cell_width_m": round(cell_width_degrees * meters_per_degree_longitude),
        "approx_cell_height_m": round(cell_height_degrees * meters_per_degree_latitude),
    }


def parameter_sidecar_fields(assets: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    return {
        parameter_id: {
            "label": PARAMETERS[parameter_id]["label"],
            "unit": PARAMETERS[parameter_id]["unit"],
            "asset_id": assets[parameter_id]["asset_id"],
            "asset_href": assets[parameter_id]["asset_href"],
            "asset_updated": assets[parameter_id]["asset_updated"],
        }
        for parameter_id in PARAMETER_IDS
    }


def create_value_stats(valid_times: list[datetime]) -> dict[str, list[dict[str, Any]]]:
    return {
        parameter_id: [
            {
                "epoch": int(valid_time.timestamp()),
                "count": 0,
                "positive_count": 0,
                "max": None,
            }
            for valid_time in valid_times
        ]
        for parameter_id in PARAMETER_IDS
    }


def record_value_stat(
    value_stats: dict[str, list[dict[str, Any]]],
    parameter_id: str,
    time_index: int,
    value: float | None,
) -> None:
    if value is None:
        return

    stat = value_stats[parameter_id][time_index]
    stat["count"] += 1

    if value > 0:
        stat["positive_count"] += 1

    current_max = stat["max"]
    stat["max"] = value if current_max is None else max(current_max, value)


def base_sidecar(
    output_path: Path,
    valid_times: list[datetime],
    assets: dict[str, dict[str, str]],
    feature_count: int,
    generated_at: datetime,
    mode: str,
    forecast_horizon_hours: int,
    past_hours: int,
    value_stats: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    stops = [iso_utc(valid_time) for valid_time in valid_times]
    epoch_seconds = [int(valid_time.timestamp()) for valid_time in valid_times]

    sidecar = {
        "geoparquet": output_path.name,
        "generated_at": iso_utc(generated_at),
        "source": "MeteoSwiss Open Data E4 local forecasting",
        "source_attribution": METEOSWISS_SOURCE_ATTRIBUTION,
        "open_data_url": METEOSWISS_OPEN_DATA_URL,
        "documentation_url": METEOSWISS_DOCUMENTATION_URL,
        "terms_url": METEOSWISS_TERMS_URL,
        "license": METEOSWISS_LICENSE,
        "license_url": METEOSWISS_LICENSE_URL,
        "mode": mode,
        "point_type": "all",
        "forecast_horizon_hours": forecast_horizon_hours,
        "past_hours": past_hours,
        "horizon_hours": int((valid_times[-1] - valid_times[0]).total_seconds() / 3600) if len(valid_times) > 1 else 0,
        "feature_count": feature_count,
        "features_per_time_step": round(feature_count / len(valid_times)) if valid_times else 0,
        "parameters": parameter_sidecar_fields(assets),
        "timeInfo": {
            "startField": "valid_time_epoch_s",
            "timeZone": "UTC",
            "fullTimeExtent": {
                "start": stops[0] if stops else None,
                "end": stops[-1] if stops else None,
            },
            "stops": stops,
            "epochSeconds": epoch_seconds,
        },
    }

    if value_stats is not None:
        sidecar["value_stats"] = value_stats

    return sidecar


def value_fields() -> list[dict[str, str]]:
    return [
        {
            "name": parameter_id,
            "alias": PARAMETERS[parameter_id]["value_label"],
            "type": "double",
            "unit": PARAMETERS[parameter_id]["unit"],
        }
        for parameter_id in PARAMETER_IDS
    ]


def surface_sidecar(
    output_path: Path,
    valid_times: list[datetime],
    shape: str,
    columns: int,
    rows: int,
    assets: dict[str, dict[str, str]],
    feature_count: int,
    generated_at: datetime,
    forecast_horizon_hours: int,
    past_hours: int,
    value_stats: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    data = base_sidecar(
        output_path,
        valid_times,
        assets,
        feature_count,
        generated_at,
        "surface",
        forecast_horizon_hours,
        past_hours,
        value_stats,
    )
    data.update({
        "boundary_source": "swisstopo swissBOUNDARIES3D land area",
        "boundary_layer_id": SWISS_BOUNDARY_LAYER_ID,
        "boundary_local_file": str(SWISS_BOUNDARY_LOCAL_PATH.relative_to(PROJECT_ROOT)),
        "boundary_source_url": SWISS_BOUNDARY_URL,
        "boundary_source_attribution": SWISS_BOUNDARY_SOURCE_ATTRIBUTION,
        "boundary_terms_url": SWISS_BOUNDARY_TERMS_URL,
        "surface_shape": shape,
        "surface_columns": columns,
        "surface_rows": rows,
        "surface_clip": SURFACE_CLIP_MODE,
        "surface_resolution": approximate_resolution(columns, rows),
        "fields": [
            {"name": "geometry", "alias": "Geometry", "type": "geometry"},
            {"name": "valid_time", "alias": "Valid time ISO", "type": "string"},
            {"name": "valid_time_epoch_ms", "alias": "Valid time", "type": "integer"},
            {"name": "valid_time_epoch_s", "alias": "Valid time seconds", "type": "integer"},
            {"name": "row", "alias": "Row", "type": "integer"},
            {"name": "column", "alias": "Column", "type": "integer"},
            {"name": "surface_shape", "alias": "Surface shape", "type": "string"},
            {"name": "hex_cell_id", "alias": "Hex cell", "type": "string"},
            {"name": "center_lat", "alias": "Center latitude", "type": "double"},
            {"name": "center_lng", "alias": "Center longitude", "type": "double"},
            {"name": "nearby_source_key", "alias": "Nearby source key", "type": "string"},
            {"name": "nearby_station_abbr", "alias": "Nearby station", "type": "string"},
            {"name": "nearby_name", "alias": "Nearby name", "type": "string"},
            {"name": "nearby_names", "alias": "Nearby names", "type": "string"},
            {"name": "nearby_postal_code", "alias": "Nearby postal code", "type": "string"},
            *value_fields(),
            *[
                {"name": f"samples_{parameter_id}", "alias": f"{PARAMETERS[parameter_id]['label']} samples", "type": "integer"}
                for parameter_id in PARAMETER_IDS
            ],
        ],
    })
    return data


def point_sidecar(
    output_path: Path,
    valid_times: list[datetime],
    assets: dict[str, dict[str, str]],
    feature_count: int,
    point_count: int,
    generated_at: datetime,
    forecast_horizon_hours: int,
    past_hours: int,
    value_stats: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    data = base_sidecar(
        output_path,
        valid_times,
        assets,
        feature_count,
        generated_at,
        "points",
        forecast_horizon_hours,
        past_hours,
        value_stats,
    )
    data.update({
        "point_count": point_count,
        "fields": [
            {"name": "geometry", "alias": "Geometry", "type": "geometry"},
            {"name": "valid_time", "alias": "Valid time ISO", "type": "string"},
            {"name": "valid_time_epoch_ms", "alias": "Valid time", "type": "integer"},
            {"name": "valid_time_epoch_s", "alias": "Valid time seconds", "type": "integer"},
            {"name": "source_key", "alias": "Source key", "type": "string"},
            {"name": "point_id", "alias": "Point ID", "type": "integer"},
            {"name": "point_type_id", "alias": "Point type ID", "type": "integer"},
            {"name": "point_type_label", "alias": "Point type", "type": "string"},
            {"name": "station_abbr", "alias": "Station abbreviation", "type": "string"},
            {"name": "postal_code", "alias": "Postal code", "type": "string"},
            {"name": "name", "alias": "Name", "type": "string"},
            {"name": "altitude_m", "alias": "Altitude", "type": "double"},
            {"name": "latitude", "alias": "Latitude", "type": "double"},
            {"name": "longitude", "alias": "Longitude", "type": "double"},
            *value_fields(),
        ],
    })
    return data


def write_point_geoparquet(
    output_path: Path,
    sidecar_path: Path,
    points: dict[str, PointMetadata],
    grouped_values: dict[str, dict[datetime, dict[str, float]]],
    valid_times: list[datetime],
    assets: dict[str, dict[str, str]],
    generated_at: datetime,
    forecast_horizon_hours: int,
    past_hours: int,
    pretty: bool,
) -> None:
    point_items = sorted(points.items(), key=lambda item: (item[1].point_type_id, item[1].point_id, item[0]))

    if not point_items:
        raise SystemExit("No point metadata rows were found.")

    columns: dict[str, list[Any]] = {
        "geometry": [],
        "valid_time": [],
        "valid_time_epoch_ms": [],
        "valid_time_epoch_s": [],
        "source_key": [],
        "point_id": [],
        "point_type_id": [],
        "point_type_label": [],
        "station_abbr": [],
        "postal_code": [],
        "name": [],
        "altitude_m": [],
        "latitude": [],
        "longitude": [],
        **{parameter_id: [] for parameter_id in PARAMETER_IDS},
    }
    min_lon = min(point.longitude for _, point in point_items)
    min_lat = min(point.latitude for _, point in point_items)
    max_lon = max(point.longitude for _, point in point_items)
    max_lat = max(point.latitude for _, point in point_items)
    value_stats = create_value_stats(valid_times)
    geometry_by_source = {
        source_key: little_endian_point_wkb(point.longitude, point.latitude)
        for source_key, point in point_items
    }

    for time_index, valid_time in enumerate(valid_times):
        valid_time_epoch_s = int(valid_time.timestamp())
        valid_time_epoch_ms = valid_time_epoch_s * 1000
        valid_time_label = iso_utc(valid_time)
        values_for_time = {
            parameter_id: grouped_values[parameter_id].get(valid_time, {})
            for parameter_id in PARAMETER_IDS
        }

        for source_key, point in point_items:
            columns["geometry"].append(geometry_by_source[source_key])
            columns["valid_time"].append(valid_time_label)
            columns["valid_time_epoch_ms"].append(valid_time_epoch_ms)
            columns["valid_time_epoch_s"].append(valid_time_epoch_s)
            columns["source_key"].append(source_key)
            columns["point_id"].append(point.point_id)
            columns["point_type_id"].append(point.point_type_id)
            columns["point_type_label"].append(POINT_TYPE_LABELS.get(point.point_type_id, "unknown"))
            columns["station_abbr"].append(point.station_abbr)
            columns["postal_code"].append(point.postal_code)
            columns["name"].append(point.name)
            columns["altitude_m"].append(point.altitude)
            columns["latitude"].append(round(point.latitude, 6))
            columns["longitude"].append(round(point.longitude, 6))

            for parameter_id in PARAMETER_IDS:
                value = values_for_time[parameter_id].get(source_key)
                rounded_value = round(value, PARAMETERS[parameter_id]["decimals"]) if value is not None else None
                columns[parameter_id].append(rounded_value)
                record_value_stat(value_stats, parameter_id, time_index, rounded_value)

    schema = pa.schema([
        pa.field("geometry", pa.binary()),
        pa.field("valid_time", pa.string()),
        pa.field("valid_time_epoch_ms", pa.int64()),
        pa.field("valid_time_epoch_s", pa.int32()),
        pa.field("source_key", pa.string()),
        pa.field("point_id", pa.int32()),
        pa.field("point_type_id", pa.int8()),
        pa.field("point_type_label", pa.string()),
        pa.field("station_abbr", pa.string()),
        pa.field("postal_code", pa.string()),
        pa.field("name", pa.string()),
        pa.field("altitude_m", pa.float64()),
        pa.field("latitude", pa.float64()),
        pa.field("longitude", pa.float64()),
        *[pa.field(parameter_id, pa.float64()) for parameter_id in PARAMETER_IDS],
    ]).with_metadata({
        b"geo": geo_metadata([min_lon, min_lat, max_lon, max_lat], "Point"),
    })
    table = pa.Table.from_pydict(columns, schema=schema)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        table,
        output_path,
        compression="snappy",
        row_group_size=len(point_items),
        use_dictionary=True,
        write_statistics=True,
        write_page_index=True,
        sorting_columns=time_sorting_columns(schema),
    )
    write_json(
        sidecar_path,
        point_sidecar(
            output_path,
            valid_times,
            assets,
            table.num_rows,
            len(point_items),
            generated_at,
            forecast_horizon_hours,
            past_hours,
            value_stats,
        ),
        pretty=pretty,
    )
    print(f"Wrote {table.num_rows:,} point rows to {output_path}", file=sys.stderr)
    print(f"Wrote ArcGIS time sidecar to {sidecar_path}", file=sys.stderr)
    print(f"Points per time step: {len(point_items):,}", file=sys.stderr)


def write_surface_geoparquet(
    output_path: Path,
    sidecar_path: Path,
    points: dict[str, PointMetadata],
    grouped_values: dict[str, dict[datetime, dict[str, float]]],
    valid_times: list[datetime],
    assets: dict[str, dict[str, str]],
    generated_at: datetime,
    forecast_horizon_hours: int,
    past_hours: int,
    surface_shape: str,
    surface_columns: int,
    surface_rows: int,
    pretty: bool,
) -> None:
    print(f"Loading {surface_shape} surface geometry for {len(valid_times)} time steps...", file=sys.stderr)
    clip_boundary = load_swiss_boundary()
    cells = create_surface_cells_from_points(
        points.items(),
        surface_columns,
        surface_rows,
        surface_shape,
        clip_boundary,
    )

    if not cells:
        raise SystemExit("No surface cells were generated.")

    columns: dict[str, list[Any]] = {
        "geometry": [],
        "valid_time": [],
        "valid_time_epoch_ms": [],
        "valid_time_epoch_s": [],
        "row": [],
        "column": [],
        "surface_shape": [],
        "hex_cell_id": [],
        "center_lat": [],
        "center_lng": [],
        "nearby_source_key": [],
        "nearby_station_abbr": [],
        "nearby_name": [],
        "nearby_names": [],
        "nearby_postal_code": [],
        **{parameter_id: [] for parameter_id in PARAMETER_IDS},
        **{f"samples_{parameter_id}": [] for parameter_id in PARAMETER_IDS},
    }
    min_lon = math.inf
    min_lat = math.inf
    max_lon = -math.inf
    max_lat = -math.inf
    value_stats = create_value_stats(valid_times)
    geometry_by_cell = [little_endian_polygon_wkb(surface_cell_rings(cell)) for cell in cells]

    for cell in cells:
        for ring in surface_cell_rings(cell):
            for longitude, latitude in ring:
                min_lon = min(min_lon, longitude)
                min_lat = min(min_lat, latitude)
                max_lon = max(max_lon, longitude)
                max_lat = max(max_lat, latitude)

    for time_index, valid_time in enumerate(valid_times):
        valid_time_epoch_s = int(valid_time.timestamp())
        valid_time_epoch_ms = valid_time_epoch_s * 1000
        valid_time_label = iso_utc(valid_time)

        for cell_index, cell in enumerate(cells):
            columns["geometry"].append(geometry_by_cell[cell_index])
            columns["valid_time"].append(valid_time_label)
            columns["valid_time_epoch_ms"].append(valid_time_epoch_ms)
            columns["valid_time_epoch_s"].append(valid_time_epoch_s)
            columns["row"].append(cell.row)
            columns["column"].append(cell.column)
            columns["surface_shape"].append(cell.shape)
            columns["hex_cell_id"].append(f"u{cell.row:02d}-{cell.column:03d}" if cell.shape == "hex" else None)
            columns["center_lat"].append(round(cell.center_lat, 6))
            columns["center_lng"].append(round(cell.center_lon, 6))
            nearby = nearby_point_attributes(cell.neighbors, points)
            columns["nearby_source_key"].append(nearby["nearby_source_key"])
            columns["nearby_station_abbr"].append(nearby["nearby_station_abbr"])
            columns["nearby_name"].append(nearby["nearby_name"])
            columns["nearby_names"].append(nearby["nearby_names"])
            columns["nearby_postal_code"].append(nearby["nearby_postal_code"])

            for parameter_id in PARAMETER_IDS:
                parameter = PARAMETERS[parameter_id]
                value, samples = weighted_surface_value(
                    grouped_values[parameter_id].get(valid_time, {}),
                    cell.neighbors,
                    parameter["decimals"],
                )

                columns[parameter_id].append(value)
                columns[f"samples_{parameter_id}"].append(samples)
                record_value_stat(value_stats, parameter_id, time_index, value)

    schema = pa.schema([
        pa.field("geometry", pa.binary()),
        pa.field("valid_time", pa.string()),
        pa.field("valid_time_epoch_ms", pa.int64()),
        pa.field("valid_time_epoch_s", pa.int32()),
        pa.field("row", pa.int32()),
        pa.field("column", pa.int32()),
        pa.field("surface_shape", pa.string()),
        pa.field("hex_cell_id", pa.string()),
        pa.field("center_lat", pa.float64()),
        pa.field("center_lng", pa.float64()),
        pa.field("nearby_source_key", pa.string()),
        pa.field("nearby_station_abbr", pa.string()),
        pa.field("nearby_name", pa.string()),
        pa.field("nearby_names", pa.string()),
        pa.field("nearby_postal_code", pa.string()),
        *[pa.field(parameter_id, pa.float64()) for parameter_id in PARAMETER_IDS],
        *[pa.field(f"samples_{parameter_id}", pa.int16()) for parameter_id in PARAMETER_IDS],
    ]).with_metadata({
        b"geo": geo_metadata([min_lon, min_lat, max_lon, max_lat], "Polygon"),
    })
    table = pa.Table.from_pydict(columns, schema=schema)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        table,
        output_path,
        compression="snappy",
        row_group_size=len(cells),
        use_dictionary=True,
        write_statistics=True,
        write_page_index=True,
        sorting_columns=time_sorting_columns(schema),
    )
    write_json(
        sidecar_path,
        surface_sidecar(
            output_path,
            valid_times,
            surface_shape,
            surface_columns,
            surface_rows,
            assets,
            table.num_rows,
            generated_at,
            forecast_horizon_hours,
            past_hours,
            value_stats,
        ),
        pretty=pretty,
    )
    print(f"Wrote {table.num_rows:,} rows to {output_path}", file=sys.stderr)
    print(f"Wrote ArcGIS time sidecar to {sidecar_path}", file=sys.stderr)
    print(f"Surface cells per time step: {len(cells):,}", file=sys.stderr)


def default_output(args: argparse.Namespace) -> Path:
    point_type = str(args.point_type).replace("all", "all-points")

    if args.mode == "points":
        return Path("data") / f"meteoswiss_points_{point_type}_{args.horizon_hours}h.parquet"

    name = (
        f"meteoswiss_surface-{args.surface_shape}-{args.surface_columns}x{args.surface_rows}_"
        f"{point_type}_{args.horizon_hours}h.parquet"
    )
    return Path("data") / name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=["points", "surface"],
        default="points",
        help="Output geometry. The default points path does not build derived surfaces.",
    )
    parser.add_argument("--point-type", choices=["all", "1", "2", "3"], default="all")
    parser.add_argument("--horizon-hours", type=int, default=48)
    parser.add_argument("--past-hours", type=int, default=0, help="Recent hours before the current forecast hour to keep in the output.")
    parser.add_argument("--surface-shape", choices=["hex", "square"], default=DEFAULT_SURFACE_SHAPE)
    parser.add_argument("--surface-columns", type=int, default=DEFAULT_SURFACE_COLUMNS)
    parser.add_argument("--surface-rows", type=int, default=DEFAULT_SURFACE_ROWS)
    parser.add_argument("--now", help="UTC ISO timestamp used as the forecast window start reference.")
    parser.add_argument("--output", type=Path, help="Output Parquet path. Defaults to data/meteoswiss_*.parquet.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON sidecar output.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.horizon_hours <= 0:
        raise SystemExit("--horizon-hours must be positive.")
    if args.past_hours < 0:
        raise SystemExit("--past-hours must be zero or positive.")

    if args.mode == "surface" and (args.surface_columns <= 0 or args.surface_rows <= 0):
        raise SystemExit("--surface-columns and --surface-rows must be positive.")

    output_path = args.output or default_output(args)
    output_path = output_path if output_path.is_absolute() else PROJECT_ROOT / output_path
    sidecar_path = output_path.with_suffix(".arcgis-timeinfo.json")
    now = parse_now(args.now)
    generated_at = datetime.now(timezone.utc)

    print("Loading MeteoSwiss point metadata...", file=sys.stderr)
    metadata_text = fetch_point_metadata_text()
    points = parse_point_metadata(metadata_text, args.point_type)
    records_by_parameter: dict[str, list[ForecastRecord]] = {}
    valid_time_set: set[datetime] = set()
    assets: dict[str, dict[str, str]] = {}
    source_rows: dict[str, int] = {}

    for parameter_id in PARAMETER_IDS:
        parameter = PARAMETERS[parameter_id]
        print(f"Discovering latest MeteoSwiss asset for {parameter['label']}...", file=sys.stderr)
        source = discover_latest_asset(parameter_id)
        print(f"Loading forecast CSV ({source['asset_id']})...", file=sys.stderr)
        forecast_text = fetch_forecast_asset_text(source)
        records, valid_times, rows = parse_forecast_records(
            forecast_text,
            parameter_id,
            points,
            args.point_type,
            now,
            args.horizon_hours,
            args.past_hours,
        )

        if not records or not valid_times:
            raise SystemExit(f"No matching forecast records were found for {parameter_id}.")

        records_by_parameter[parameter_id] = records
        valid_time_set.update(valid_times)
        assets[parameter_id] = source
        source_rows[parameter_id] = rows

    valid_times = sorted(valid_time_set)
    if not valid_times:
        raise SystemExit("No valid forecast times were found.")

    grouped_values = {
        parameter_id: records_by_time(records)
        for parameter_id, records in records_by_parameter.items()
    }

    if args.mode == "points":
        print(f"Writing point Parquet for {len(valid_times)} time steps...", file=sys.stderr)
        write_point_geoparquet(
            output_path,
            sidecar_path,
            points,
            grouped_values,
            valid_times,
            assets,
            generated_at,
            args.horizon_hours,
            args.past_hours,
            args.pretty,
        )
    else:
        write_surface_geoparquet(
            output_path,
            sidecar_path,
            points,
            grouped_values,
            valid_times,
            assets,
            generated_at,
            args.horizon_hours,
            args.past_hours,
            args.surface_shape,
            args.surface_columns,
            args.surface_rows,
            args.pretty,
        )

    print(f"Forecast source rows: {source_rows}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
