"""Deterministic furnishing and physical-scale regression tests."""

import io
import json
import math
from pathlib import Path

import pytest
import trimesh
from PIL import Image
from shapely.geometry import Polygon

from geometry import build_model
from interiors import ASSETS, _exclusions, _footprint, build_interior_layer, furnish_room
from tools.render_interior_reference import VIEWS, render


def room(kind, polygon, name=None):
    shape = Polygon(polygon)
    center = shape.representative_point()
    return {"id": name or kind, "name": name or kind, "level_id": "ground", "category": "indoor",
            "space_type": kind, "polygon": polygon, "center": [center.x, 0, center.y]}


def rectangle(kind, width, depth, name=None):
    return room(kind, [[0, 0], [width, 0], [width, depth], [0, depth]], name)


def wall(a, b, opening_type, left, right, room_id):
    return {"id": f"wall-{a}-{b}", "start": a, "end": b, "level_id": "ground",
            "left_space_id": room_id, "right_space_id": None,
            "openings": [{"id": "opening", "type": opening_type, "start": left, "end": right}]}


def assert_safe(room_record, walls, items):
    shape = Polygon(room_record["polygon"])
    exclusions = _exclusions(room_record, walls, [])
    footprints = []
    for item in items:
        asset = next(asset for asset in ASSETS if asset["id"] == item["asset_id"])
        assert all(math.isfinite(value) for value in (*item["position"], item["rotation_y"], item["scale"]))
        assert item["scale"] == 1
        assert item["room_id"] == room_record["id"]
        footprint = _footprint(asset, item["position"][0], item["position"][2], item["rotation_y"])
        assert shape.buffer(1e-6).covers(footprint)
        assert not exclusions.intersects(footprint)
        assert all(not footprint.intersects(other) for other in footprints)
        footprints.append(footprint)


@pytest.mark.parametrize("record,walls,min_count,max_count", [
    (rectangle("living_room", 7, 6), [], 3, 4),
    (rectangle("living_room", 2.3, 5, "narrow"), [], 0, 2),
    (rectangle("living_room", 6, 5, "doors"), [wall([0, 0], [6, 0], "door", .1, .35, "doors"),
                                              wall([6, 0], [6, 5], "entrance", .4, .65, "doors")], 0, 4),
    (rectangle("bedroom", 2.1, 2.1, "tiny-bedroom"), [], 0, 0),
    (rectangle("bedroom", 5, 4, "window-bedroom"), [wall([0, 0], [5, 0], "window", .15, .85, "window-bedroom")], 1, 3),
    (room("dining_room", [[0, 0], [5, 0], [5, 2], [4, 2], [4, 5], [0, 5]], "irregular"), [], 1, 3),
    (rectangle("office", 4, 4), [], 1, 2),
])
def test_placement_is_safe_and_deterministic(record, walls, min_count, max_count):
    items, diagnostics = furnish_room(record, walls, [])
    assert min_count <= len(items) <= max_count
    assert diagnostics
    assert_safe(record, walls, items)
    assert (items, diagnostics) == furnish_room(record, walls, [])


def test_preset_and_removed_asset_do_not_change_structure():
    record = rectangle("living_room", 7, 6)
    normal = build_interior_layer([record], [], [])
    empty = build_interior_layer([record], [], [], [{"room_id": record["id"], "preset": "unfurnished"}])
    assert normal["furniture_instances"]
    assert empty["furniture_instances"] == normal["furniture_instances"]
    assert normal["surface_assignments"] == empty["surface_assignments"]
    assert not any(item["asset_id"] == "sofa" for item in furnish_room(record, [], [], removed=["sofa"])[0])


def test_glb_uvs_are_in_world_metres_and_scene_is_versioned():
    level = {"id": "ground", "name": "Ground", "elevation": 0, "canvas_width": 1200, "canvas_height": 900}
    record = {"id": "living", "level_id": "ground", "name": "Living", "category": "indoor",
              "space_type": "living_room", "height": 2.7}
    polygon = {"room_id": "living", "level_id": "ground", "points": [
        {"x": .1, "y": .1}, {"x": .7, "y": .1}, {"x": .7, "y": .8}, {"x": .1, "y": .8}]}
    glb, encoded = build_model({"id": "property", "layout_width_m": 12}, [level], [record], [polygon], [])
    manifest = json.loads(encoded)
    assert manifest["schema_version"] == 3
    assert manifest["furniture_assets"] and manifest["surface_assignments"]
    model = trimesh.load(io.BytesIO(glb), file_type="glb", force="scene")
    floor = model.geometry["room_living"]
    assert floor.visual.uv is not None
    assert floor.visual.uv[:, 0].max() - floor.visual.uv[:, 0].min() == pytest.approx(7.2)
    assert floor.visual.uv[:, 1].max() - floor.visual.uv[:, 1].min() == pytest.approx(6.3)
    wall_meshes = [mesh for name, mesh in model.geometry.items() if name.startswith("wall_legacy")]
    assert wall_meshes and all(mesh.visual.uv is not None for mesh in wall_meshes)
    assert not any(name.startswith("sofa") for name in model.geometry), "Furniture stays out of shell GLB"


def test_curated_glbs_match_declared_scale_and_pivot():
    base = Path(__file__).resolve().parents[2] / "public" / "interiors" / "models"
    for asset in ASSETS:
        encoded = (base / f"{asset['id']}.glb").read_bytes()
        assert encoded[:4] == b"glTF" and len(encoded) < 1_500_000
        model = trimesh.load(io.BytesIO(encoded), file_type="glb", force="scene")
        assert len(model.graph.nodes_geometry) < 40
        assert len(model.bounds) == 2
        size = model.bounds[1] - model.bounds[0]
        expected = [asset["width_m"], asset["height_m"], asset["depth_m"]]
        assert all(.65 * declared <= actual <= declared + .005 for actual, declared in zip(size, expected))
        assert abs(model.bounds[0][1]) < .05


def test_reference_visual_regression():
    root = Path(__file__).resolve().parents[2]
    scene = json.loads((root / "public/interiors/reference/scene.json").read_text(encoding="utf-8"))
    baselines = Path(__file__).resolve().parent / "tests/interiors/baselines"
    for name, view in VIEWS.items():
        actual = render(scene, view)
        with Image.open(baselines / f"{name}.png") as baseline:
            expected = baseline.convert("RGB")
            assert actual.size == expected.size
            difference = sum(abs(a-b) for a, b in zip(actual.tobytes(), expected.tobytes())) / len(actual.tobytes())
            assert difference <= 1.5, f"{name} fixed-camera layout/material view changed: {difference:.3f}"
