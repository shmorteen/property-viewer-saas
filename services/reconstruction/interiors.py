"""Versioned, deterministic interior layer over the authoritative layout graph.

All coordinates are metres in the structural GLB's X/Z plane. The shell is
never altered by this module; unsafe furniture candidates are simply omitted.
"""

from __future__ import annotations

import math
import json
from pathlib import Path
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

LIBRARY_VERSION = 2

MATERIALS = [
    dict(id="light_oak", name="Light oak", category="floor", texture="/interiors/textures/light_oak.png", repeat=[0.18, 1.2], roughness=.72, metalness=0),
    dict(id="dark_wood", name="Dark walnut", category="floor", texture="/interiors/textures/dark_wood.png", repeat=[0.18, 1.2], roughness=.68, metalness=0),
    dict(id="neutral_tile", name="Neutral tile", category="floor", texture="/interiors/textures/neutral_tile.png", repeat=[.6, .6], roughness=.55, metalness=0),
    dict(id="marble", name="Marble", category="floor", texture="/interiors/textures/marble.png", repeat=[.8, .8], roughness=.3, metalness=0),
    dict(id="concrete", name="Concrete", category="floor", texture="/interiors/textures/concrete.png", repeat=[1, 1], roughness=.85, metalness=0),
    dict(id="neutral_paint", name="Soft white paint", category="wall", texture="/interiors/textures/neutral_paint.png", repeat=[1, 1], roughness=.9, metalness=0),
    dict(id="warm_paint", name="Warm paint", category="wall", texture="/interiors/textures/warm_paint.png", repeat=[1, 1], roughness=.9, metalness=0),
    dict(id="marble_accent", name="Marble accent", category="wall", texture="/interiors/textures/marble.png", repeat=[.8, .8], roughness=.32, metalness=0),
    dict(id="wall_tile", name="Wall tile", category="wall", texture="/interiors/textures/neutral_tile.png", repeat=[.6, .6], roughness=.52, metalness=0),
    dict(id="wood_panel", name="Wood panel", category="wall", texture="/interiors/textures/dark_wood.png", repeat=[.18, 1.2], roughness=.72, metalness=0),
]

def _asset(id: str, name: str, rooms: list[str], width: float, depth: float, height: float,
           relation: str, front: float = .5, side: float = .12) -> dict:
    return dict(id=id, name=name, category=id, glb_path=f"/interiors/models/{id}.glb",
                width_m=width, depth_m=depth, height_m=height, pivot="floor_center",
                forward_axis="+Z", placement_type="floor", compatible_room_types=rooms,
                preferred_wall_relation=relation, clearance={"front_m": front, "side_m": side},
                source="project_original", license="CC0-1.0", style_tags=["neutral_contemporary"],
                material_tags=[], colour_family="neutral", visual_weight=round(width * depth * height, 3),
                curation_priority=0)

ASSETS = [
    _asset("sofa", "Sofa", ["living_room"], 2.1, .85, .82, "back_to_wall", .85),
    _asset("coffee_table", "Coffee table", ["living_room"], 1.1, .6, .42, "in_front_of_sofa", .35, .3),
    _asset("tv_stand", "TV and stand", ["living_room"], 1.5, .42, 1.45, "facing_seating", .65),
    _asset("armchair", "Armchair", ["living_room"], .78, .8, .82, "near_sofa", .55),
    _asset("bed", "Double bed", ["bedroom"], 1.6, 2.05, .95, "headboard_to_wall", .65, .4),
    _asset("bedside", "Bedside table", ["bedroom"], .48, .42, .52, "beside_bed", .35, .2),
    _asset("wardrobe", "Wardrobe", ["bedroom"], 1.2, .55, 2.05, "back_to_wall", .7),
    _asset("dining_table", "Dining table", ["dining_room"], 1.5, .85, .75, "centered", .75, .75),
    _asset("dining_chair", "Dining chair", ["dining_room"], .46, .5, .88, "around_table", .4),
    _asset("desk", "Desk", ["office"], 1.25, .65, .75, "back_to_wall", .75),
    _asset("office_chair", "Office chair", ["office"], .58, .58, .98, "at_desk", .4),
]
_manifest_path = Path(__file__).with_name("assets_manifest.json")
if _manifest_path.exists():
    for imported in json.loads(_manifest_path.read_text(encoding="utf-8"))["assets"]:
        if imported["status"] != "APPROVED" or imported["license"] != "CC0-1.0":
            continue
        if not imported.get("runtime_sha256") or not imported.get("license_evidence_sha256"):
            continue
        ASSETS.append({key: imported[key] for key in (
            "id", "name", "category", "glb_path", "width_m", "depth_m", "height_m", "pivot",
            "forward_axis", "placement_type", "compatible_room_types", "preferred_wall_relation", "clearance"
        )} | {"source": "sweet_home_3d_blendswap_cc0", "style_tags": ["neutral_contemporary"],
             "material_tags": [], "colour_family": "neutral", "visual_weight": round(imported["width_m"] * imported["depth_m"] * imported["height_m"], 3),
             "license": imported["license"], "runtime_sha256": imported["runtime_sha256"],
             "curation_priority": imported.get("curation_priority", 0)})
ASSET_BY_ID = {item["id"]: item for item in ASSETS}

DEFAULTS = {
    "living_room": ("light_oak", "neutral_paint"),
    "bedroom": ("light_oak", "warm_paint"),
    "dining_room": ("light_oak", "neutral_paint"),
    "office": ("dark_wood", "neutral_paint"),
    "kitchen": ("neutral_tile", "neutral_paint"),
    "bathroom": ("neutral_tile", "wall_tile"),
    "garage": ("concrete", "neutral_paint"),
}

def _footprint(asset: dict, x: float, z: float, yaw: float) -> Polygon:
    shape = box(-asset["width_m"] / 2, -asset["depth_m"] / 2,
                asset["width_m"] / 2, asset["depth_m"] / 2)
    return translate(rotate(shape, -math.degrees(yaw), origin=(0, 0)), xoff=x, yoff=z)

def _front_zone(asset: dict, x: float, z: float, yaw: float) -> Polygon:
    half_depth = asset["depth_m"] / 2
    front = asset["clearance"]["front_m"]
    shape = box(-asset["width_m"] / 2, half_depth, asset["width_m"] / 2, half_depth + front)
    return translate(rotate(shape, -math.degrees(yaw), origin=(0, 0)), xoff=x, yoff=z)

def _walls(room: dict) -> list[tuple[tuple[float, float], tuple[float, float], tuple[float, float], float]]:
    shape = Polygon(room["polygon"])
    points = room["polygon"]
    result = []
    for a, b in zip(points, points[1:] + points[:1]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        if length < .1:
            continue
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        normal = (-dz / length, dx / length)
        if not shape.covers(Point(mid[0] + normal[0] * .03, mid[1] + normal[1] * .03)):
            normal = (-normal[0], -normal[1])
        result.append((a, b, normal, length))
    return sorted(result, key=lambda wall: (-round(wall[3], 6), wall[0], wall[1]))

def _exclusions(room: dict, wall_records: list[dict], stair_records: list[dict]) -> Polygon:
    zones = []
    for wall in wall_records:
        if room["id"] not in (wall.get("left_space_id"), wall.get("right_space_id")):
            continue
        a, b = wall["start"], wall["end"]
        for opening in wall.get("openings", []):
            left, right = float(opening["start"]), float(opening["end"])
            segment = LineString([(a[0] + (b[0]-a[0])*left, a[1] + (b[1]-a[1])*left),
                                  (a[0] + (b[0]-a[0])*right, a[1] + (b[1]-a[1])*right)])
            if opening["type"] in ("door", "double_door", "entrance", "standard_door"):
                zones.append(segment.buffer(.85, cap_style=2))
                if opening["type"] == "entrance":
                    # Preserve the main entrance approach. Interior doors can
                    # circulate around furniture outside the swing zone.
                    middle = segment.interpolate(.5, normalized=True)
                    zones.append(LineString([middle, Polygon(room["polygon"]).representative_point()]).buffer(.38))
            elif opening["type"] in ("window", "wide_window", "standard_window"):
                # Conservative first release: leave the window's immediate wall clear.
                zones.append(segment.buffer(.35, cap_style=2))
    for stair in stair_records:
        if stair.get("source_level_id") != room["level_id"]:
            continue
        footprint = stair.get("footprint_world")
        if footprint:
            zones.append(Polygon(footprint).buffer(.8))
    return unary_union(zones) if zones else Polygon()

def furnish_room(room: dict, walls: list[dict], stairs: list[dict], preset: str = "standard",
                 removed: list[str] | None = None) -> tuple[list[dict], list[dict]]:
    """Place a small ordered semantic set; return instances and rejection reasons."""
    kind = room.get("space_type")
    if preset != "standard" or kind not in ("living_room", "bedroom", "dining_room", "office"):
        return [], []
    shape = Polygon(room["polygon"])
    if not shape.is_valid or shape.area < 2:
        return [], [{"room_id": room["id"], "asset_id": "all", "reason": "invalid or tiny room"}]
    exclusions = _exclusions(room, walls, stairs)
    blocked = []
    instances = []
    diagnostics = []
    removed = set(removed or [])

    def attempt(role: str, candidates: list[tuple[float, float, float, str]], margin: float = .06) -> dict | None:
        if role in removed:
            diagnostics.append({"room_id": room["id"], "asset_id": role, "reason": "removed in editor"})
            return None
        # Room function asks for a role; approved assets compete by physical fit.
        # Curated priority is source-agnostic; physical fit resolves variants.
        # No candidate is resized to force a fit.
        options = [a for a in ASSETS if a["category"] == role and kind in a["compatible_room_types"]
                   and a["id"] not in removed]
        options.sort(key=lambda a: (-a.get("curation_priority", 0),
                                    abs(a["width_m"] - ASSET_BY_ID[role]["width_m"]), a["id"]))
        for asset in options:
            for x, z, yaw, reason in candidates:
                if not all(math.isfinite(v) for v in (x, z, yaw)):
                    continue
                footprint = _footprint(asset, x, z, yaw)
                front_zone = _front_zone(asset, x, z, yaw)
                if not shape.buffer(1e-6).covers(footprint.buffer(margin)) or not shape.buffer(1e-6).covers(front_zone):
                    continue
                if exclusions.intersects(footprint) or exclusions.intersects(front_zone) or any(footprint.buffer(.08).intersects(other) for other in blocked):
                    continue
                item = {"id": f"{room['id']}:{role}:{sum(i.get('role') == role for i in instances)}",
                        "asset_id": asset["id"], "role": role, "room_id": room["id"],
                        "position": [round(x, 5), room["center"][1], round(z, 5)],
                        "rotation_y": round(yaw, 6), "scale": 1}
                instances.append(item)
                blocked.append(footprint)
                diagnostics.append({"room_id": room["id"], "asset_id": asset["id"],
                                    "reason": reason, "rule_origin": "PRODUCT_HEURISTIC"})
                return item
        diagnostics.append({"room_id": room["id"], "asset_id": role, "reason": "no safe footprint and clearance",
                            "rule_origin": "GEOMETRY_INVARIANT"})
        return None

    edges = _walls(room)
    def wall_candidates(asset_id: str, offset: float = .06) -> list[tuple[float, float, float, str]]:
        asset = ASSET_BY_ID[asset_id]
        choices = []
        for a, b, normal, length in edges:
            if length < asset["width_m"] + .25:
                continue
            yaw = math.atan2(normal[0], normal[1])
            for fraction in (.5, .32, .68):
                x = a[0] + (b[0]-a[0])*fraction + normal[0]*(asset["depth_m"]/2 + offset)
                z = a[1] + (b[1]-a[1])*fraction + normal[1]*(asset["depth_m"]/2 + offset)
                choices.append((x, z, yaw, f"usable wall {tuple(round(v, 2) for v in a)} to {tuple(round(v, 2) for v in b)}"))
        return choices

    if kind == "living_room":
        sofa = attempt("sofa", wall_candidates("sofa"))
        if sofa:
            x, _, z = sofa["position"]
            yaw = sofa["rotation_y"]
            forward = (math.sin(yaw), math.cos(yaw))
            attempt("coffee_table", [(x + forward[0]*2.0, z + forward[1]*2.0, yaw, "in front of sofa with walking clearance")])
            # Prefer the wall opposite the sofa's forward direction.
            tv = sorted(wall_candidates("tv_stand"), key=lambda c: -(c[0]-x)*forward[0]-(c[1]-z)*forward[1])
            attempt("tv_stand", tv)
            if shape.area > 22:
                side = (math.cos(yaw), -math.sin(yaw))
                attempt("armchair", [(x + side[0]*2, z + side[1]*2, yaw, "beside sofa"),
                                     (x - side[0]*2, z - side[1]*2, yaw, "beside sofa")])
    elif kind == "bedroom":
        bed = attempt("bed", wall_candidates("bed"))
        if bed:
            x, _, z = bed["position"]
            yaw = bed["rotation_y"]
            side = (math.cos(yaw), -math.sin(yaw))
            attempt("bedside", [(x + side[0]*1.22, z + side[1]*1.22, yaw, "beside bed"),
                                 (x - side[0]*1.22, z - side[1]*1.22, yaw, "beside bed")])
        if shape.area > 15:
            attempt("wardrobe", wall_candidates("wardrobe"))
    elif kind == "dining_room":
        center = shape.representative_point()
        table = attempt("dining_table", [(center.x + dx, center.y + dz, 0, "usable room center")
                                           for dx, dz in ((0, 0), (0, .9), (.9, 0), (-.9, 0), (0, -.9),
                                                          (1.2, 1.2), (-1.2, 1.2))], .35)
        if table:
            x, _, z = table["position"]
            table_depth = ASSET_BY_ID[table["asset_id"]]["depth_m"]
            chair_depth = max(a["depth_m"] for a in ASSETS if a["category"] == "dining_chair")
            offset = table_depth / 2 + chair_depth / 2 + .18
            attempt("dining_chair", [(x, z-offset, 0, "at dining table with chair-use space")], .08)
            attempt("dining_chair", [(x, z+offset, math.pi, "at dining table with chair-use space")], .08)
    elif kind == "office":
        desk = attempt("desk", wall_candidates("desk"))
        if desk:
            x, _, z = desk["position"]
            yaw = desk["rotation_y"]
            attempt("office_chair", [(x + math.sin(yaw)*1.05, z + math.cos(yaw)*1.05, yaw, "at desk")])
    return instances, diagnostics


def build_interior_layer(rooms: list[dict], walls: list[dict], stairs: list[dict],
                         settings: list[dict] | None = None) -> dict:
    settings_by_room = {item["room_id"]: item for item in settings or []}
    assignments = []
    furniture = []
    diagnostics = []
    design_diagnostics = []
    for room in rooms:
        if room.get("category") != "indoor":
            continue
        setting = settings_by_room.get(room["id"], {})
        floor, wall = DEFAULTS.get(room.get("space_type"), ("neutral_tile", "neutral_paint"))
        floor = setting.get("floor_material_id") or floor
        wall = setting.get("wall_material_id") or wall
        if floor not in {m["id"] for m in MATERIALS if m["category"] == "floor"}:
            floor = "neutral_tile"
        if wall not in {m["id"] for m in MATERIALS if m["category"] == "wall"}:
            wall = "neutral_paint"
        assignments.extend([{"target_type": "room", "room_id": room["id"], "surface": "floor", "material_id": floor},
                            {"target_type": "room", "room_id": room["id"], "surface": "wall", "material_id": wall}])
        # Keep the complete deterministic layout in the scene. The viewer applies
        # furnishing overrides at runtime so hidden items can be restored without
        # rebuilding the structural model.
        placed, reasons = furnish_room(room, walls, stairs)
        furniture.extend(placed)
        diagnostics.extend(reasons)
        shape = Polygon(room["polygon"])
        occupancy = sum(_footprint(ASSET_BY_ID[item["asset_id"]], item["position"][0],
                                   item["position"][2], item["rotation_y"]).area for item in placed)
        density = occupancy / shape.area if shape.area else 0
        roles = {item["role"] for item in placed}
        required = {"living_room": "sofa", "bedroom": "bed", "dining_room": "dining_table",
                    "office": "desk"}.get(room.get("space_type"))
        primary = required is None or required in roles
        preferred = {"living_room": ["coffee_table", "tv_stand", "armchair"],
                     "bedroom": ["bedside", "wardrobe"],
                     "dining_room": ["dining_chair"],
                     "office": ["office_chair"]}.get(room.get("space_type"), [])
        fit = (0.6 if primary else 0.0) + (0.4 * sum(role in roles for role in preferred) /
                                             len(preferred) if preferred else .4)
        center = shape.centroid
        weight = sum(ASSET_BY_ID[item["asset_id"]]["visual_weight"] for item in placed)
        centroid_x = sum(item["position"][0] * ASSET_BY_ID[item["asset_id"]]["visual_weight"]
                         for item in placed) / weight if weight else center.x
        centroid_z = sum(item["position"][2] * ASSET_BY_ID[item["asset_id"]]["visual_weight"]
                         for item in placed) / weight if weight else center.y
        diagonal = math.hypot(shape.bounds[2] - shape.bounds[0], shape.bounds[3] - shape.bounds[1])
        balance = max(0.0, 1 - math.hypot(centroid_x - center.x, centroid_z - center.y) * 2 / diagonal) if diagonal else 0.0
        sofa = next((item for item in placed if item["role"] == "sofa"), None)
        tv = next((item for item in placed if item["role"] == "tv_stand"), None)
        focal = .5
        if sofa and tv:
            direction = (tv["position"][0] - sofa["position"][0],
                         tv["position"][2] - sofa["position"][2])
            distance = math.hypot(*direction)
            focal = max(0.0, (math.sin(sofa["rotation_y"]) * direction[0] +
                              math.cos(sofa["rotation_y"]) * direction[1]) / distance) if distance else 0.0
        score = {"functional_fit": round(fit, 3),
                 "circulation": 1.0 if primary else 0.0,
                 "opening_clearance": 1.0,
                 "negative_space": round(max(0.0, min(1.0, density / .08, (.35 - density) / .1)), 3),
                 "balance": round(balance, 3), "focal_alignment": round(focal, 3),
                 "concept_fit": round(sum("neutral_contemporary" in
                                          ASSET_BY_ID[item["asset_id"]].get("style_tags", [])
                                          for item in placed) / len(placed), 3)
                 if placed else 0.0,
                 "material_harmony": 1.0 if floor in ("light_oak", "dark_wood", "neutral_tile") and
                 wall in ("neutral_paint", "warm_paint", "wall_tile") else 0.7}
        design_diagnostics.append({"room_id": room["id"], "design_concept": "neutral_contemporary",
                                   "scores": score, "furniture_occupancy": round(density, 3),
                                   "rule_origins": {"opening_clearance": "GEOMETRY_INVARIANT",
                                                    "circulation": "PRODUCT_HEURISTIC",
                                                    "negative_space": "DESIGN_PRINCIPLE",
                                                    "material_harmony": "PRODUCT_HEURISTIC"},
                                   "reasons": [item["reason"] for item in reasons]})
    return {"interior_library_version": LIBRARY_VERSION, "materials": MATERIALS,
            "asset_library_version": 2, "design_concept": "neutral_contemporary",
            "surface_assignments": assignments, "furniture_assets": ASSETS,
            "furniture_instances": furniture, "furnishing_diagnostics": diagnostics,
            "design_diagnostics": design_diagnostics}
