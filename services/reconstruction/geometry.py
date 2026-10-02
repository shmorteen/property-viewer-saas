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
from shapely.geometry import Polygon
from shapely.ops import triangulate


def _world_point(point: dict, width: float, depth: float) -> tuple[float, float]:
    x, y = float(point["x"]), float(point["y"])
    if not math.isfinite(x) or not math.isfinite(y) or not (0 <= x <= 1 and 0 <= y <= 1):
        raise ValueError("Polygon coordinates must be finite and normalized to 0–1")
    return ((x - 0.5) * width, (0.5 - y) * depth)


def build_model(property_row: dict, levels: list[dict], rooms: list[dict],
                polygons: list[dict], media: list[dict]) -> tuple[bytes, bytes]:
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
        if room.get("category") != "outdoor":
            for index, (start, end) in enumerate(zip(coords, coords[1:] + coords[:1])):
                delta = np.array(end) - np.array(start)
                length = float(np.linalg.norm(delta))
                if length < 0.01:
                    continue
                wall = trimesh.creation.box(extents=[length, height, 0.10])
                angle = math.atan2(-delta[1], delta[0])
                wall.apply_transform(trimesh.transformations.rotation_matrix(angle, [0, 1, 0]))
                wall.apply_translation([(start[0] + end[0]) / 2, elevation + height / 2,
                                        (start[1] + end[1]) / 2])
                wall.visual.vertex_colors = np.tile([230, 235, 230, 255], (len(wall.vertices), 1))
                scene.add_geometry(wall, node_name=f"wall_{room['id']}_{index}",
                                   geom_name=f"wall_{room['id']}_{index}")
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
    manifest = {
        "schema_version": 1, "property_id": property_row["id"], "units": "metres",
        "layout_width_m": width,
        "levels": [{"id": level["id"], "name": level["name"], "elevation": float(level["elevation"])}
                   for level in levels],
        "rooms": room_records,
    }
    glb = scene.export(file_type="glb")
    if not isinstance(glb, bytes) or len(glb) < 100:
        raise ValueError("GLB export failed")
    return glb, json.dumps(manifest, separators=(",", ":")).encode("utf-8")


def image_size(data: bytes) -> tuple[int, int]:
    from PIL import Image
    with Image.open(io.BytesIO(data)) as image:
        return image.size
