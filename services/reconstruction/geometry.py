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
        if left < .02 or right > .98 or left <= cursor + .005 or right <= left or sill < 0 or sill + opening_height > height + 1e-6:
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
    indoor = {room['id']: room for room in rooms if room.get('category') != 'outdoor'}
    by_level: dict[str, list[LineString]] = {}
    for polygon in polygons:
        room = indoor.get(polygon['room_id'])
        if room:
            coordinates = [(float(p['x']), float(p['y'])) for p in polygon['points']]
            by_level.setdefault(room['level_id'], []).append(LineString(coordinates + coordinates[:1]))
    result: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = {}
    for level_id, lines in by_level.items():
        union = unary_union(lines)
        merged = list(union.geoms) if hasattr(union, 'geoms') else [union]
        result[level_id] = []
        for line in merged:
            coordinates = list(line.coords)
            result[level_id].extend((a, b) for a, b in zip(coordinates, coordinates[1:]) if a != b)
    return result


def build_model(property_row: dict, levels: list[dict], rooms: list[dict],
                polygons: list[dict], media: list[dict], layout_graphs: list[dict] | None = None) -> tuple[bytes, bytes]:
    width = float(property_row.get("layout_width_m") or 12)
    if not 2 <= width <= 100:
        raise ValueError("Building width must be between 2 and 100 metres")
    level_by_id = {level["id"]: level for level in levels}
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
        # Triangulate the polygon directly in glTF's Y-up coordinates. The
        # editor stores simple polygons; Shapely filters concavity triangles.
        vertices: list[list[float]] = []
        faces: list[list[int]] = []
        for triangle in triangulate(shape):
            if not shape.covers(triangle):
                continue
            corners = list(triangle.exterior.coords)[:3]
            offset = len(vertices)
            vertices.extend([[x, elevation, z] for x, z in corners])
            faces.append([offset, offset + 2, offset + 1])
        if not faces:
            raise ValueError(f"Could not triangulate {room['name']}")
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
        "rooms": room_records, "walls": wall_records, "site_edges": site_edges,
    }
    glb = scene.export(file_type="glb")
    if not isinstance(glb, bytes) or len(glb) < 100:
        raise ValueError("GLB export failed")
    return glb, json.dumps(manifest, separators=(",", ":")).encode("utf-8")


def image_size(data: bytes) -> tuple[int, int]:
    from PIL import Image
    with Image.open(io.BytesIO(data)) as image:
        return image.size
