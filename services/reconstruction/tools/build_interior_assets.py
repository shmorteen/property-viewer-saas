"""Build the small first-party realtime asset library; no external models.

Run from the repository root. Geometry is metre scaled, Y up, floor-centered,
with local +Z as the semantic forward direction. Source stays reproducible.
"""

from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter

from interiors import ASSETS

ROOT = Path(__file__).resolve().parents[3]
MODEL_DIR = ROOT / "public" / "interiors" / "models"
TEXTURE_DIR = ROOT / "public" / "interiors" / "textures"

WOOD = (116, 77, 50, 255)
LIGHT_WOOD = (180, 139, 91, 255)
LINEN = (198, 194, 177, 255)
CREAM = (227, 222, 207, 255)
DARK = (34, 39, 43, 255)
METAL = (106, 108, 105, 255)
BLUE = (74, 98, 119, 255)


def part(scene: trimesh.Scene, name: str, size: tuple[float, float, float],
         center: tuple[float, float, float], color: tuple[int, int, int, int]) -> None:
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(center)
    mesh.visual.vertex_colors = np.tile(color, (len(mesh.vertices), 1))
    scene.add_geometry(mesh, node_name=name, geom_name=name)


def legs(scene: trimesh.Scene, name: str, width: float, depth: float, top: float,
         height: float, color=WOOD) -> None:
    for side, x in enumerate((-.43 * width, .43 * width)):
        for end, z in enumerate((-.4 * depth, .4 * depth)):
            part(scene, f"{name}_leg_{side}_{end}", (.055, height, .055), (x, top-height/2, z), color)


def build_asset(asset: dict) -> bytes:
    key = asset["id"]
    w, d, h = (asset["width_m"], asset["depth_m"], asset["height_m"])
    s = trimesh.Scene()
    if key == "sofa":
        part(s, "sofa_base", (w, .22, d), (0, .29, 0), BLUE)
        part(s, "sofa_back", (w, .48, .16), (0, .58, -d/2+.08), BLUE)
        for i in (-1, 0, 1):
            part(s, f"sofa_seat_{i}", (w/3-.04, .13, .57), (i*w/3, .47, .07), LINEN)
            part(s, f"sofa_cushion_{i}", (w/3-.06, .3, .11), (i*w/3, .65, -d/2+.19), CREAM)
        for side, x in enumerate((-(w-.16)/2, (w-.16)/2)):
            part(s, f"sofa_arm_{side}", (.16, .4, d), (x, .48, 0), BLUE)
        legs(s, "sofa", w, d, .2, .18, DARK)
    elif key in ("coffee_table", "dining_table", "desk", "bedside"):
        color = LIGHT_WOOD if key != "desk" else WOOD
        part(s, f"{key}_top", (w, .055, d), (0, h-.0275, 0), color)
        legs(s, key, w, d, h-.055, h-.055, METAL if key == "desk" else color)
        if key == "bedside":
            part(s, "bedside_drawer", (w*.85, .23, d*.8), (0, h-.21, 0), CREAM)
            part(s, "bedside_pull", (.13, .025, .02), (0, h-.2, d*.41), METAL)
        if key == "desk":
            part(s, "desk_modesty", (w*.8, .28, .035), (0, h-.25, -d*.34), WOOD)
    elif key == "tv_stand":
        part(s, "tv_cabinet", (w, .37, d), (0, .25, 0), WOOD)
        part(s, "tv_cabinet_top", (w, .045, d), (0, .46, 0), LIGHT_WOOD)
        part(s, "tv_screen", (w*.78, .83, .04), (0, 1.02, -.06), DARK)
        part(s, "tv_screen_glass", (w*.75, .78, .006), (0, 1.02, -.035), (33, 48, 61, 255))
        part(s, "tv_stem", (.1, .13, .08), (0, .55, -.06), METAL)
        legs(s, "tv_stand", w, d, .065, .065, DARK)
    elif key in ("armchair", "dining_chair", "office_chair"):
        seat = .46 if key != "office_chair" else .51
        part(s, f"{key}_seat", (w, .11, d*.78), (0, seat, .05), BLUE if key == "armchair" else CREAM)
        part(s, f"{key}_back", (w, h-seat, .10), (0, (h+seat)/2, -d/2+.05), BLUE if key == "armchair" else DARK)
        if key == "armchair":
            for side, x in enumerate((-(w-.10)/2, (w-.10)/2)):
                part(s, f"armchair_arm_{side}", (.1, .25, d), (x, .57, 0), BLUE)
        legs(s, key, w, d, seat-.055, seat-.055, METAL)
    elif key == "bed":
        part(s, "bed_frame", (w, .22, d), (0, .2, 0), WOOD)
        part(s, "bed_mattress", (w-.12, .24, d-.15), (0, .43, .03), CREAM)
        part(s, "bed_duvet", (w-.14, .075, d*.59), (0, .59, .33), LINEN)
        part(s, "bed_headboard", (w, .55, .11), (0, .675, -d/2+.055), WOOD)
        for side, x in enumerate((-.42, .42)):
            part(s, f"bed_pillow_{side}", (.64, .10, .34), (x, .61, -d*.33), (242, 239, 225, 255))
        legs(s, "bed", w, d, .09, .09, WOOD)
    elif key == "wardrobe":
        part(s, "wardrobe_body", (w, h-.05, d-.1), (0, (h-.05)/2, 0), WOOD)
        for side, x in enumerate((-w*.25, w*.25)):
            part(s, f"wardrobe_door_{side}", (w*.48, h*.88, .025), (x, h*.51, d/2-.03), LIGHT_WOOD)
            part(s, f"wardrobe_handle_{side}", (.025, .21, .03), (x + (.07 if side == 0 else -.07), h*.53, d/2-.005), METAL)
    else:
        raise ValueError(key)
    return s.export(file_type="glb")


def build_textures() -> None:
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(31)
    size = 256
    for name, base in (("light_oak", (190, 155, 105)), ("dark_wood", (103, 70, 46))):
        noise = rng.normal(0, 5, (size, size, 1))
        grain = np.sin(np.linspace(0, 45*math.pi, size))[None, :, None] * 3
        array = np.clip(np.array(base)[None, None, :] + noise + grain, 0, 255).astype(np.uint8)
        image = Image.fromarray(array, "RGB")
        draw = ImageDraw.Draw(image)
        draw.line((0, 0, size-1, 0), fill=tuple(max(0, c-25) for c in base), width=3)
        image.save(TEXTURE_DIR / f"{name}.png", optimize=True)
    for name, base, edge in (("neutral_tile", (205, 205, 199), (154, 155, 152)),
                             ("neutral_paint", (232, 230, 221), (232, 230, 221)),
                             ("warm_paint", (222, 209, 190), (222, 209, 190)),
                             ("concrete", (165, 167, 163), (165, 167, 163))):
        noise = rng.normal(0, 2.3 if "paint" in name else 5, (size, size, 1))
        array = np.clip(np.array(base)[None, None, :] + noise, 0, 255).astype(np.uint8)
        image = Image.fromarray(array, "RGB")
        if name == "neutral_tile":
            draw = ImageDraw.Draw(image)
            draw.rectangle((0, 0, size-1, size-1), outline=edge, width=3)
        image.save(TEXTURE_DIR / f"{name}.png", optimize=True)
    array = np.full((size, size, 3), (220, 219, 211), dtype=np.uint8)
    for _ in range(22):
        origin = int(rng.integers(-50, size+50))
        for y in range(size):
            x = int(origin + 14*math.sin(y/32 + origin))
            if 0 <= x < size:
                array[y, max(0, x-1):min(size, x+2)] = (159, 160, 157)
    Image.fromarray(array, "RGB").filter(ImageFilter.GaussianBlur(.7)).save(TEXTURE_DIR / "marble.png", optimize=True)


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    build_textures()
    for asset in ASSETS:
        encoded = build_asset(asset)
        (MODEL_DIR / f"{asset['id']}.glb").write_bytes(encoded)
        loaded = trimesh.load(io.BytesIO(encoded), file_type="glb", force="scene")
        extents = loaded.bounds[1] - loaded.bounds[0]
        declared = np.array([asset["width_m"], asset["height_m"], asset["depth_m"]])
        if np.any(extents > declared + .005) or np.any(extents < declared * .65):
            raise ValueError(f"{asset['id']} bounds {extents} disagree with {declared}")
        print(f"{asset['id']}: {len(encoded)} bytes, bounds {extents.round(3)}")


if __name__ == "__main__":
    main()
