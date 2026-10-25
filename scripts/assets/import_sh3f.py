"""Safely curate Sweet Home 3D's public-domain BlendSwap library into GLBs.

The source archive stays local. Only explicitly selected, validated models are
exported; no SH3F/OBJ is served to browsers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
PACK = "BlendSwap-CC-0.sh3f"
SOURCE = "https://github.com/YoannDev90/SweetHome3D-Packs/tree/main/Furnitures"
UPSTREAM = "https://www.sweethome3d.com/import-models/"
MAX_FILES = 2000
MAX_TOTAL_BYTES = 500_000_000
MAX_SINGLE_BYTES = 40_000_000
MAX_TRIANGLES = 80_000
ALLOWED = {"cc-0", "cc0", "cc0-1.0", "public domain", "public-domain"}

# Source catalog index, project category, and curated semantic role. Unknowns stay
# quarantined; this list is the only automatic conversion allowlist.
CURATED = {
    1: ("office", "office_chair"),
    2: ("bedroom", "bed"),
    3: ("bedroom", "bed"),
    4: ("bedroom", "bedside"),
    26: ("dining_room", "dining_chair"),
    27: ("dining_room", "dining_table"),
    52: ("living_room", "tv_stand"),
    68: ("bedroom", "wardrobe"),
    75: ("office", "desk"),
    86: ("living_room", "armchair"),
    95: ("living_room", "sofa"),
    99: ("living_room", "armchair"),
    132: ("living_room", "sofa"),
    152: ("office", "desk"),  # Quarantined if individual license evidence is absent.
}


class ImportRejected(ValueError):
    pass


def license_allowed(value: str | None) -> bool:
    return bool(value and value.strip().lower() in ALLOWED)


def _safe_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (path.is_absolute() or "\\" in name or ":" in name or
            any(part in ("", ".", "..") for part in path.parts)):
        raise ImportRejected(f"UNSAFE_ARCHIVE_PATH: {name}")
    return path


def _properties(data: bytes) -> dict[str, str]:
    # Java properties use ISO-8859-1 with optional Unicode escapes.
    result = {}
    for line in data.decode("iso-8859-1").splitlines():
        line = line.strip()
        if not line or line[0] in "#!":
            continue
        pair = re.split(r"(?<!\\)[=:]", line, maxsplit=1)
        if len(pair) == 2:
            result[pair[0].strip()] = re.sub(
                r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), pair[1].strip()
            )
    return result


def inspect_archive(path: Path) -> tuple[zipfile.ZipFile, dict, list[dict]]:
    if path.name != PACK:
        raise ImportRejected("REJECTED_LICENSE: only BlendSwap-CC-0.sh3f is approved")
    archive = zipfile.ZipFile(path)
    infos = archive.infolist()
    if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
        archive.close()
        raise ImportRejected("UNSAFE_ARCHIVE_SIZE")
    names = set()
    for info in infos:
        _safe_name(info.filename)
        if info.file_size > MAX_SINGLE_BYTES or (info.external_attr >> 16) & 0o170000 == 0o120000:
            archive.close()
            raise ImportRejected(f"UNSAFE_ARCHIVE_ENTRY: {info.filename}")
        if info.filename in names:
            archive.close()
            raise ImportRejected(f"DUPLICATE_ARCHIVE_ENTRY: {info.filename}")
        names.add(info.filename)
    if "PluginFurnitureCatalog.properties" not in names:
        archive.close()
        raise ImportRejected("MISSING_CATALOG")
    props = _properties(archive.read("PluginFurnitureCatalog.properties"))
    if not license_allowed(props.get("license")):
        archive.close()
        raise ImportRejected("REJECTED_LICENSE: catalog is not CC0/public domain")
    records = []
    for index in sorted({int(k.split("#", 1)[1]) for k in props if re.fullmatch(r"model#\d+", k)}):
        model = props[f"model#{index}"].lstrip("/")
        if model not in names or not model.lower().endswith(".obj"):
            continue
        item = {"index": index, "name": props.get(f"name#{index}", ""),
                "category": props.get(f"category#{index}", ""),
                "model": model, "creator": props.get(f"creator#{index}", "Unknown"),
                "license": props.get(f"license#{index}", ""),
                "movable": props.get(f"movable#{index}") == "true",
                "elevation_cm": float(props.get(f"elevation#{index}", "0")),
                "model_rotation": props.get(f"modelRotation#{index}"),
                "dimensions_m": [float(props[f"{axis}#{index}"]) / 100 for axis in ("width", "depth", "height")]}
        records.append(item)
    return archive, props, records


def _extract_model(archive: zipfile.ZipFile, model: str, directory: Path) -> Path:
    parent = PurePosixPath(model).parent
    for info in archive.infolist():
        if info.is_dir() or PurePosixPath(info.filename).parent != parent:
            continue
        target = directory.joinpath(*_safe_name(info.filename).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(info))
    return directory.joinpath(*PurePosixPath(model).parts)


def _convert(archive: zipfile.ZipFile, record: dict, output: Path, source_hash: str) -> dict:
    index = record["index"]
    role = CURATED[index][1]
    asset_id = f"sh3d_blendswap_{role}_{index:03d}"
    base = {"id": asset_id, "name": record["name"], "semantic_role": role,
            "category": role, "source_category": record["category"],
            "source_collection": "Sweet Home 3D BlendSwap CC0", "source_repository": SOURCE,
            "upstream_source": UPSTREAM, "source_pack": PACK,
            "original_creator": record["creator"], "license": "CC0-1.0",
            "commercial_use": True, "redistribution": True, "source_sha256": source_hash,
            "source_model": record["model"], "movable": record["movable"],
            "elevation_m": record["elevation_cm"] / 100,
            "model_rotation": record["model_rotation"], "status": "NEEDS_REVIEW", "diagnostics": []}
    if not license_allowed(record["license"]):
        return base | {"status": "REJECTED", "diagnostics": ["REJECTED_LICENSE"]}
    parent = PurePosixPath(record["model"]).parent
    evidence = [info.filename for info in archive.infolist() if
                PurePosixPath(info.filename).parent == parent and "license" in info.filename.lower()]
    verified = []
    for name in evidence:
        data = archive.read(name)
        if re.search(rb"Creative Commons Zero|Public Domain|CC-0|CC0", data, re.I):
            verified.append((name, data))
    if not verified:
        return base | {"status": "REJECTED", "diagnostics": ["REJECTED_LICENSE: no individual CC0 evidence"]}
    base["license_evidence"] = verified[0][0]
    base["license_evidence_sha256"] = hashlib.sha256(verified[0][1]).hexdigest()
    base["source_model_sha256"] = hashlib.sha256(archive.read(record["model"])).hexdigest()
    try:
        with tempfile.TemporaryDirectory() as temp:
            path = _extract_model(archive, record["model"], Path(temp))
            scene = trimesh.load(path, force="scene", process=False)
            if not scene.geometry:
                raise ValueError("EMPTY_GEOMETRY")
            triangles = sum(len(mesh.faces) for mesh in scene.geometry.values())
            if triangles > MAX_TRIANGLES:
                raise ValueError(f"TRIANGLE_LIMIT: {triangles}")
            bounds = np.asarray(scene.bounds, dtype=float)
            size = bounds[1] - bounds[0]
            # SH3D stores width/depth/height while OBJ uses X/Y/Z.
            declared = np.asarray(record["dimensions_m"])[[0, 2, 1]]
            actual = size / 100  # Sweet Home 3D OBJ coordinates are centimetres.
            if not np.isfinite(actual).all() or (actual <= 0).any():
                raise ValueError("INVALID_BOUNDS")
            ratio = actual / declared
            if (ratio < .85).any() or (ratio > 1.15).any():
                base["diagnostics"].append(f"DIMENSION_MISMATCH: measured {actual.round(3).tolist()} vs declared {declared.round(3).tolist()}")
                return base | {"triangles": triangles, "measured_dimensions_m": actual.round(4).tolist()}
            # Metadata dimensions are the user-facing physical scale. Preserve
            # shape; the source's uniform scale mismatch is recorded separately.
            scene.apply_translation(-np.array([(bounds[0, 0] + bounds[1, 0]) / 2, bounds[0, 1],
                                               (bounds[0, 2] + bounds[1, 2]) / 2]))
            scene.apply_scale(.01)
            runtime = output / f"{asset_id}.glb"
            runtime.write_bytes(scene.export(file_type="glb"))
            check = trimesh.load(runtime, force="scene")
            if not check.geometry or not np.isfinite(check.bounds).all():
                runtime.unlink(missing_ok=True)
                raise ValueError("INVALID_RUNTIME_GLB")
            base.update(status="APPROVED", triangles=triangles,
                        measured_dimensions_m=actual.round(4).tolist(),
                        declared_dimensions_m=declared.round(4).tolist(),
                        width_m=round(float(actual[0]), 4), depth_m=round(float(actual[2]), 4),
                        height_m=round(float(actual[1]), 4),
                        pivot="floor_center", forward_axis="+Z", placement_type="floor",
                        glb_path=f"/interiors/models/{asset_id}.glb",
                        runtime_sha256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
                        runtime_bytes=runtime.stat().st_size,
                        geometry_count=len(check.geometry),
                        material_count=len({str(getattr(g.visual, 'material', None)) for g in scene.geometry.values()}),
                        compatible_room_types=[CURATED[index][0]],
                        curation_priority=10,
                        preferred_wall_relation="back_to_wall" if role in ("sofa", "bed", "armchair", "wardrobe", "desk", "tv_stand", "shelving") else "centered",
                        clearance={"front_m": .7 if role not in ("dining_chair", "bedside") else .4, "side_m": .15})
    except Exception as error:
        base["diagnostics"].append(f"CONVERSION_FAILED: {error}")
    return base


def run(source: Path, output: Path, manifest: Path) -> list[dict]:
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    archive, _, records = inspect_archive(source)
    output.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        for record in records:
            if record["index"] in CURATED:
                results.append(_convert(archive, record, output, source_hash))
    finally:
        archive.close()
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps({"schema_version": 1, "source_sha256": source_hash,
                                    "source_pack": PACK, "catalog_records": len(records),
                                    "assets": results}, indent=2) + "\n", encoding="utf-8")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "public/interiors/models")
    parser.add_argument("--manifest", type=Path, default=ROOT / "services/reconstruction/assets_manifest.json")
    args = parser.parse_args()
    results = run(args.source, args.output, args.manifest)
    print(json.dumps({status: sum(item["status"] == status for item in results)
                      for status in ("APPROVED", "NEEDS_REVIEW", "REJECTED")}, indent=2))
