#!/usr/bin/env python3
"""MeteoSwiss source, forecast parsing, and derived surface geometry helpers."""

from __future__ import annotations

import csv
import hashlib
import heapq
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

# Shapely is only needed for clipped square/hex surface outputs. The point-only
# point Parquet path can still parse MeteoSwiss CSVs without this geometry stack.
try:
    from shapely import set_precision as shapely_set_precision
    from shapely.geometry import MultiPolygon as ShapelyMultiPolygon
    from shapely.geometry import Polygon as ShapelyPolygon
    from shapely.geometry.base import BaseGeometry
    from shapely.geometry.polygon import orient as orient_shapely_polygon
    from shapely.ops import unary_union
except ModuleNotFoundError:
    shapely_set_precision = None
    ShapelyMultiPolygon = None
    ShapelyPolygon = None
    BaseGeometry = Any  # type: ignore[assignment,misc]
    orient_shapely_polygon = None
    unary_union = None


STAC_BASE_URL = "https://data.geo.admin.ch/api/stac/v1"
LOCAL_FORECAST_COLLECTION = "ch.meteoschweiz.ogd-local-forecasting"
METADATA_POINT_URL = (
    "https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/"
    "ogd-local-forecasting_meta_point.csv"
)
SWISS_BOUNDARY_LAYER_ID = "ch.swisstopo.swissboundaries3d-land-flaeche.fill"
SWISS_BOUNDARY_URL = (
    "https://api3.geo.admin.ch/rest/services/api/MapServer/"
    f"{SWISS_BOUNDARY_LAYER_ID}/CH?geometryFormat=geojson&sr=4326"
)
SWISS_BOUNDARY_SOURCE_ATTRIBUTION = "© Data: swisstopo"
SWISS_BOUNDARY_TERMS_URL = "https://www.geo.admin.ch/en/general-terms-of-use-fsdi"

HOUR_SECONDS = 60 * 60
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SWISS_BOUNDARY_LOCAL_PATH = PROJECT_ROOT / "data" / "swiss-boundary-ch.geojson"
SWISS_BOUNDARY_CACHE_PATH = PROJECT_ROOT / ".cache" / "swiss-boundary-ch.json"
METADATA_POINT_CACHE_PATH = PROJECT_ROOT / ".cache" / "meteoswiss" / "ogd-local-forecasting_meta_point.csv"
FORECAST_ASSET_CACHE_DIR = PROJECT_ROOT / ".cache" / "meteoswiss" / "forecast-assets"
SURFACE_CELL_CACHE_DIR = PROJECT_ROOT / ".cache" / "meteoswiss" / "surface-cells"
SURFACE_CELL_CACHE_VERSION = "v4"
SURFACE_EXTENT = {
    "west": 5.85,
    "south": 45.75,
    "east": 10.6,
    "north": 47.95,
}
DEFAULT_SURFACE_COLUMNS = 128
DEFAULT_SURFACE_ROWS = 72
DEFAULT_SURFACE_SHAPE = "hex"
SURFACE_NEIGHBORS = 8
MAX_NEAREST_DISTANCE_KM = 58
SURFACE_CLIP_MODE = "switzerland-boundary-simple-clipped-polygons"
SURFACE_GEOMETRY_PRECISION_DEGREES = 0.00001
SURFACE_GEOMETRY_SIMPLIFICATION_TOLERANCE_DEGREES = 0.0001
SURFACE_MAX_RING_COORDINATES = 9

PARAMETERS: dict[str, dict[str, Any]] = {
    "tre200h0": {
        "label": "Temperature 2 m",
        "unit": "degC",
        "value_label": "Temperature",
        "decimals": 1,
    },
    "rp0003i0": {
        "label": "Precipitation probability (3 h)",
        "unit": "%",
        "value_label": "Probability",
        "decimals": 0,
    },
    "rre150h0": {
        "label": "Hourly precipitation",
        "unit": "mm",
        "value_label": "Precipitation",
        "decimals": 1,
    },
    "fu3010h0": {
        "label": "Wind speed",
        "unit": "km/h",
        "value_label": "Wind speed",
        "decimals": 1,
    },
    "nprolohs": {
        "label": "Low cloud cover",
        "unit": "%",
        "value_label": "Low cloud cover",
        "decimals": 0,
        "scale": 100,
    },
    "npromths": {
        "label": "Medium cloud cover",
        "unit": "%",
        "value_label": "Medium cloud cover",
        "decimals": 0,
        "scale": 100,
    },
    "nprohihs": {
        "label": "High cloud cover",
        "unit": "%",
        "value_label": "High cloud cover",
        "decimals": 0,
        "scale": 100,
    },
}
LATEST_FORECAST_ITEM_CACHE: dict[str, Any] | None = None

POINT_TYPE_LABELS = {
    1: "weather stations",
    2: "ZIP-code points",
    3: "mountain points of interest",
}


@dataclass(frozen=True)
class PointMetadata:
    point_id: int
    point_type_id: int
    station_abbr: str
    postal_code: str
    name: str
    altitude: float | None
    latitude: float
    longitude: float


@dataclass(frozen=True)
class ForecastRecord:
    source_key: str
    point: PointMetadata
    valid_time: datetime
    value: float


@dataclass(frozen=True)
class SurfaceCell:
    row: int
    column: int
    center_lat: float
    center_lon: float
    shape: str
    ring: tuple[tuple[float, float], ...]
    neighbors: tuple[tuple[str, float], ...]
    rings: tuple[tuple[tuple[float, float], ...], ...] | None = None


Position = tuple[float, float]
LinearRing = tuple[Position, ...]
BoundaryPolygon = tuple[LinearRing, ...]
BoundaryMultiPolygon = tuple[BoundaryPolygon, ...]


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "arcgis-parquet-weather-sample/1.0"})

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Request failed for {url}: {error.code} {error.reason}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Request failed for {url}: {error.reason}") from error


def fetch_json(url: str) -> dict[str, Any]:
    return json.loads(fetch_bytes(url).decode("utf-8"))


def fetch_latin1_text(url: str) -> str:
    return fetch_bytes(url).decode("iso-8859-1")


def read_or_fetch_bytes(url: str, cache_path: Path) -> bytes:
    try:
        return cache_path.read_bytes()
    except OSError:
        data = fetch_bytes(url)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(data)
        return data


def cached_latin1_text(url: str, cache_path: Path) -> str:
    return read_or_fetch_bytes(url, cache_path).decode("iso-8859-1")


def safe_cache_name(value: str) -> str:
    return "".join(character if character.isalnum() or character in {".", "-", "_"} else "_" for character in value)


def fetch_point_metadata_text() -> str:
    return cached_latin1_text(METADATA_POINT_URL, METADATA_POINT_CACHE_PATH)


def forecast_asset_cache_path(source: dict[str, str]) -> Path:
    asset_id = source.get("asset_id")

    if not asset_id:
        asset_id = Path(urllib.parse.urlparse(source["asset_href"]).path).name

    return FORECAST_ASSET_CACHE_DIR / safe_cache_name(asset_id)


def fetch_forecast_asset_text(source: dict[str, str]) -> str:
    return cached_latin1_text(source["asset_href"], forecast_asset_cache_path(source))


def parse_number(value: str | None) -> float | None:
    if value is None or value == "":
        return None

    try:
        parsed = float(value)
    except ValueError:
        return None

    return parsed if math.isfinite(parsed) else None


def parse_utc_stamp(stamp: str) -> datetime:
    return datetime(
        int(stamp[0:4]),
        int(stamp[4:6]),
        int(stamp[6:8]),
        int(stamp[8:10]),
        int(stamp[10:12]),
        tzinfo=timezone.utc,
    )


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def floor_to_hour(value: datetime) -> datetime:
    timestamp = int(value.astimezone(timezone.utc).timestamp())
    return datetime.fromtimestamp((timestamp // HOUR_SECONDS) * HOUR_SECONDS, tz=timezone.utc)


def parse_now(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)

    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def parse_position(value: Any) -> Position | None:
    if not isinstance(value, list | tuple) or len(value) < 2:
        return None

    longitude = parse_number(str(value[0]))
    latitude = parse_number(str(value[1]))

    if longitude is None or latitude is None:
        return None

    return longitude, latitude


def parse_ring(value: Any) -> LinearRing | None:
    if not isinstance(value, list | tuple):
        return None

    positions = tuple(position for item in value if (position := parse_position(item)) is not None)
    return positions if len(positions) >= 4 else None


def parse_boundary_polygon(value: Any) -> BoundaryPolygon | None:
    if not isinstance(value, list | tuple):
        return None

    rings = tuple(ring for item in value if (ring := parse_ring(item)) is not None)
    return rings if rings else None


def parse_boundary_payload(payload: dict[str, Any]) -> BoundaryMultiPolygon:
    geometry = payload.get("feature", payload).get("geometry", {})
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Polygon":
        polygon = parse_boundary_polygon(coordinates)
        if polygon is None:
            raise RuntimeError("Swiss boundary polygon did not contain usable rings.")
        return (polygon,)

    if geometry_type != "MultiPolygon" or not isinstance(coordinates, list | tuple):
        raise RuntimeError("Swiss boundary response did not contain a Polygon or MultiPolygon geometry.")

    polygons = tuple(polygon for item in coordinates if (polygon := parse_boundary_polygon(item)) is not None)

    if not polygons:
        raise RuntimeError("Swiss boundary multipolygon did not contain usable polygons.")

    return polygons


def load_swiss_boundary() -> BoundaryMultiPolygon:
    if SWISS_BOUNDARY_LOCAL_PATH.exists():
        payload = json.loads(SWISS_BOUNDARY_LOCAL_PATH.read_text(encoding="utf-8"))
    else:
        payload = json.loads(read_or_fetch_bytes(SWISS_BOUNDARY_URL, SWISS_BOUNDARY_CACHE_PATH).decode("utf-8"))

    return parse_boundary_payload(payload)


def ring_contains_point(ring: LinearRing, longitude: float, latitude: float) -> bool:
    inside = False
    previous_longitude, previous_latitude = ring[-1]

    for current_longitude, current_latitude in ring:
        crosses_latitude = (current_latitude > latitude) != (previous_latitude > latitude)

        if crosses_latitude:
            intersection_longitude = (
                (previous_longitude - current_longitude) *
                (latitude - current_latitude) /
                (previous_latitude - current_latitude) +
                current_longitude
            )

            if longitude < intersection_longitude:
                inside = not inside

        previous_longitude, previous_latitude = current_longitude, current_latitude

    return inside


def boundary_contains_point(boundary: BoundaryMultiPolygon, longitude: float, latitude: float) -> bool:
    for polygon in boundary:
        outer, *holes = polygon

        if not ring_contains_point(outer, longitude, latitude):
            continue

        if any(ring_contains_point(hole, longitude, latitude) for hole in holes):
            continue

        return True

    return False


def require_shapely() -> None:
    if (
        shapely_set_precision is None
        or ShapelyPolygon is None
        or unary_union is None
        or orient_shapely_polygon is None
    ):
        raise RuntimeError(
            "Shapely is required to clip surface polygons to the Switzerland boundary. "
            "Install/update the Python environment with `uv sync --project python`."
        )


def boundary_to_geometry(boundary: BoundaryMultiPolygon) -> BaseGeometry:
    require_shapely()
    polygons = []

    for polygon in boundary:
        outer, *holes = polygon
        polygons.append(ShapelyPolygon(outer, holes))

    return unary_union(polygons)


def normalized_ring(coordinates: Any) -> tuple[tuple[float, float], ...]:
    ring = tuple((float(longitude), float(latitude)) for longitude, latitude, *_ in coordinates)

    if not ring:
        return ring

    return ring if ring[0] == ring[-1] else (*ring, ring[0])


def polygon_to_rings(geometry: BaseGeometry) -> tuple[tuple[tuple[float, float], ...], ...] | None:
    require_shapely()

    if geometry.is_empty:
        return None

    if ShapelyMultiPolygon is not None and isinstance(geometry, ShapelyMultiPolygon):
        geometry = max(geometry.geoms, key=lambda polygon: polygon.area)

    if not isinstance(geometry, ShapelyPolygon) or geometry.area <= 0:
        return None

    oriented = orient_shapely_polygon(geometry, sign=1.0)
    rings = [normalized_ring(oriented.exterior.coords)]

    for interior in oriented.interiors:
        ring = normalized_ring(interior.coords)

        if len(ring) >= 4:
            rings.append(ring)

    return tuple(ring for ring in rings if len(ring) >= 4) or None


def geometry_coordinate_count(geometry: BaseGeometry) -> int:
    require_shapely()

    if geometry.is_empty:
        return 0

    if ShapelyMultiPolygon is not None and isinstance(geometry, ShapelyMultiPolygon):
        return max((geometry_coordinate_count(part) for part in geometry.geoms), default=0)

    if not isinstance(geometry, ShapelyPolygon):
        return 0

    return len(geometry.exterior.coords) + sum(len(interior.coords) for interior in geometry.interiors)


def simplified_surface_geometry(geometry: BaseGeometry) -> BaseGeometry:
    require_shapely()

    if geometry.is_empty:
        return geometry

    if ShapelyMultiPolygon is not None and isinstance(geometry, ShapelyMultiPolygon):
        geometry = max(geometry.geoms, key=lambda polygon: polygon.area)

    if not isinstance(geometry, ShapelyPolygon) or geometry.area <= 0:
        return geometry

    rounded = shapely_set_precision(geometry, SURFACE_GEOMETRY_PRECISION_DEGREES)
    candidate = rounded.simplify(SURFACE_GEOMETRY_SIMPLIFICATION_TOLERANCE_DEGREES, preserve_topology=True)

    if geometry_coordinate_count(candidate) <= SURFACE_MAX_RING_COORDINATES:
        return candidate

    hull = rounded.convex_hull
    candidate = hull.simplify(SURFACE_GEOMETRY_SIMPLIFICATION_TOLERANCE_DEGREES, preserve_topology=True)

    if geometry_coordinate_count(candidate) <= SURFACE_MAX_RING_COORDINATES:
        return candidate

    tolerance = SURFACE_GEOMETRY_SIMPLIFICATION_TOLERANCE_DEGREES
    for _ in range(12):
        candidate = hull.simplify(tolerance, preserve_topology=False)

        if (
            not candidate.is_empty
            and candidate.is_valid
            and candidate.area > 0
            and geometry_coordinate_count(candidate) <= SURFACE_MAX_RING_COORDINATES
        ):
            return candidate

        tolerance *= 1.6

    return hull.minimum_rotated_rectangle


def clipped_surface_rings(
    ring: tuple[tuple[float, float], ...],
    boundary_geometry: BaseGeometry | None,
) -> tuple[tuple[tuple[float, float], ...], ...] | None:
    if boundary_geometry is None:
        return (ring,)

    require_shapely()
    cell_geometry = ShapelyPolygon(ring)
    return polygon_to_rings(simplified_surface_geometry(cell_geometry.intersection(boundary_geometry)))


def surface_cell_rings(cell: SurfaceCell) -> tuple[tuple[tuple[float, float], ...], ...]:
    return cell.rings if cell.rings is not None else (cell.ring,)


def point_key(point_type_id: int, point_id: int) -> str:
    return f"{point_type_id}:{point_id}"


def matches_point_selection(point_type_id: int, selection: str) -> bool:
    return selection == "all" and point_type_id in {1, 2, 3} or str(point_type_id) == selection


def latest_forecast_item() -> tuple[str, dict[str, Any]]:
    global LATEST_FORECAST_ITEM_CACHE

    if LATEST_FORECAST_ITEM_CACHE is None:
        items_url = f"{STAC_BASE_URL}/collections/{LOCAL_FORECAST_COLLECTION}/items?limit=10"
        items = fetch_json(items_url).get("features", [])

        if not items:
            raise RuntimeError("No MeteoSwiss local forecast STAC items are available.")

        latest_item_summary = sorted(
            items,
            key=lambda item: item.get("properties", {}).get("updated")
            or item.get("properties", {}).get("datetime")
            or "",
            reverse=True,
        )[0]
        item_id = latest_item_summary["id"]
        item_url = f"{STAC_BASE_URL}/collections/{LOCAL_FORECAST_COLLECTION}/items/{item_id}"
        LATEST_FORECAST_ITEM_CACHE = {
            "id": item_id,
            "item": fetch_json(item_url),
        }

    return LATEST_FORECAST_ITEM_CACHE["id"], LATEST_FORECAST_ITEM_CACHE["item"]


def discover_latest_asset(parameter_id: str) -> dict[str, str]:
    item_id, item = latest_forecast_item()
    suffix = f".{parameter_id}.csv"
    assets = [
        (asset_id, asset)
        for asset_id, asset in item.get("assets", {}).items()
        if asset_id.endswith(suffix)
    ]

    if not assets:
        raise RuntimeError(f"No MeteoSwiss asset found for {parameter_id}.")

    asset_id, asset = sorted(
        assets,
        key=lambda entry: entry[1].get("updated") or entry[1].get("created") or "",
        reverse=True,
    )[0]

    return {
        "asset_id": asset_id,
        "asset_href": asset["href"],
        "asset_updated": asset.get("updated") or asset.get("created") or "",
        "item_id": item_id,
        "item_updated": item.get("properties", {}).get("updated")
        or item.get("properties", {}).get("datetime")
        or "",
    }


def read_csv_dicts(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(StringIO(text), delimiter=";"))


def parse_point_metadata(text: str, point_type_selection: str) -> dict[str, PointMetadata]:
    points: dict[str, PointMetadata] = {}

    for row in read_csv_dicts(text):
        point_type_id = int(row["point_type_id"])

        if not matches_point_selection(point_type_id, point_type_selection):
            continue

        point_id = int(row["point_id"])
        latitude = parse_number(row["point_coordinates_wgs84_lat"])
        longitude = parse_number(row["point_coordinates_wgs84_lon"])

        if latitude is None or longitude is None:
            continue

        points[point_key(point_type_id, point_id)] = PointMetadata(
            point_id=point_id,
            point_type_id=point_type_id,
            station_abbr=row.get("station_abbr", ""),
            postal_code=row.get("postal_code", ""),
            name=row.get("point_name", ""),
            altitude=parse_number(row.get("point_height_masl")),
            latitude=latitude,
            longitude=longitude,
        )

    return points


def parse_forecast_records(
    text: str,
    parameter_id: str,
    points: dict[str, PointMetadata],
    point_type_selection: str,
    now: datetime,
    horizon_hours: int,
    past_hours: int = 0,
) -> tuple[list[ForecastRecord], list[datetime], int]:
    current_hour = floor_to_hour(now)
    range_start = datetime.fromtimestamp(
        current_hour.timestamp() - past_hours * HOUR_SECONDS,
        tz=timezone.utc,
    )
    range_end = datetime.fromtimestamp(
        current_hour.timestamp() + horizon_hours * HOUR_SECONDS,
        tz=timezone.utc,
    )
    records: list[ForecastRecord] = []
    valid_times: set[datetime] = set()
    source_rows = 0

    for row in read_csv_dicts(text):
        source_rows += 1
        point_type_id = int(row["point_type_id"])

        if not matches_point_selection(point_type_id, point_type_selection):
            continue

        point_id = int(row["point_id"])
        source_key = point_key(point_type_id, point_id)
        point = points.get(source_key)

        if point is None:
            continue

        valid_time = parse_utc_stamp(row["Date"])

        if valid_time < range_start or valid_time > range_end:
            continue

        value = parse_number(row.get(parameter_id))

        if value is None:
            continue

        value *= PARAMETERS[parameter_id].get("scale", 1)
        valid_times.add(valid_time)
        records.append(ForecastRecord(source_key=source_key, point=point, valid_time=valid_time, value=value))

    return records, sorted(valid_times), source_rows


def distance_squared_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = (a[0] + b[0]) / 2
    x = (a[1] - b[1]) * 111.32 * math.cos(math.radians(lat))
    y = (a[0] - b[0]) * 110.57
    return x * x + y * y


def surface_cell_neighbors(
    center: tuple[float, float],
    points: list[tuple[str, PointMetadata]],
) -> tuple[tuple[str, float], ...] | None:
    """Return normalized inverse-distance weights for nearby forecast points."""
    nearest = heapq.nsmallest(
        SURFACE_NEIGHBORS,
        (
            (source_key, distance_squared_km(center, (point.latitude, point.longitude)))
            for source_key, point in points
        ),
        key=lambda item: item[1],
    )
    closest = nearest[0] if nearest else None

    if closest is None or math.sqrt(closest[1]) > MAX_NEAREST_DISTANCE_KM:
        return None

    raw_weights = [
        (source_key, 1 / max(0.35, distance_squared))
        for source_key, distance_squared in nearest
    ]
    weight_total = sum(weight for _, weight in raw_weights)
    return tuple((source_key, weight / weight_total) for source_key, weight in raw_weights)


def square_ring(west: float, south: float, east: float, north: float) -> tuple[tuple[float, float], ...]:
    return (
        (west, south),
        (east, south),
        (east, north),
        (west, north),
        (west, south),
    )


def hex_ring(
    center_lon: float,
    center_lat: float,
    lon_radius: float,
    lat_radius: float,
) -> tuple[tuple[float, float], ...]:
    vertices = [
        (
            center_lon + lon_radius * math.cos(math.radians(angle)),
            center_lat + lat_radius * math.sin(math.radians(angle)),
        )
        for angle in (30, 90, 150, 210, 270, 330)
    ]
    return tuple([*vertices, vertices[0]])


def point_metadata_signature(points: list[tuple[str, PointMetadata]]) -> str:
    payload = "\n".join(
        f"{source_key};{point.point_type_id};{point.point_id};{point.latitude:.7f};{point.longitude:.7f}"
        for source_key, point in sorted(points)
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def surface_cell_cache_path(
    points: list[tuple[str, PointMetadata]],
    columns: int,
    rows: int,
    shape: str,
    clipped: bool,
) -> Path:
    clip_slug = "clipped" if clipped else "unclipped"
    signature = point_metadata_signature(points)
    return SURFACE_CELL_CACHE_DIR / (
        f"{SURFACE_CELL_CACHE_VERSION}_{shape}_{columns}x{rows}_{clip_slug}_"
        f"{len(points)}pts_{signature}.json"
    )


def surface_cell_from_cache(item: dict[str, Any]) -> SurfaceCell:
    rings = item.get("rings")
    parsed_rings = (
        tuple(
            tuple((float(longitude), float(latitude)) for longitude, latitude in ring)
            for ring in rings
        )
        if isinstance(rings, list)
        else None
    )

    return SurfaceCell(
        row=int(item["row"]),
        column=int(item["column"]),
        center_lat=float(item["center_lat"]),
        center_lon=float(item["center_lon"]),
        shape=str(item["shape"]),
        ring=parsed_rings[0] if parsed_rings else tuple((float(longitude), float(latitude)) for longitude, latitude in item["ring"]),
        neighbors=tuple((str(source_key), float(weight)) for source_key, weight in item["neighbors"]),
        rings=parsed_rings,
    )


def surface_cell_to_cache(cell: SurfaceCell) -> dict[str, Any]:
    return {
        "row": cell.row,
        "column": cell.column,
        "center_lat": cell.center_lat,
        "center_lon": cell.center_lon,
        "shape": cell.shape,
        "ring": cell.ring,
        "rings": surface_cell_rings(cell),
        "neighbors": cell.neighbors,
    }


def read_surface_cell_cache(path: Path) -> list[SurfaceCell] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if payload.get("version") != SURFACE_CELL_CACHE_VERSION:
        return None

    try:
        cells = [surface_cell_from_cache(item) for item in payload["cells"]]
    except (KeyError, TypeError, ValueError):
        return None

    return cells or None


def write_surface_cell_cache(path: Path, cells: list[SurfaceCell]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": SURFACE_CELL_CACHE_VERSION,
        "surface_extent": SURFACE_EXTENT,
        "surface_neighbors": SURFACE_NEIGHBORS,
        "max_nearest_distance_km": MAX_NEAREST_DISTANCE_KM,
        "cells": [surface_cell_to_cache(cell) for cell in cells],
    }
    temporary_path = path.with_name(f"{path.name}.tmp")
    temporary_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8", newline="\n")
    temporary_path.replace(path)


def build_surface_cells_from_points(
    points: list[tuple[str, PointMetadata]],
    columns: int,
    rows: int,
    shape: str,
    clip_boundary: BoundaryMultiPolygon | None,
) -> list[SurfaceCell]:
    cell_width = (SURFACE_EXTENT["east"] - SURFACE_EXTENT["west"]) / columns
    cell_height = (SURFACE_EXTENT["north"] - SURFACE_EXTENT["south"]) / rows
    cells: list[SurfaceCell] = []
    retained_cells: set[tuple[int, int]] | None = None
    boundary_geometry = boundary_to_geometry(clip_boundary) if clip_boundary is not None else None

    if clip_boundary is not None:
        # First keep cells whose centers are inside Switzerland. Then keep one
        # ring of neighboring cells so boundary clipping has enough coverage.
        retained_cells = set()

        for row in range(rows):
            column_count = columns + 1 if shape == "hex" and row % 2 == 1 else columns

            for column in range(column_count):
                west = SURFACE_EXTENT["west"] + column * cell_width
                east = west + cell_width
                south = SURFACE_EXTENT["south"] + row * cell_height
                north = south + cell_height
                center_lat = (south + north) / 2

                if shape == "hex":
                    center_lon = SURFACE_EXTENT["west"] + (column + (0 if row % 2 == 1 else 0.5)) * cell_width
                else:
                    center_lon = (west + east) / 2

                if boundary_contains_point(clip_boundary, center_lon, center_lat):
                    retained_cells.add((row, column))

        for row, column in tuple(retained_cells):
            for neighbor_row in range(row - 1, row + 2):
                if neighbor_row < 0 or neighbor_row >= rows:
                    continue

                neighbor_column_count = columns + 1 if shape == "hex" and neighbor_row % 2 == 1 else columns

                for neighbor_column in range(column - 1, column + 2):
                    if 0 <= neighbor_column < neighbor_column_count:
                        retained_cells.add((neighbor_row, neighbor_column))

    # Build each grid cell, clip it to the Swiss boundary, then attach nearby
    # MeteoSwiss point weights used later by the exporter.
    for row in range(rows):
        column_count = columns + 1 if shape == "hex" and row % 2 == 1 else columns

        for column in range(column_count):
            west = SURFACE_EXTENT["west"] + column * cell_width
            east = west + cell_width
            south = SURFACE_EXTENT["south"] + row * cell_height
            north = south + cell_height
            center_lat = (south + north) / 2

            if shape == "hex":
                center_lon = SURFACE_EXTENT["west"] + (column + (0 if row % 2 == 1 else 0.5)) * cell_width
                ring = hex_ring(center_lon, center_lat, cell_width / math.sqrt(3), cell_height / 1.5)
            else:
                center_lon = (west + east) / 2
                ring = square_ring(west, south, east, north)

            if retained_cells is not None and (row, column) not in retained_cells:
                continue

            rings = clipped_surface_rings(ring, boundary_geometry)

            if rings is None:
                continue

            neighbors = surface_cell_neighbors((center_lat, center_lon), points)

            if neighbors is None:
                continue

            cells.append(
                SurfaceCell(
                    row=row,
                    column=column,
                    center_lat=center_lat,
                    center_lon=center_lon,
                    shape=shape,
                    ring=rings[0],
                    neighbors=neighbors,
                    rings=rings,
                )
            )

    return cells


def create_surface_cells_from_points(
    source_points: Any,
    columns: int,
    rows: int,
    shape: str,
    clip_boundary: BoundaryMultiPolygon | None,
) -> list[SurfaceCell]:
    points = list(source_points)
    cache_path = surface_cell_cache_path(points, columns, rows, shape, clip_boundary is not None)
    cached_cells = read_surface_cell_cache(cache_path)

    if cached_cells is not None:
        print(f"Loaded cached {shape} surface geometry ({len(cached_cells):,} cells).", file=sys.stderr)
        return cached_cells

    cells = build_surface_cells_from_points(points, columns, rows, shape, clip_boundary)
    write_surface_cell_cache(cache_path, cells)
    print(f"Cached {shape} surface geometry ({len(cells):,} cells).", file=sys.stderr)
    return cells
