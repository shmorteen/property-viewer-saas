"""Deterministic, open-top geometry from the editor's normalized polygons.

GLB coordinates are metres with Y up. A level's canvas width is scaled to
property.layout_width_m; its height retains the canvas aspect ratio.
"""

from __future__ import annotations

import io
import json
import math
from typing import Any

import numpy as np
import trimesh
from shapely.geometry import Polygon, Point
from shapely.ops import triangulate, unary_union
from shapely.geometry import LineString


def _world_point(point: dict, width: float, depth: float) -> tuple[float, float]:
    x, y = float(point["x"]), float(point["y"])
    if not math.isfinite(x) or not math.isfinite(y) or not (0 <= x <= 1 and 0 <= y <= 1):
        raise ValueError("Polygon coordinates must be finite and normalized to 0–1")
    return ((x - 0.5) * width, (0.5 - y) * depth)


def _cross2(a: np.ndarray, b: np.ndarray) -> float:
    return float(a[0] * b[1] - a[1] * b[0])


def _line_intersection(p: np.ndarray, direction: np.ndarray, q: np.ndarray,
                       other: np.ndarray) -> np.ndarray | None:
    denominator = _cross2(direction, other)
    if abs(denominator) < 1e-7:
        return None
    return p + direction * _cross2(q - p, other) / denominator


def _end_cap(vertex_id: str, other_id: str, wall: dict, walls: list[dict],
             vertices: dict, width: float, depth: float) -> tuple[np.ndarray, np.ndarray]:
    """Two shared miter points, or a bounded flat cap at complex/acute joins."""
    origin = np.array(_world_point(vertices[vertex_id], width, depth))
    toward = np.array(_world_point(vertices[other_id], width, depth)) - origin
    direction = toward / np.linalg.norm(toward)
    normal = np.array([-direction[1], direction[0]])
    half = float(wall['thickness']) / 2
    plain = (origin + normal * half, origin - normal * half)
    neighbors = [item for item in walls if item['id'] != wall['id'] and
                 item['kind'] != 'virtual' and vertex_id in (item['a'], item['b'])]
    if len(neighbors) != 1:
        return plain
    neighbor = neighbors[0]
    neighbor_other = neighbor['b'] if neighbor['a'] == vertex_id else neighbor['a']
    n_direction = np.array(_world_point(vertices[neighbor_other], width, depth)) - origin
    n_direction /= np.linalg.norm(n_direction)
    turn = _cross2(direction, n_direction)
    if abs(turn) < .02:
        return plain
    n_normal = np.array([-n_direction[1], n_direction[0]])
    n_half = float(neighbor['thickness']) / 2
    left = _line_intersection(plain[0], direction, origin - n_normal * n_half, n_direction)
    right = _line_intersection(plain[1], direction, origin + n_normal * n_half, n_direction)
    limit = max(float(wall['thickness']), float(neighbor['thickness'])) * 2.5
    if left is None or right is None or max(np.linalg.norm(left - origin), np.linalg.norm(right - origin)) > limit:
        return plain
    return left, right


def _panel_mesh(start_left: np.ndarray, start_right: np.ndarray, end_left: np.ndarray,
                end_right: np.ndarray, bottom: float, top: float) -> trimesh.Trimesh:
    corners = [start_left, end_left, end_right, start_right]
    vertices = np.array([[x, y, z] for y in (bottom, top) for x, z in corners])
    faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7]]
    for i in range(4):
        j = (i + 1) % 4
        faces.extend(([i, j, j + 4], [i, j + 4, i + 4]))
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    if mesh.volume < 0:
        mesh.invert()
    return mesh


def _add_wall(scene: trimesh.Scene, start: tuple[float, float], end: tuple[float, float],
              elevation: float, height: float, thickness: float, name: str,
              openings: list[dict] | None = None,
              caps: tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]] | None = None) -> None:
    """Construct solid wall panels around normalized horizontal openings."""
    delta = np.array(end) - np.array(start)
    length = float(np.linalg.norm(delta))
    if length < .01:
        raise ValueError(f"Zero-length wall {name}")
    spans = []
    cursor = 0.0
    for opening in sorted(openings or [], key=lambda item: float(item['start'])):
        left, right = float(opening['start']), float(opening['end'])
        sill = float(opening.get('sill', 0))
        opening_height = float(opening['height'])
        entrance = opening.get('type') == 'entrance' or bool(opening.get('path_id'))
        if left < (0 if entrance else .02) or right > (1 if entrance else .98) or (left <= cursor + .005 and not (entrance and cursor == 0 and left == 0)) or right <= left or sill < 0 or sill + opening_height > height + 1e-6:
            raise ValueError(f"Invalid or overlapping opening on wall {name}")
        spans.append((cursor, left, 0.0, height))
        if sill > .001:
            spans.append((left, right, 0.0, sill))
        top = sill + opening_height
        if top < height - .001:
            spans.append((left, right, top, height))
        cursor = right
    spans.append((cursor, 1.0, 0.0, height))
    direction = delta / length
    normal = np.array([-direction[1], direction[0]]) * thickness / 2
    def section(position: float) -> tuple[np.ndarray, np.ndarray]:
        if caps and position < 1e-8:
            return caps[0]
        if caps and position > 1 - 1e-8:
            return caps[1]
        center = np.array(start) + delta * position
        return center + normal, center - normal
    for index, (left, right, bottom, top) in enumerate(spans):
        if right - left < .0001 or top - bottom < .0001:
            continue
        start_left, start_right = section(left)
        end_left, end_right = section(right)
        panel = _panel_mesh(start_left, start_right, end_left, end_right, elevation + bottom, elevation + top)
        panel.visual.vertex_colors = np.tile([230, 235, 230, 255], (len(panel.vertices), 1))
        scene.add_geometry(panel, node_name=f"{name}_{index}", geom_name=f"{name}_{index}")


def _legacy_walls(polygons: list[dict], rooms: list[dict]) -> dict[str, list[tuple[tuple[float, float], tuple[float, float]]]]:
    """Dissolve exact shared boundaries so older independent polygons do not double walls."""
    indoor = {room['id']: room for room in rooms if room.get('category') != 'outdoor' and room.get('space_type') != 'stairs'}
    by_level: dict[str, list[LineString]] = {}
    stair_edges: dict[str, list[LineString]] = {}
    for polygon in polygons:
        room = indoor.get(polygon['room_id'])
        stair_room = next((item for item in rooms if item['id'] == polygon['room_id'] and item.get('space_type') == 'stairs'), None)
        if stair_room:
            coordinates = [(float(p['x']), float(p['y'])) for p in polygon['points']]
            stair_edges.setdefault(stair_room['level_id'], []).append(LineString(coordinates + coordinates[:1]))
        if room:
            coordinates = [(float(p['x']), float(p['y'])) for p in polygon['points']]
            by_level.setdefault(room['level_id'], []).append(LineString(coordinates + coordinates[:1]))
    result: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = {}
    for level_id, lines in by_level.items():
        union = unary_union(lines + stair_edges.get(level_id, []))
        merged = list(union.geoms) if hasattr(union, 'geoms') else [union]
        result[level_id] = []
        for line in merged:
            coordinates = list(line.coords)
            result[level_id].extend((a, b) for a, b in zip(coordinates, coordinates[1:]) if a != b and
                                    not any(edge.distance(Point((a[0]+b[0])/2,(a[1]+b[1])/2)) < 1e-7 for edge in stair_edges.get(level_id, [])))
    return result


def _stair_features(levels: list[dict], rooms: list[dict], polygons: list[dict],
                    graphs: list[dict], connections: list[dict], property_width: float) -> tuple[list[dict], list[str]]:
    """Keep new feature stairs separate from rooms; adapt safe connected legacy stairs in memory."""
    features = [stair for row in graphs for stair in row['graph'].get('stairs', [])]
    level_by_id = {level['id']: level for level in levels}
    room_by_id = {room['id']: room for room in rooms}
    polygon_by_room = {polygon['room_id']: polygon for polygon in polygons}
    review: list[str] = []
    connected = {item['space_id'] for item in connections}
    for connection in connections:
        room = room_by_id.get(connection['space_id'])
        polygon = polygon_by_room.get(connection['space_id'])
        if not room or room.get('space_type') != 'stairs' or not polygon or connection['destination_level_id'] not in level_by_id:
            review.append(connection['space_id'])
            continue
        if any(item.get('legacy_space_id') == room['id'] for item in features):
            continue
        source = level_by_id[room['level_id']]
        destination = level_by_id[connection['destination_level_id']]
        rise = float(destination['elevation']) - float(source['elevation'])
        if rise <= 0:
            review.append(room['id'])
            continue
        shape = Polygon([(p['x'], p['y']) for p in polygon['points']])
        if not shape.is_valid or shape.area < .0002:
            review.append(room['id'])
            continue
        x0, y0, x1, y1 = shape.bounds
        if shape.symmetric_difference(Polygon([(x0,y0),(x1,y0),(x1,y1),(x0,y1)])).area > .0001:
            review.append(room['id'])
            continue
        width = float(source.get('canvas_width') or 1200)
        depth = float(source.get('canvas_height') or 900)
        cross_size = min((x1-x0)*property_width, (y1-y0)*property_width*depth/width)
        if cross_size < (1.3 if connection['stair_type'] in ('l_shaped','u_shaped') else .7):
            review.append(room['id'])
            continue
        stair_width = min(1.1, cross_size*.42 if connection['stair_type'] in ('l_shaped','u_shaped') else cross_size*.9)
        if connection['stair_type'] == 'l_shaped' and (y1-y0)*property_width*depth/width < max(.6,stair_width)/.47:
            review.append(room['id'])
            continue
        features.append({'id': connection['id'], 'legacy_space_id': room['id'], 'source_level_id': room['level_id'],
                         'destination_level_id': destination['id'], 'type': connection['stair_type'],
                         'footprint': [{'x':x0,'y':y0},{'x':x1,'y':y0},{'x':x1,'y':y1},{'x':x0,'y':y1}],
                         'width_m': max(.6, stair_width), 'total_rise_m': rise, 'direction': 'north',
                         'step_count': max(8, min(40, round(rise/.17))), 'railing': False, 'railing_height_m': 1.05})
    review.extend(room['id'] for room in rooms if room.get('space_type') == 'stairs' and room['id'] not in connected)
    return features, review


def _add_stair_geometry(scene: trimesh.Scene, stair: dict, levels: dict[str, dict], property_width: float,
                        graphs: dict[str, dict]) -> dict:
    source = levels[stair['source_level_id']]
    destination = levels[stair['destination_level_id']]
    rise = float(destination['elevation']) - float(source['elevation'])
    if rise <= 0 or abs(float(stair['total_rise_m']) - rise) > .1:
        raise ValueError(f"Stair {stair['id']} has inconsistent level elevations")
    depth = property_width * float(source['canvas_height']) / float(source['canvas_width'])
    points = [_world_point(p, property_width, depth) for p in stair['footprint']]
    xmin, xmax = min(p[0] for p in points), max(p[0] for p in points)
    zmin, zmax = min(p[1] for p in points), max(p[1] for p in points)
    direction = stair.get('direction', 'north')
    if direction not in ('north', 'east', 'south', 'west'):
        raise ValueError('Unknown stair ascent direction')
    def at(u: float, v: float) -> tuple[float, float]:
        if direction == 'north': return xmin + u*(xmax-xmin), zmin + v*(zmax-zmin)
        if direction == 'south': return xmax - u*(xmax-xmin), zmax - v*(zmax-zmin)
        if direction == 'east': return xmin + v*(xmax-xmin), zmax - u*(zmax-zmin)
        return xmax - v*(xmax-xmin), zmin + u*(zmax-zmin)
    elevation = float(source['elevation'])
    step_count = int(stair['step_count'])
    if step_count < 3 or step_count > 60: raise ValueError('Invalid stair step count')
    cross_size = (xmax-xmin) if direction in ('north','south') else (zmax-zmin)
    run_size = (zmax-zmin) if direction in ('north','south') else (xmax-xmin)
    width_fraction = float(stair['width_m']) / cross_size
    if width_fraction <= 0 or width_fraction > .96:
        raise ValueError(f"Stair {stair['id']} width does not fit its footprint")
    def block(u0: float, u1: float, v0: float, v1: float, top: float, label: str) -> None:
        corners = [at(u,v) for u,v in ((u0,v0),(u1,v0),(u1,v1),(u0,v1))]
        x0,x1 = min(p[0] for p in corners), max(p[0] for p in corners)
        z0,z1 = min(p[1] for p in corners), max(p[1] for p in corners)
        height = max(.02, top-elevation)
        mesh = trimesh.creation.box(extents=[x1-x0,height,z1-z0])
        mesh.apply_translation([(x0+x1)/2,elevation+height/2,(z0+z1)/2])
        mesh.visual.vertex_colors = np.tile([181,171,151,255], (len(mesh.vertices),1))
        scene.add_geometry(mesh, node_name=f"stair_{stair['id']}_{label}", geom_name=f"stair_{stair['id']}_{label}")
    kind = stair['type']
    if kind == 'straight':
        u0, u1 = (1-width_fraction)/2, (1+width_fraction)/2
        for i in range(step_count): block(u0,u1,i/step_count,(i+1)/step_count,elevation+rise*(i+1)/step_count,f"step_{i}")
    elif kind == 'l_shaped':
        if width_fraction > .47 or float(stair['width_m']) / run_size > .47:
            raise ValueError('L stair needs a footprint wide enough for two flights and a landing')
        f = width_fraction
        side = float(stair['width_m']) / run_size
        first = step_count//2
        for i in range(first): block(.02,.02+f,.02+i*.49/first,.02+(i+1)*.49/first,elevation+rise*.5*(i+1)/first,f"step_{i}")
        block(.02,.02+f,.51,.51+side,elevation+rise*.5,'landing')
        second = step_count-first
        for i in range(second): block(.02+f+i*(.96-f)/second,.02+f+(i+1)*(.96-f)/second,.51,.51+side,elevation+rise*(.5+.5*(i+1)/second),f"step_{first+i}")
    elif kind == 'u_shaped':
        if width_fraction > .47:
            raise ValueError('U stair needs a footprint wide enough for two flights')
        f = width_fraction
        first = step_count//2
        for i in range(first): block(.02,.02+f,.02+i*.78/first,.02+(i+1)*.78/first,elevation+rise*.5*(i+1)/first,f"step_{i}")
        block(.02,.98,.8,.98,elevation+rise*.5,'landing')
        second = step_count-first
        for i in range(second): block(.98-f,.98,.8-(i+1)*.78/second,.8-i*.78/second,elevation+rise*(.5+.5*(i+1)/second),f"step_{first+i}")
    elif kind == 'spiral':
        cx, cz = (xmin+xmax)/2, (zmin+zmax)/2
        radius = min(xmax-xmin,zmax-zmin)*.46
        inner = max(.08, radius-float(stair['width_m']))
        for i in range(step_count):
            angle0 = 2*math.pi*i/step_count
            angle1 = 2*math.pi*(i+1)/step_count
            a0 = np.array([cx+inner*math.cos(angle0),cz+inner*math.sin(angle0)])
            a1 = np.array([cx+radius*math.cos(angle0),cz+radius*math.sin(angle0)])
            b0 = np.array([cx+inner*math.cos(angle1),cz+inner*math.sin(angle1)])
            b1 = np.array([cx+radius*math.cos(angle1),cz+radius*math.sin(angle1)])
            mesh = _panel_mesh(a0,a1,b0,b1,elevation,elevation+rise*(i+1)/step_count)
            mesh.visual.vertex_colors = np.tile([181,171,151,255],(len(mesh.vertices),1))
            scene.add_geometry(mesh,node_name=f"stair_{stair['id']}_step_{i}",geom_name=f"stair_{stair['id']}_step_{i}")
    else: raise ValueError('Unknown stair type')
    if stair.get('railing'):
        graph = graphs.get(stair['source_level_id'], {})
        vertices = {v['id']:v for v in graph.get('vertices',[])}
        wall_segments = [(_world_point(vertices[w['a']],property_width,depth),_world_point(vertices[w['b']],property_width,depth))
                         for w in graph.get('walls',[]) if w['kind'] != 'virtual' and w['a'] in vertices and w['b'] in vertices]
        for i,(a,b) in enumerate(zip(points,points[1:]+points[:1])):
            edge = LineString([a,b])
            if any(edge.distance(LineString([c,d])) < .12 and edge.intersection(LineString([c,d])).length > edge.length*.7 for c,d in wall_segments):
                continue
            _add_wall(scene,a,b,elevation+rise*.5, min(1.05,float(stair.get('railing_height_m',1.05))),.045,f"stair_rail_{stair['id']}_{i}")
    return {'id':stair['id'],'source_level_id':source['id'],'destination_level_id':destination['id'],'type':kind,
            'footprint':stair['footprint'],'step_count':step_count,'rise_m':rise,'railing_height_m':stair.get('railing_height_m',1.05)}


def build_model(property_row: dict, levels: list[dict], rooms: list[dict],
                polygons: list[dict], media: list[dict], layout_graphs: list[dict] | None = None,
                stair_connections: list[dict] | None = None) -> tuple[bytes, bytes]:
    width = float(property_row.get("layout_width_m") or 12)
    if not 2 <= width <= 100:
        raise ValueError("Building width must be between 2 and 100 metres")
    level_by_id = {level["id"]: level for level in levels}
    stair_features, stair_review = _stair_features(levels, rooms, polygons, layout_graphs or [], stair_connections or [], width)
    stair_holes: dict[str, list[Polygon]] = {}
    for stair in stair_features:
        destination = level_by_id.get(stair['destination_level_id'])
        if not destination or stair['source_level_id'] not in level_by_id:
            raise ValueError(f"Stair {stair['id']} refers to a missing level")
        source = level_by_id[stair['source_level_id']]
        source_depth = width * float(source['canvas_height']) / float(source['canvas_width'])
        stair_holes.setdefault(destination['id'], []).append(Polygon([_world_point(p,width,source_depth) for p in stair['footprint']]))
    media_by_room: dict[str, list[dict]] = {}
    for photo in media:
        media_by_room.setdefault(photo["room_id"], []).append(photo)
    scene = trimesh.Scene()
    room_records: list[dict[str, Any]] = []
    polygon_by_room = {polygon["room_id"]: polygon for polygon in polygons}
    for room in rooms:
        polygon_row = polygon_by_room.get(room["id"])
        if not polygon_row:
            continue
        level = level_by_id.get(room["level_id"])
        if not level:
            raise ValueError(f"Level missing for {room['name']}")
        depth = width * float(level["canvas_height"]) / float(level["canvas_width"])
        coords = [_world_point(point, width, depth) for point in polygon_row["points"]]
        shape = Polygon(coords)
        if not shape.is_valid or shape.is_empty or shape.area < 0.01:
            raise ValueError(f"Invalid or too-small polygon for {room['name']}")
        elevation = float(level["elevation"])
        height = float(room.get("height") or 2.7)
        if height <= 0:
            raise ValueError(f"Invalid height for {room['name']}")
        floor_shape = shape.difference(unary_union(stair_holes.get(room['level_id'], []))) if stair_holes.get(room['level_id']) else shape
        # Triangulate the polygon directly in glTF's Y-up coordinates. The
        # editor stores simple polygons; Shapely filters concavity triangles.
        vertices: list[list[float]] = []
        faces: list[list[int]] = []
        for triangle in (triangulate(floor_shape) if room.get('space_type') != 'stairs' else []):
            if not floor_shape.covers(triangle):
                continue
            corners = list(triangle.exterior.coords)[:3]
            offset = len(vertices)
            vertices.extend([[x, elevation, z] for x, z in corners])
            faces.append([offset, offset + 2, offset + 1])
        if faces:
            floor_mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
            floor_color = [140, 187, 175, 255] if room.get("category") == "outdoor" else [229, 222, 207, 255]
            floor_mesh.visual.vertex_colors = np.tile(floor_color, (len(floor_mesh.vertices), 1))
            scene.add_geometry(floor_mesh, node_name=f"room_{room['id']}", geom_name=f"room_{room['id']}")
        center = shape.representative_point()  # Always inside concave rooms.
        photos = sorted(media_by_room.get(room["id"], []), key=lambda item: item.get("sort_order", 0))
        room_records.append({
            "id": room["id"], "name": room["name"], "level_id": room["level_id"],
            "space_type": room.get("space_type", "other"), "category": room.get("category", "indoor"),
            "center": [center.x, elevation, center.y],
            "camera_anchor": [center.x, elevation + min(1.6, height * 0.75), center.y],
            "polygon": [[x, z] for x, z in coords],
            "photo_ids": [photo["id"] for photo in photos],
            "photos": [{"id": photo["id"], "alt_text": photo.get("alt_text", ""),
                        "width": photo.get("width"), "height": photo.get("height")}
                       for photo in photos],
        })
    if not room_records:
        raise ValueError("Draw at least one room area before generating a 3D model")
    graph_by_level = {row['level_id']: row['graph'] for row in layout_graphs or []}
    stair_records = [_add_stair_geometry(scene, stair, level_by_id, width, graph_by_level) for stair in stair_features]
    wall_records: list[dict] = []
    room_level = {room['id']: room['level_id'] for room in rooms}
    legacy = _legacy_walls([p for p in polygons if p.get('level_id', room_level.get(p['room_id'])) not in graph_by_level], rooms)
    for level in levels:
        level_id = level['id']
        depth = width * float(level['canvas_height']) / float(level['canvas_width'])
        elevation = float(level['elevation'])
        graph = graph_by_level.get(level_id)
        if graph and graph.get('walls'):
            vertices = {v['id']: v for v in graph['vertices']}
            room_shapes = {p['room_id']: Polygon([(v['x'], v['y']) for v in p['points']])
                           for p in polygons if p.get('level_id', room_level.get(p['room_id'])) == level_id}
            for wall in graph['walls']:
                if wall['kind'] == 'virtual':
                    continue
                start = _world_point(vertices[wall['a']], width, depth)
                end = _world_point(vertices[wall['b']], width, depth)
                attached = [o for o in graph.get('openings', []) if o['wall_id'] == wall['id']]
                a, b = vertices[wall['a']], vertices[wall['b']]
                dx, dy = float(b['x']) - float(a['x']), float(b['y']) - float(a['y'])
                scale = math.hypot(dx, dy)
                mid = ((float(a['x']) + float(b['x'])) / 2, (float(a['y']) + float(b['y'])) / 2)
                left = Point(mid[0] - dy / scale * .0001, mid[1] + dx / scale * .0001)
                right = Point(mid[0] + dy / scale * .0001, mid[1] - dx / scale * .0001)
                left_room = next((rid for rid, shape in room_shapes.items() if shape.contains(left)), None)
                right_room = next((rid for rid, shape in room_shapes.items() if shape.contains(right)), None)
                name = f"wall_{wall['id']}"
                cap_start = _end_cap(wall['a'], wall['b'], wall, graph['walls'], vertices, width, depth)
                cap_end_outward = _end_cap(wall['b'], wall['a'], wall, graph['walls'], vertices, width, depth)
                caps = (cap_start, (cap_end_outward[1], cap_end_outward[0]))
                _add_wall(scene, start, end, elevation, float(wall['height']), float(wall['thickness']), name, attached, caps)
                wall_records.append({'id': wall['id'], 'level_id': level_id, 'kind': wall['kind'],
                                     'start': list(start), 'end': list(end), 'left_space_id': left_room,
                                     'right_space_id': right_room,
                                     'openings': [{'id': o['id'], 'type': o['type'], 'start': o['start'],
                                                   'end': o['end'], 'swing': o.get('swing')} for o in attached]})
        else:
            for index, (start, end) in enumerate(legacy.get(level_id, [])):
                a = _world_point({'x': start[0], 'y': start[1]}, width, depth)
                b = _world_point({'x': end[0], 'y': end[1]}, width, depth)
                _add_wall(scene, a, b, elevation, 2.7, .10, f"wall_legacy_{level_id}_{index}")
    site_edges: list[dict] = []
    for room in rooms:
        if room.get('category') != 'outdoor' or room['level_id'] not in graph_by_level:
            continue  # Leave legacy outdoor geometry unchanged.
        polygon = polygon_by_room.get(room['id'])
        if not polygon:
            continue
        level = level_by_id[room['level_id']]
        depth = width * float(level['canvas_height']) / float(level['canvas_width'])
        graph = graph_by_level[room['level_id']]
        defaults = {'balcony': 'railing', 'terrace': 'railing', 'porch': 'open', 'patio': 'open'}
        for index, point in enumerate(polygon['points']):
            override = next((edge for edge in graph.get('site_edges', []) if edge['room_id'] == room['id'] and edge['segment_index'] == index), None)
            behavior = override['behavior'] if override else defaults.get(room.get('space_type'), 'open')
            edge_height = float(override['height']) if override else (1.05 if behavior == 'railing' else .9 if behavior == 'parapet' else 2.7 if behavior == 'wall' else 0)
            edge_thickness = float(override['thickness']) if override else (.06 if behavior == 'railing' else .12)
            if behavior != 'open' and edge_height > 0:
                start = _world_point(point, width, depth)
                end = _world_point(polygon['points'][(index + 1) % len(polygon['points'])], width, depth)
                _add_wall(scene, start, end, float(level['elevation']), edge_height, edge_thickness, f"edge_{room['id']}_{index}")
            site_edges.append({'id': f"{room['id']}_{index}", 'room_id': room['id'], 'level_id': room['level_id'],
                               'segment_index': index, 'behavior': behavior, 'height': edge_height,
                               'thickness': edge_thickness})
    manifest = {
        "schema_version": 2, "property_id": property_row["id"], "units": "metres",
        "layout_width_m": width,
        "levels": [{"id": level["id"], "name": level["name"], "elevation": float(level["elevation"])}
                   for level in levels],
        "rooms": room_records, "walls": wall_records, "site_edges": site_edges, "stairs": stair_records, "stairs_needing_review": stair_review,
    }
    glb = scene.export(file_type="glb")
    if not isinstance(glb, bytes) or len(glb) < 100:
        raise ValueError("GLB export failed")
    return glb, json.dumps(manifest, separators=(",", ":")).encode("utf-8")


def image_size(data: bytes) -> tuple[int, int]:
    from PIL import Image
    with Image.open(io.BytesIO(data)) as image:
        return image.size
