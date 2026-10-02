import json

import trimesh
import pytest

from geometry import build_model


def test_multi_room_glb_preserves_ids_and_scale():
    property_row = {"id": "property-1", "layout_width_m": 12}
    levels = [{"id": "level-1", "name": "Ground Floor", "elevation": 0,
               "canvas_width": 1200, "canvas_height": 900}]
    rooms = [
        {"id": "room-a", "level_id": "level-1", "name": "Living Room",
         "category": "indoor", "height": 2.7},
        {"id": "room-b", "level_id": "level-1", "name": "Garden",
         "category": "outdoor", "height": 2.7},
    ]
    polygons = [
        {"room_id": "room-a", "points": [
            {"x": .1, "y": .1}, {"x": .5, "y": .1},
            {"x": .5, "y": .5}, {"x": .1, "y": .5}]},
        {"room_id": "room-b", "points": [
            {"x": .55, "y": .1}, {"x": .9, "y": .1},
            {"x": .9, "y": .5}, {"x": .55, "y": .5}]},
    ]
    photos = [{"id": "photo-a", "room_id": "room-a", "alt_text": "Living room",
               "sort_order": 0, "width": 2000, "height": 1400}]
    glb, manifest_bytes = build_model(property_row, levels, rooms, polygons, photos)
    manifest = json.loads(manifest_bytes)
    loaded = trimesh.load(file_obj=__import__("io").BytesIO(glb), file_type="glb", force="scene")
    assert {room["id"] for room in manifest["rooms"]} == {"room-a", "room-b"}
    assert manifest["rooms"][0]["photo_ids"] == ["photo-a"]
    assert manifest["rooms"][0]["polygon"][0] == pytest.approx([-4.8, 3.6])
    assert manifest["rooms"][0]["camera_anchor"][1] == 1.6
    assert "room_room-a" in loaded.graph.nodes_geometry
    assert "room_room-b" in loaded.graph.nodes_geometry
    assert any(node.startswith("wall_room-a") for node in loaded.graph.nodes_geometry)
    assert not any(node.startswith("wall_room-b") for node in loaded.graph.nodes_geometry)
    assert len(glb) < 200_000


def test_no_polygons_reports_useful_error():
    try:
        build_model({"id": "property-1"}, [], [], [], [])
    except ValueError as exc:
        assert "Draw at least one room" in str(exc)
    else:
        raise AssertionError("Expected a missing layout error")
