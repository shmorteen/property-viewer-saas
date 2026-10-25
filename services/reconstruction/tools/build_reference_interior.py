"""Generate a deterministic four-room reference shell and interior scene."""

import json
import uuid
from pathlib import Path

from geometry import build_model

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "public" / "interiors" / "reference"

def uid(label):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"property-viewer/interior-reference/{label}"))

def main():
    xs, ys = [.0625, .5, .9375], [.05, .5, .95]
    vertex = lambda ix, iy: uid(f"vertex-{ix}-{iy}")
    vertices = [{"id": vertex(ix, iy), "x": x, "y": y}
                for iy, y in enumerate(ys) for ix, x in enumerate(xs)]
    walls = []
    openings = []
    for iy in range(3):
        for ix in range(2):
            label = f"h-{ix}-{iy}"
            walls.append({"id": uid(label), "a": vertex(ix, iy), "b": vertex(ix+1, iy),
                          "kind": "exterior" if iy in (0, 2) else "partition", "height": 2.7, "thickness": .12})
            if iy == 1:
                openings.append({"id": uid(f"opening-{label}"), "wall_id": uid(label), "type": "door",
                                 "start": .46, "end": .59, "height": 2.1, "sill": 0})
            if iy == 2 and ix == 0:
                openings.append({"id": uid("entrance"), "wall_id": uid(label), "type": "entrance",
                                 "start": .12, "end": .26, "height": 2.1, "sill": 0})
    for ix in range(3):
        for iy in range(2):
            label = f"v-{ix}-{iy}"
            walls.append({"id": uid(label), "a": vertex(ix, iy), "b": vertex(ix, iy+1),
                          "kind": "exterior" if ix in (0, 2) else "partition", "height": 2.7, "thickness": .12})
            if ix == 1:
                openings.append({"id": uid(f"opening-{label}"), "wall_id": uid(label), "type": "door",
                                 "start": .42, "end": .58, "height": 2.1, "sill": 0})
            if ix == 2:
                openings.append({"id": uid(f"window-{label}"), "wall_id": uid(label), "type": "window",
                                 "start": .26, "end": .7, "height": 1.2, "sill": .9})
    specs = [(0, 0, "living_room", "Living Room"), (1, 0, "bedroom", "Bedroom"),
             (0, 1, "dining_room", "Dining Room"), (1, 1, "office", "Office")]
    rooms = []
    polygons = []
    for ix, iy, kind, name in specs:
        rid = uid(kind)
        rooms.append({"id": rid, "level_id": "ground", "name": name, "space_type": kind,
                      "category": "indoor", "height": 2.7})
        polygons.append({"room_id": rid, "level_id": "ground", "points": [
            {"x": xs[ix], "y": ys[iy]}, {"x": xs[ix+1], "y": ys[iy]},
            {"x": xs[ix+1], "y": ys[iy+1]}, {"x": xs[ix], "y": ys[iy+1]}]})
    graph = {"vertices": vertices, "walls": walls, "openings": openings, "stairs": []}
    glb, scene_bytes = build_model({"id": uid("property"), "layout_width_m": 16},
                                   [{"id": "ground", "name": "Ground", "elevation": 0,
                                     "canvas_width": 1600, "canvas_height": 1200}], rooms, polygons, [],
                                   [{"level_id": "ground", "graph": graph}])
    scene = json.loads(scene_bytes)
    scene["surface_assignments"].append({"target_type": "wall", "wall_id": uid("h-0-0"),
                                          "surface": "wall", "material_id": "wood_panel"})
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "model.glb").write_bytes(glb)
    (OUTPUT / "scene.json").write_text(json.dumps(scene, indent=2), encoding="utf-8")
    print("reference", len(glb), "GLB bytes", len(scene["furniture_instances"]), "furniture instances")
    for item in scene["furnishing_diagnostics"]:
        print(item["asset_id"], item["reason"])


if __name__ == "__main__":
    main()
