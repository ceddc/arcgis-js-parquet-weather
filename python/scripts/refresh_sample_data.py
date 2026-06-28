#!/usr/bin/env python3
"""Regenerate the MeteoSwiss Parquet files used by the web sample.

The export logic lives in `meteoswiss_to_geoparquet.py`. By default this script
writes the direct point Parquet only. Use `--geometry all` when the web demo
also needs the derived square and hexagon surface files.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EXPORT_SCRIPT = Path(__file__).resolve().parent / "meteoswiss_to_geoparquet.py"
DATA_DIR = PROJECT_ROOT / "data"

# These surface defaults are only used when square/hex outputs are requested explicitly.
SURFACE_COLUMNS = 128
SURFACE_ROWS = 72
FORECAST_HOURS = 48
PAST_HOURS = 6


@dataclass(frozen=True)
class Dataset:
    key: str
    label: str
    output: Path
    export_args: tuple[str, ...]


DATASETS = (
    Dataset(
        key="points",
        label="Forecast points",
        output=DATA_DIR / "meteoswiss_points_all-points_48h.parquet",
        export_args=("--mode", "points"),
    ),
    Dataset(
        key="square",
        label="Square surface",
        output=DATA_DIR / "meteoswiss_surface-square-128x72_all-points_48h.parquet",
        export_args=("--mode", "surface", "--surface-shape", "square"),
    ),
    Dataset(
        key="hex",
        label="Hex surface",
        output=DATA_DIR / "meteoswiss_surface-hex-128x72_all-points_48h.parquet",
        export_args=("--mode", "surface", "--surface-shape", "hex"),
    ),
)


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc)


def sidecar_path(output: Path) -> Path:
    return output.with_suffix(".arcgis-timeinfo.json")


def generated_at(output: Path) -> datetime | None:
    try:
        payload = json.loads(sidecar_path(output).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    value = payload.get("generated_at")
    return parse_utc(value) if isinstance(value, str) else None


def data_needs_refresh(dataset: Dataset, max_age_hours: float, force: bool) -> tuple[bool, str]:
    if force:
        return True, "forced refresh"

    if not dataset.output.exists():
        return True, "missing Parquet file"

    if not sidecar_path(dataset.output).exists():
        return True, "missing ArcGIS time sidecar"

    timestamp = generated_at(dataset.output)
    if timestamp is None:
        return True, "missing generated_at metadata"

    age = datetime.now(timezone.utc) - timestamp
    if age > timedelta(hours=max_age_hours):
        return True, f"stale by {age.total_seconds() / 3600:.1f} hours"

    return False, f"fresh ({age.total_seconds() / 3600:.1f} hours old)"


def regenerate(dataset: Dataset) -> None:
    dataset.output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        str(EXPORT_SCRIPT),
        *dataset.export_args,
        "--surface-columns",
        str(SURFACE_COLUMNS),
        "--surface-rows",
        str(SURFACE_ROWS),
        "--point-type",
        "all",
        "--horizon-hours",
        str(FORECAST_HOURS),
        "--past-hours",
        str(PAST_HOURS),
        "--output",
        str(dataset.output),
    ]
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)


def selected_datasets(selection: str) -> tuple[Dataset, ...]:
    if selection == "all":
        return DATASETS

    return tuple(dataset for dataset in DATASETS if dataset.key == selection)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Regenerate even when the current data is fresh.")
    parser.add_argument("--max-age-hours", type=float, default=6.0, help="Refresh data older than this many hours.")
    parser.add_argument(
        "--geometry",
        choices=["all", *(dataset.key for dataset in DATASETS)],
        default="points",
        help="Dataset to regenerate. Default is points; all also refreshes derived square/hex surfaces.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    for dataset in selected_datasets(args.geometry):
        refresh, reason = data_needs_refresh(dataset, args.max_age_hours, args.force)

        if not refresh:
            print(f"[fresh] {dataset.label}: {reason}", flush=True)
            continue

        print(f"[refresh] {dataset.label}: {reason}", flush=True)
        regenerate(dataset)
        print(f"[done] wrote {dataset.output.relative_to(PROJECT_ROOT)}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
