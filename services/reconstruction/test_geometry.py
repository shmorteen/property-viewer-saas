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
    assert any(node.startswith("wall_legacy_level-1") for node in loaded.graph.nodes_geometry)
    assert len([node for node in loaded.graph.nodes_geometry if node.startswith("wall_legacy_")]) == 4
    assert len(glb) < 200_000


def test_no_polygons_reports_useful_error():
    try:
        build_model({"id": "property-1"}, [], [], [], [])
    except ValueError as exc:
        assert "Draw at least one room" in str(exc)
    else:
        raise AssertionError("Expected a missing layout error")


def test_shared_wall_and_openings_are_cut_once():
    prop = {"id": "property-2", "layout_width_m": 12}
    levels = [{"id": "floor", "name": "Ground", "elevation": 0, "canvas_width": 1200, "canvas_height": 900}]
    rooms = [{"id": "left", "level_id": "floor", "name": "Bedroom", "category": "indoor", "height": 2.7},
             {"id": "right", "level_id": "floor", "name": "Living room", "category": "indoor", "height": 2.7}]
    polygons = [
        {"level_id": "floor", "room_id": "left", "points": [{"x": .1, "y": .1}, {"x": .5, "y": .1}, {"x": .5, "y": .7}, {"x": .1, "y": .7}]},
        {"level_id": "floor", "room_id": "right", "points": [{"x": .5, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .7}, {"x": .5, "y": .7}]},
    ]
    vertices = [{"id": "a", "x": .1, "y": .1}, {"id": "b", "x": .5, "y": .1}, {"id": "c", "x": .9, "y": .1},
                {"id": "d", "x": .9, "y": .7}, {"id": "e", "x": .5, "y": .7}, {"id": "f", "x": .1, "y": .7}]
    walls = [{"id": f"w{i}", "a": a, "b": b, "kind": kind, "height": 2.7, "thickness": .1}
             for i, (a,b,kind) in enumerate([("a","b","exterior"),("b","c","exterior"),("c","d","exterior"),
                                              ("d","e","exterior"),("e","f","exterior"),("f","a","exterior"),
                                              ("b","e","interior")])]
    graph = {"vertices": vertices, "walls": walls, "openings": [
        {"id": "door", "wall_id": "w6", "type": "standard_door", "start": .15, "end": .4, "height": 2.1, "sill": 0, "swing": 1},
        {"id": "window", "wall_id": "w2", "type": "standard_window", "start": .2, "end": .6, "height": 1.2, "sill": .9, "swing": 1}]}
    glb, scene_bytes = build_model(prop, levels, rooms, polygons, [], [{"level_id": "floor", "graph": graph}])
    manifest = json.loads(scene_bytes)
    assert len(manifest["walls"]) == 7
    assert {w["id"] for w in manifest["walls"]} == {w["id"] for w in walls}
    divider = next(w for w in manifest["walls"] if w["id"] == "w6")
    assert {divider["left_space_id"], divider["right_space_id"]} == {"left", "right"}
    loaded = trimesh.load(file_obj=__import__("io").BytesIO(glb), file_type="glb", force="scene")
    assert len([n for n in loaded.graph.nodes_geometry if n.startswith("wall_w6_")]) == 3, "Door has two side panels and a header"
    assert len([n for n in loaded.graph.nodes_geometry if n.startswith("wall_w2_")]) == 4, "Window has side, sill and header panels"


def test_nine_room_40_by_30_plan_and_distinct_upper_footprint():
    axes = [.1, .3667, .6333, .9]
    vertices = [{"id": f"v{x}{y}", "x": axes[x], "y": axes[y]} for x in range(4) for y in range(4)]
    walls = []
    for y in range(4):
        for x in range(3):
            walls.append({"id": f"h{x}{y}", "a": f"v{x}{y}", "b": f"v{x+1}{y}",
                          "kind": "exterior" if y in (0,3) else "interior", "height": 2.7, "thickness": .12})
    for x in range(4):
        for y in range(3):
            walls.append({"id": f"v{x}{y}", "a": f"v{x}{y}", "b": f"v{x}{y+1}",
                          "kind": "exterior" if x in (0,3) else "interior", "height": 2.7, "thickness": .12})
    names = ["Bedroom 1", "Bedroom 2", "Bedroom 3", "Bathroom", "Living room", "Dining room", "Kitchen", "Closet", "Washroom"]
    rooms, polygons = [], []
    for y in range(3):
        for x in range(3):
            idx = y * 3 + x
            rid = f"room-{idx}"
            rooms.append({"id": rid, "level_id": "ground", "name": names[idx], "category": "indoor", "height": 2.7})
            polygons.append({"room_id": rid, "level_id": "ground", "points": [
                {"x": axes[x], "y": axes[y]}, {"x": axes[x+1], "y": axes[y]},
                {"x": axes[x+1], "y": axes[y+1]}, {"x": axes[x], "y": axes[y+1]}]})
    upper_vertices = [{"id": "ua", "x": .2, "y": .2}, {"id": "ub", "x": .8, "y": .2},
                      {"id": "uc", "x": .8, "y": .8}, {"id": "ud", "x": .2, "y": .8}]
    upper_walls = [{"id": f"upper-{i}", "a": a, "b": b, "kind": "exterior", "height": 2.7, "thickness": .18}
                   for i, (a,b) in enumerate([("ua","ub"),("ub","uc"),("uc","ud"),("ud","ua")])]
    rooms.append({"id": "upper-room", "level_id": "upper", "name": "Office", "category": "indoor", "height": 2.7})
    polygons.append({"room_id": "upper-room", "level_id": "upper", "points": [
        {"x": .2, "y": .2}, {"x": .8, "y": .2}, {"x": .8, "y": .8}, {"x": .2, "y": .8}]})
    levels = [{"id": "ground", "name": "Ground", "elevation": 0, "canvas_width": 1200, "canvas_height": 900},
              {"id": "upper", "name": "Upper", "elevation": 2.7, "canvas_width": 1200, "canvas_height": 900}]
    graphs = [{"level_id": "ground", "graph": {"vertices": vertices, "walls": walls,
        "openings": [{"id": "room-door", "wall_id": "v10", "type": "standard_door", "start": .2, "end": .6, "height": 2.1, "sill": 0, "swing": 1}]}},
        {"level_id": "upper", "graph": {"vertices": upper_vertices, "walls": upper_walls,
        "openings": [{"id": "upper-window", "wall_id": "upper-1", "type": "standard_window", "start": .2, "end": .7, "height": 1.2, "sill": .9, "swing": 1}]}}]
    glb, scene_bytes = build_model({"id": "nine-room-plan", "layout_width_m": 15.24}, levels, rooms, polygons, [], graphs)
    manifest = json.loads(scene_bytes)
    assert len(manifest["rooms"]) == 10
    assert len(manifest["walls"]) == 28
    assert len({(w["level_id"], w["id"]) for w in manifest["walls"]}) == 28
    assert sum(w["kind"] == "interior" for w in manifest["walls"]) == 12
    ground_x = [coordinate[0] for room in manifest["rooms"] if room["level_id"] == "ground" for coordinate in room["polygon"]]
    ground_z = [coordinate[1] for room in manifest["rooms"] if room["level_id"] == "ground" for coordinate in room["polygon"]]
    assert max(ground_x) - min(ground_x) == pytest.approx(12.192, rel=.001)  # 40 ft
    assert max(ground_z) - min(ground_z) == pytest.approx(9.144, rel=.001)  # 30 ft
    scene = trimesh.load(file_obj=__import__("io").BytesIO(glb), file_type="glb", force="scene")
    assert len([node for node in scene.graph.nodes_geometry if node.startswith("room_")]) == 10
    assert len([node for node in scene.graph.nodes_geometry if node.startswith("wall_v10_")]) == 3
    assert len([node for node in scene.graph.nodes_geometry if node.startswith("wall_upper-1_")]) == 4
