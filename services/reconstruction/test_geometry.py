import json

import trimesh
import pytest
from shapely.geometry import Point, Polygon

from geometry import _end_cap, _legacy_walls, _panel_mesh, build_model


@pytest.mark.parametrize('kind', ['straight', 'l_shaped', 'u_shaped', 'spiral'])
def test_stair_features_are_open_flights_with_destination_slab_hole(kind):
    prop = {'id': 'stair-property', 'layout_width_m': 12}
    levels = [{'id': 'ground', 'name': 'Ground', 'elevation': 0, 'canvas_width': 1200, 'canvas_height': 900},
              {'id': 'upper', 'name': 'Upper', 'elevation': 3, 'canvas_width': 1200, 'canvas_height': 900}]
    rooms = [{'id': 'lower-room', 'level_id': 'ground', 'name': 'Lower', 'category': 'indoor', 'height': 2.7},
             {'id': 'upper-room', 'level_id': 'upper', 'name': 'Upper', 'category': 'indoor', 'height': 2.7}]
    outline = [{'x':.1,'y':.1},{'x':.9,'y':.1},{'x':.9,'y':.9},{'x':.1,'y':.9}]
    polygons = [{'room_id':room['id'], 'level_id':room['level_id'], 'points':outline} for room in rooms]
    stair = {'id':'stair-one','source_level_id':'ground','destination_level_id':'upper','type':kind,
             'footprint':[{'x':.4,'y':.3},{'x':.6,'y':.3},{'x':.6,'y':.7},{'x':.4,'y':.7}],
             'width_m':1.1,'total_rise_m':3,'direction':'north','step_count':16,
             'railing':True,'railing_height_m':1.05}
    graphs = [{'level_id':'ground','graph':{'walls':[],'vertices':[],'stairs':[stair]}},
              {'level_id':'upper','graph':{'walls':[],'vertices':[],'stairs':[]}}]
    glb, encoded = build_model(prop,levels,rooms,polygons,[],graphs)
    manifest = json.loads(encoded)
    scene = trimesh.load(file_obj=__import__('io').BytesIO(glb), file_type='glb', force='scene')
    names = list(scene.graph.nodes_geometry)
    steps = [name for name in names if name.startswith('stair_stair-one_step_')]
    assert len(steps) == 16
    assert not any(name.startswith('wall_') for name in names), 'Stair footprint must not synthesize walls'
    assert manifest['stairs'][0]['rise_m'] == 3
    assert manifest['stairs'][0]['type'] == kind
    heights = [scene.geometry[name].bounds[1,1] for name in steps]
    assert min(heights) > 0 and max(heights) == pytest.approx(3)
    if kind in ('l_shaped','u_shaped'):
        landing = scene.geometry['stair_stair-one_landing']
        assert landing.bounds[1,1] == pytest.approx(1.5)
    rails = [scene.geometry[name] for name in names if name.startswith('stair_rail_stair-one_')]
    assert rails and all(mesh.extents[1] <= 1.05 + 1e-6 for mesh in rails)
    upper_floor = scene.geometry['room_upper-room']
    outer_area = Polygon([(p['x'] * 12, p['y'] * 9) for p in outline]).area
    stair_area = Polygon([(p['x'] * 12, p['y'] * 9) for p in stair['footprint']]).area
    assert upper_floor.area == pytest.approx(outer_area - stair_area, rel=1e-4)
    for face in upper_floor.faces:
        triangle = Polygon([(upper_floor.vertices[index][0], upper_floor.vertices[index][2]) for index in face])
        assert not triangle.contains(Point(0,0)), 'Upper slab must leave the stairwell open'


def test_legacy_stair_polygon_is_adapted_without_inferred_perimeter_walls():
    levels = [{'id':'lower','name':'Lower','elevation':0,'canvas_width':1200,'canvas_height':900},
              {'id':'upper','name':'Upper','elevation':3,'canvas_width':1200,'canvas_height':900}]
    rooms = [{'id':'living','level_id':'lower','name':'Living','category':'indoor','height':2.7},
             {'id':'old-stair','level_id':'lower','name':'Stairs','space_type':'stairs','category':'indoor','height':2.7},
             {'id':'above','level_id':'upper','name':'Above','category':'indoor','height':2.7}]
    polygons = [{'room_id':'living','level_id':'lower','points':[{'x':.1,'y':.1},{'x':.4,'y':.1},{'x':.4,'y':.9},{'x':.1,'y':.9}]},
                {'room_id':'old-stair','level_id':'lower','points':[{'x':.4,'y':.3},{'x':.6,'y':.3},{'x':.6,'y':.7},{'x':.4,'y':.7}]},
                {'room_id':'above','level_id':'upper','points':[{'x':.1,'y':.1},{'x':.9,'y':.1},{'x':.9,'y':.9},{'x':.1,'y':.9}]}]
    walls = _legacy_walls(polygons,rooms)['lower']
    assert not any(abs(a[0]-.4)<1e-7 and abs(b[0]-.4)<1e-7 and .3 <= (a[1]+b[1])/2 <= .7 for a,b in walls)
    glb, encoded = build_model({'id':'legacy-stair','layout_width_m':12},levels,rooms,polygons,[],None,
                               [{'id':'connection','space_id':'old-stair','destination_level_id':'upper','stair_type':'straight'}])
    manifest = json.loads(encoded)
    scene = trimesh.load(file_obj=__import__('io').BytesIO(glb),file_type='glb',force='scene')
    assert manifest['stairs'][0]['id'] == 'connection'
    assert not manifest['stairs_needing_review']
    assert 'room_old-stair' not in scene.graph.nodes_geometry


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


@pytest.mark.parametrize("other", [(.5, .1), (.5, .9), (.7, .25), (.75, .65)])
def test_corner_join_is_shared_and_bounded(other):
    vertices = {"corner": {"x": .5, "y": .5}, "east": {"x": .9, "y": .5},
                "other": {"x": other[0], "y": other[1]}}
    walls = [{"id": "east", "a": "corner", "b": "east", "kind": "exterior", "thickness": .18},
             {"id": "other", "a": "corner", "b": "other", "kind": "exterior", "thickness": .18}]
    first = _end_cap("corner", "east", walls[0], walls, vertices, 12, 9)
    second = _end_cap("corner", "other", walls[1], walls, vertices, 12, 9)
    points = lambda pair: sorted(tuple(round(float(axis), 6) for axis in point) for point in pair)
    assert points(first) == points(second), "Adjacent walls must share one joint cap"
    origin = __import__("numpy").array([0., 0.])
    assert all(__import__("numpy").linalg.norm(point - origin) < .46 for point in first)
    panel = _panel_mesh(first[0], first[1],
                        __import__("numpy").array([4.8, .09]), __import__("numpy").array([4.8, -.09]), 0, 2.7)
    assert panel.is_watertight
    assert panel.volume > 0


@pytest.mark.parametrize("branches", [2, 3])
def test_t_and_cross_junctions_use_bounded_caps(branches):
    vertices = {"center": {"x": .5, "y": .5}, "east": {"x": .9, "y": .5},
                "west": {"x": .1, "y": .5}, "north": {"x": .5, "y": .1},
                "south": {"x": .5, "y": .9}}
    walls = [{"id": name, "a": "center", "b": name, "kind": "interior", "thickness": .1}
             for name in ["east", "west", "north", "south"][:branches + 1]]
    left, right = _end_cap("center", "east", walls[0], walls, vertices, 12, 9)
    assert __import__("numpy").linalg.norm(left) == pytest.approx(.05)
    assert __import__("numpy").linalg.norm(right) == pytest.approx(.05)


def test_filleted_footprint_exports_connected_bounded_wall_panels():
    coordinates = [("a", .1, .2), ("f1", .105, .16), ("f2", .13, .12),
                   ("f3", .17, .105), ("f4", .2, .1), ("b", .8, .1),
                   ("c", .8, .8), ("d", .1, .8)]
    points = [{"x": x, "y": y} for _, x, y in coordinates]
    vertices = [{"id": key, "x": x, "y": y} for key, x, y in coordinates]
    walls = [{"id": f"fillet{i}", "a": coordinates[i][0],
              "b": coordinates[(i + 1) % len(coordinates)][0],
              "kind": "exterior", "height": 2.7, "thickness": .18}
             for i in range(len(coordinates))]
    glb, _ = build_model({"id": "fillet", "layout_width_m": 12},
                         [{"id": "level", "name": "Fillet level", "elevation": 0, "canvas_width": 1200, "canvas_height": 900}],
                         [{"id": "room", "name": "Fillet room", "level_id": "level", "category": "indoor", "height": 2.7}],
                         [{"room_id": "room", "level_id": "level", "points": points}], [],
                         [{"level_id": "level", "graph": {"vertices": vertices, "walls": walls, "openings": []}}])
    scene = trimesh.load(file_obj=__import__('io').BytesIO(glb), file_type='glb', force='scene')
    panels = [scene.geometry[scene.graph.get(node)[1]] for node in scene.graph.nodes_geometry
              if node.startswith('wall_fillet')]
    assert len(panels) == len(walls)
    assert all(panel.is_watertight and panel.volume > 0 for panel in panels)
    floor = scene.geometry[scene.graph.get('room_room')[1]]
    assert all(panel.bounds[0, axis] >= floor.bounds[0, axis] - .25 and
               panel.bounds[1, axis] <= floor.bounds[1, axis] + .25
               for panel in panels for axis in (0, 2))


def test_multiple_openings_and_outdoor_edges_do_not_create_full_height_rails():
    prop = {"id": "mixed", "layout_width_m": 12}
    levels = [{"id": "ground", "name": "Ground", "elevation": 0, "canvas_width": 1200, "canvas_height": 900}]
    rooms = [{"id": "inside", "level_id": "ground", "name": "Inside", "category": "indoor", "height": 2.7},
             {"id": "balcony", "level_id": "ground", "name": "Balcony", "category": "outdoor", "space_type": "balcony", "height": .1},
             {"id": "porch", "level_id": "ground", "name": "Porch", "category": "outdoor", "space_type": "porch", "height": .1}]
    polygons = [{"room_id": "inside", "level_id": "ground", "points": [{"x": .1, "y": .1}, {"x": .7, "y": .1}, {"x": .7, "y": .7}, {"x": .1, "y": .7}]},
                {"room_id": "balcony", "level_id": "ground", "points": [{"x": .72, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .35}, {"x": .72, "y": .35}]},
                {"room_id": "porch", "level_id": "ground", "points": [{"x": .72, "y": .4}, {"x": .9, "y": .4}, {"x": .9, "y": .65}, {"x": .72, "y": .65}]}]
    vertices = [{"id": key, "x": xy[0], "y": xy[1]} for key, xy in [("a",(.1,.1)),("b",(.7,.1)),("c",(.7,.7)),("d",(.1,.7))]]
    walls = [{"id": f"w{i}", "a": a, "b": b, "kind": "exterior", "height": 2.7, "thickness": .18}
             for i, (a,b) in enumerate([("a","b"),("b","c"),("c","d"),("d","a")])]
    openings = [{"id": key, "wall_id": "w0", "type": kind, "start": start, "end": end, "height": height, "sill": sill}
                for key,kind,start,end,height,sill in [("window1","standard_window",.08,.2,1.2,.9),
                    ("passage","entrance",.28,.45,2.7,0), ("window2","standard_window",.6,.75,1.2,.9)]]
    graph = {"vertices": vertices, "walls": walls, "openings": openings,
             "site_edges": [{"room_id": "balcony", "segment_index": 0, "behavior": "open", "height": 0, "thickness": .06},
                            {"room_id": "porch", "segment_index": 1, "behavior": "railing", "height": 1.1, "thickness": .06}]}
    glb, encoded = build_model(prop, levels, rooms, polygons, [], [{"level_id": "ground", "graph": graph}])
    manifest = json.loads(encoded)
    assert len(manifest['walls']) == 4
    assert len(manifest['walls'][0]['openings']) == 3
    assert {edge['behavior'] for edge in manifest['site_edges'] if edge['room_id'] == 'balcony'} == {'open','railing'}
    assert {edge['behavior'] for edge in manifest['site_edges'] if edge['room_id'] == 'porch'} == {'open','railing'}
    scene = trimesh.load(file_obj=__import__('io').BytesIO(glb), file_type='glb', force='scene')
    assert len([node for node in scene.graph.nodes_geometry if node.startswith('wall_w0_')]) == 8
    assert not any(node.startswith('edge_balcony_0_') for node in scene.graph.nodes_geometry)
    assert not any(node.startswith('edge_porch_0_') for node in scene.graph.nodes_geometry)
    for node in scene.graph.nodes_geometry:
        if node.startswith('edge_balcony_') or node.startswith('edge_porch_'):
            transform, mesh_name = scene.graph.get(node)
            mesh = scene.geometry[mesh_name].copy()
            mesh.apply_transform(transform)
            assert mesh.bounds[1][1] <= 1.11, 'Guardrails must stay well below full wall height'
