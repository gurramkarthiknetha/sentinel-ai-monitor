#!/usr/bin/env python3
"""Prepare the Kaggle fire/smoke YOLO dataset for YOLOv8 training.

This script normalizes split paths and remaps classes so output labels are:
  0 -> fire
  1 -> smoke
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import yaml

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare Kaggle fire/smoke dataset for YOLOv8")
    parser.add_argument("--source", required=True, help="Path to extracted Kaggle dataset root")
    parser.add_argument(
        "--output",
        default="backend/pythonmodel/datasets/prepared/firesmoke_v9",
        help="Prepared YOLO dataset output directory",
    )
    parser.add_argument(
        "--yaml-out",
        default="backend/pythonmodel/datasets/fire_smoke.kaggle.yaml",
        help="Destination dataset YAML file path",
    )
    parser.add_argument(
        "--dataset-yaml",
        default="",
        help="Optional explicit source dataset YAML (if auto-discovery fails)",
    )
    return parser.parse_args()


def normalize_label(value: str) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def collapse_single_child_dirs(root: Path) -> Path:
    current = root
    while True:
        entries = [entry for entry in current.iterdir() if entry.name != "__MACOSX"]
        dirs = [entry for entry in entries if entry.is_dir()]
        files = [entry for entry in entries if entry.is_file()]
        if len(dirs) == 1 and not files:
            current = dirs[0]
            continue
        return current


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}

    if not isinstance(payload, dict):
        raise SystemExit(f"Invalid YAML object in {path}")

    return payload


def class_names_from_yaml(dataset_yaml: dict[str, Any]) -> list[str]:
    names = dataset_yaml.get("names")

    if isinstance(names, dict):
        ordered = []
        for key in sorted(names.keys(), key=lambda item: int(item)):
            ordered.append(str(names[key]).strip())
        return ordered

    if isinstance(names, list):
        return [str(value).strip() for value in names]

    raise SystemExit("Source dataset YAML must contain a 'names' list or dict")


def discover_dataset_yaml(root: Path) -> Path:
    candidates = sorted([*root.rglob("*.yaml"), *root.rglob("*.yml")])
    if not candidates:
        raise SystemExit(f"No dataset YAML found under {root}")

    best_match = None
    fallback = None

    for candidate in candidates:
        try:
            payload = load_yaml(candidate)
            names = [normalize_label(name) for name in class_names_from_yaml(payload)]
        except Exception:
            continue

        if not fallback:
            fallback = candidate

        has_fire = any(name in {"fire", "flame"} or "fire" in name for name in names)
        has_smoke = any("smoke" in name for name in names)

        if has_fire and has_smoke:
            best_match = candidate
            break

    if best_match:
        return best_match

    if fallback:
        return fallback

    raise SystemExit(f"Could not parse any dataset YAML under {root}")


def resolve_dataset_root(source_root: Path, yaml_path: Path, dataset_yaml: dict[str, Any]) -> Path:
    raw_path = str(dataset_yaml.get("path", "")).strip()
    if not raw_path:
        return yaml_path.parent.resolve()

    configured = Path(raw_path)
    if configured.is_absolute() and configured.exists():
        return configured.resolve()

    candidates = [
        (yaml_path.parent / configured).resolve(),
        (source_root / configured).resolve(),
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return yaml_path.parent.resolve()


def resolve_split_path(
    split_value: Any,
    split_name: str,
    dataset_root: Path,
    yaml_path: Path,
) -> Path | None:
    if split_value is None:
        return None

    if isinstance(split_value, list):
        split_value = split_value[0] if split_value else None

    if not isinstance(split_value, str) or not split_value.strip():
        return None

    split_path = Path(split_value.strip())
    candidates = []

    if split_path.is_absolute():
        candidates.append(split_path)
    else:
        candidates.extend(
            [
                (dataset_root / split_path).resolve(),
                (yaml_path.parent / split_path).resolve(),
            ]
        )

    for candidate in candidates:
        if candidate.is_dir():
            return candidate

        if candidate.is_file():
            raise SystemExit(
                f"Split '{split_name}' in source YAML points to a file ({candidate}). "
                "This pipeline expects directory-based YOLO splits."
            )

    return None


def find_split_images_dir(
    dataset_yaml: dict[str, Any],
    dataset_root: Path,
    yaml_path: Path,
    split_aliases: list[str],
) -> tuple[Path | None, str]:
    for alias in split_aliases:
        if alias in dataset_yaml:
            resolved = resolve_split_path(dataset_yaml.get(alias), alias, dataset_root, yaml_path)
            if resolved:
                return resolved, alias

    fallback_names = split_aliases + ["valid" if name == "val" else name for name in split_aliases]

    for alias in fallback_names:
        fallback_candidates = [
            (dataset_root / alias / "images").resolve(),
            (dataset_root / alias).resolve(),
            (dataset_root / "images" / alias).resolve(),
        ]

        for candidate in fallback_candidates:
            if candidate.is_dir():
                return candidate, alias

    return None, split_aliases[0]


def maybe_replace_images_with_labels(path: Path) -> Path:
    parts = list(path.parts)
    for idx in range(len(parts) - 1, -1, -1):
        if parts[idx].lower() == "images":
            parts[idx] = "labels"
            return Path(*parts)
    return path


def find_split_labels_dir(images_dir: Path, dataset_root: Path, split_alias: str) -> Path | None:
    candidates = [
        maybe_replace_images_with_labels(images_dir),
        (images_dir.parent / "labels").resolve(),
        (dataset_root / split_alias / "labels").resolve(),
        (dataset_root / "labels" / split_alias).resolve(),
        (dataset_root / "labels" / ("valid" if split_alias == "val" else split_alias)).resolve(),
    ]

    for candidate in candidates:
        if candidate.is_dir():
            return candidate

    return None


def detect_source_class_mapping(class_names: list[str]) -> dict[int, int]:
    normalized = [normalize_label(name) for name in class_names]

    fire_index = next(
        (idx for idx, name in enumerate(normalized) if name in {"fire", "flame"} or "fire" in name),
        None,
    )
    smoke_index = next((idx for idx, name in enumerate(normalized) if "smoke" in name), None)

    if fire_index is None or smoke_index is None:
        raise SystemExit(
            "Unable to detect both fire and smoke classes from source dataset names: "
            f"{class_names}."
        )

    if fire_index == smoke_index:
        raise SystemExit("Fire and smoke classes resolved to the same source id")

    return {
        int(fire_index): 0,
        int(smoke_index): 1,
    }


def remap_label_file(source_path: Path | None, destination_path: Path, class_map: dict[int, int]) -> tuple[int, int, int]:
    destination_path.parent.mkdir(parents=True, exist_ok=True)

    if source_path is None or not source_path.exists():
        destination_path.write_text("", encoding="utf-8")
        return 0, 0, 0

    kept = 0
    dropped = 0
    malformed = 0
    output_lines = []

    for raw_line in source_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue

        parts = line.split()
        if len(parts) < 5:
            malformed += 1
            continue

        try:
            source_class = int(float(parts[0]))
        except ValueError:
            malformed += 1
            continue

        mapped_class = class_map.get(source_class)
        if mapped_class is None:
            dropped += 1
            continue

        output_lines.append(f"{mapped_class} {' '.join(parts[1:])}")
        kept += 1

    destination_path.write_text("\n".join(output_lines) + ("\n" if output_lines else ""), encoding="utf-8")
    return kept, dropped, malformed


def iter_images(images_dir: Path) -> list[Path]:
    found = []
    for candidate in images_dir.rglob("*"):
        if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTENSIONS:
            found.append(candidate)
    return sorted(found)


def prepare_split(
    split_name: str,
    source_images_dir: Path,
    source_labels_dir: Path | None,
    output_root: Path,
    class_map: dict[int, int],
) -> dict[str, int]:
    destination_images_root = output_root / "images" / split_name
    destination_labels_root = output_root / "labels" / split_name
    destination_images_root.mkdir(parents=True, exist_ok=True)
    destination_labels_root.mkdir(parents=True, exist_ok=True)

    image_paths = iter_images(source_images_dir)
    kept_total = 0
    dropped_total = 0
    malformed_total = 0

    for image_path in image_paths:
        relative_image = image_path.relative_to(source_images_dir)
        destination_image = destination_images_root / relative_image
        destination_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, destination_image)

        relative_label = relative_image.with_suffix(".txt")
        source_label = (source_labels_dir / relative_label) if source_labels_dir else None
        destination_label = destination_labels_root / relative_label

        kept, dropped, malformed = remap_label_file(source_label, destination_label, class_map)
        kept_total += kept
        dropped_total += dropped
        malformed_total += malformed

    return {
        "images": len(image_paths),
        "labels_kept": kept_total,
        "labels_dropped": dropped_total,
        "labels_malformed": malformed_total,
    }


def write_dataset_yaml(dataset_root: Path, yaml_out: Path) -> None:
    yaml_out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "path": str(dataset_root.resolve()),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "nc": 2,
        "names": ["fire", "smoke"],
    }

    with yaml_out.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, sort_keys=False)


def ensure_split_dirs(dataset_root: Path, split_name: str) -> None:
    (dataset_root / "images" / split_name).mkdir(parents=True, exist_ok=True)
    (dataset_root / "labels" / split_name).mkdir(parents=True, exist_ok=True)


def main() -> int:
    args = parse_args()

    source_root = Path(args.source).resolve()
    output_root = Path(args.output).resolve()
    yaml_out = Path(args.yaml_out).resolve()

    if not source_root.exists() or not source_root.is_dir():
        raise SystemExit(f"Source dataset directory does not exist: {source_root}")

    inspected_root = collapse_single_child_dirs(source_root)

    source_yaml_path = Path(args.dataset_yaml).resolve() if args.dataset_yaml else discover_dataset_yaml(inspected_root)
    if not source_yaml_path.exists():
        raise SystemExit(f"Source dataset YAML not found: {source_yaml_path}")

    source_yaml = load_yaml(source_yaml_path)
    source_class_names = class_names_from_yaml(source_yaml)
    class_map = detect_source_class_mapping(source_class_names)

    dataset_root = resolve_dataset_root(inspected_root, source_yaml_path, source_yaml)

    train_images_dir, train_alias = find_split_images_dir(source_yaml, dataset_root, source_yaml_path, ["train"])
    val_images_dir, val_alias = find_split_images_dir(source_yaml, dataset_root, source_yaml_path, ["val", "valid"])
    test_images_dir, test_alias = find_split_images_dir(source_yaml, dataset_root, source_yaml_path, ["test"])

    if not train_images_dir:
        raise SystemExit("Could not resolve train split images directory")
    if not val_images_dir:
        raise SystemExit("Could not resolve validation split images directory")

    train_labels_dir = find_split_labels_dir(train_images_dir, dataset_root, train_alias)
    val_labels_dir = find_split_labels_dir(val_images_dir, dataset_root, val_alias)
    test_labels_dir = (
        find_split_labels_dir(test_images_dir, dataset_root, test_alias) if test_images_dir else None
    )

    if output_root.exists():
        shutil.rmtree(output_root)

    train_stats = prepare_split("train", train_images_dir, train_labels_dir, output_root, class_map)
    val_stats = prepare_split("val", val_images_dir, val_labels_dir, output_root, class_map)

    if test_images_dir:
        test_stats = prepare_split("test", test_images_dir, test_labels_dir, output_root, class_map)
    else:
        ensure_split_dirs(output_root, "test")
        test_stats = {
            "images": 0,
            "labels_kept": 0,
            "labels_dropped": 0,
            "labels_malformed": 0,
        }

    write_dataset_yaml(output_root, yaml_out)

    report = {
        "source_root": str(source_root),
        "inspected_root": str(inspected_root),
        "source_yaml": str(source_yaml_path),
        "resolved_dataset_root": str(dataset_root),
        "class_names_source": source_class_names,
        "class_map": class_map,
        "prepared_output_root": str(output_root),
        "yaml_out": str(yaml_out),
        "splits": {
            "train": train_stats,
            "val": val_stats,
            "test": test_stats,
        },
    }

    print("Dataset preparation complete:")
    print(json.dumps(report, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
