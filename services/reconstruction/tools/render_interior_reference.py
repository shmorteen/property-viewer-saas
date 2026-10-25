"""Fixed top-down reference views for layout, finish scale and placement drift.

These deterministic images complement browser PBR inspection. The reference
window is expressed in world metres, so texture repeats cannot track image px.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from interiors import ASSET_BY_ID, _footprint

ROOT = Path(__file__).resolve().parents[3]
REFERENCE = ROOT / "public" / "interiors" / "reference"
OUTPUT = Path(__file__).resolve().parents[1] / "tests" / "interiors" / "baselines"

VIEWS = {
    "whole-level": (-8, -6, 8, 6),
    "living-room": (-7.6, -.4, .6, 5.8),
    "bedroom": (-.6, -.4, 7.6, 5.8),
}
COLORS = {"sofa": "#58778d", "coffee_table": "#a47650", "tv_stand": "#53483e",
          "armchair": "#718ca2", "bed": "#ded5c4", "bedside": "#b58a65",
          "wardrobe": "#987454", "dining_table": "#b3895e", "dining_chair": "#77736d",
          "desk": "#876140", "office_chair": "#40494d"}


def render(scene: dict, view: tuple[float, float, float, float], size=(960, 720)) -> Image.Image:
    x0, z0, x1, z1 = view
    width, height = size
    scale = min(width / (x1-x0), height / (z1-z0))
    x_pad = (width - (x1-x0)*scale) / 2
    y_pad = (height - (z1-z0)*scale) / 2
    def pixel(x, z):
        return (round(x_pad + (x-x0)*scale), round(height-y_pad - (z-z0)*scale))
    image = Image.new("RGB", size, "#f2f2ed")
    assignments = {(row.get("room_id"), row["surface"]): row["material_id"]
                   for row in scene["surface_assignments"] if row.get("room_id")}
    materials = {row["id"]: row for row in scene["materials"]}
    for room in scene["rooms"]:
        points = [pixel(x, z) for x, z in room["polygon"]]
        mask = Image.new("L", size)
        ImageDraw.Draw(mask).polygon(points, fill=255)
        finish = materials[assignments[(room["id"], "floor")]]
        source = Image.open(ROOT / "public" / finish["texture"].lstrip("/")).convert("RGB")
        tile_size = (max(2, round(finish["repeat"][0]*scale)), max(2, round(finish["repeat"][1]*scale)))
        tile = source.resize(tile_size, Image.Resampling.BILINEAR)
        tiled = Image.new("RGB", size)
        # Align repeats to the same world origin in all three views.
        origin_x, origin_y = pixel(0, 0)
        for x in range((origin_x % tile_size[0])-tile_size[0], width, tile_size[0]):
            for y in range((origin_y % tile_size[1])-tile_size[1], height, tile_size[1]):
                tiled.paste(tile, (x, y))
        image.paste(tiled, (0, 0), mask)
    draw = ImageDraw.Draw(image)
    for room in scene["rooms"]:
        points = [pixel(x, z) for x, z in room["polygon"]]
        draw.line(points + points[:1], fill="#45413d", width=4, joint="curve")
    for item in scene["furniture_instances"]:
        asset = ASSET_BY_ID[item["asset_id"]]
        footprint = _footprint(asset, item["position"][0], item["position"][2], item["rotation_y"])
        points = [pixel(x, z) for x, z in list(footprint.exterior.coords)[:-1]]
        draw.polygon(points, fill=COLORS[item["asset_id"]], outline="#343434", width=2)
        draw.text(pixel(item["position"][0], item["position"][2]), item["asset_id"].replace("_", " "), fill="#ffffff", anchor="mm")
    return image


def main():
    scene = json.loads((REFERENCE / "scene.json").read_text(encoding="utf-8"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, view in VIEWS.items():
        target = OUTPUT / f"{name}.png"
        image = render(scene, view)
        if "--update" in sys.argv:
            image.save(target, optimize=True)
            print("updated", target)
        else:
            with Image.open(target) as baseline:
                baseline = baseline.convert("RGB")
                if baseline.size != image.size:
                    raise AssertionError(f"{name}: image dimensions changed")
                a = image.tobytes()
                b = baseline.tobytes()
                mean = sum(abs(x-y) for x, y in zip(a, b)) / len(a)
                print(name, "mean absolute pixel difference", round(mean, 4))
                if mean > 1.5:
                    raise AssertionError(f"{name}: reference image changed; inspect it before --update")


if __name__ == "__main__":
    main()
