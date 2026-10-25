"""License and archive-safety tests for the SH3F source adapter."""
import importlib.util
import json
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("import_sh3f", ROOT / "scripts/assets/import_sh3f.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

PROPERTIES = b"""license=Public domain
model#4=/blendswap-cc-0/bedsideTable2/bedsideTable2.obj
name#4=Bedside table
category#4=Bedroom
width#4=50
depth#4=50
height#4=50
creator#4=Fixture Author
license#4=CC-0
"""
OBJ = b"""v 0 0 0
v 50 0 0
v 50 50 0
v 0 50 0
v 0 0 50
v 50 0 50
v 50 50 50
v 0 50 50
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
"""


def make_pack(path, *, catalog=PROPERTIES, unsafe=False, evidence=True):
    with zipfile.ZipFile(path, "w") as out:
        out.writestr("PluginFurnitureCatalog.properties", catalog)
        out.writestr("blendswap-cc-0/bedsideTable2/bedsideTable2.obj", OBJ)
        if evidence:
            out.writestr("blendswap-cc-0/bedsideTable2/BLENDSWAP_LICENSE.txt",
                         "Released under Creative Commons Zero (Public Domain)")
        if unsafe:
            out.writestr("../escape.txt", "unsafe")


def test_cc0_sh3f_is_extracted_converted_and_traced(tmp_path):
    source = tmp_path / "BlendSwap-CC-0.sh3f"
    make_pack(source)
    assets = adapter.run(source, tmp_path / "models", tmp_path / "manifest.json")
    assert len(assets) == 1 and assets[0]["status"] == "APPROVED"
    assert assets[0]["width_m"] == assets[0]["depth_m"] == assets[0]["height_m"] == .5
    assert assets[0]["license_evidence_sha256"] and assets[0]["source_model_sha256"]
    glb = tmp_path / "models" / f"{assets[0]['id']}.glb"
    assert glb.read_bytes()[:4] == b"glTF"
    assert json.loads((tmp_path / "manifest.json").read_text())["catalog_records"] == 1


def test_non_cc0_pack_is_rejected_before_extraction(tmp_path):
    source = tmp_path / "BlendSwap-CC-BY.sh3f"
    make_pack(source)
    with pytest.raises(adapter.ImportRejected, match="REJECTED_LICENSE"):
        adapter.run(source, tmp_path / "models", tmp_path / "manifest.json")
    assert not (tmp_path / "models").exists()


def test_traversal_and_missing_individual_license_are_rejected(tmp_path):
    source = tmp_path / "BlendSwap-CC-0.sh3f"
    make_pack(source, unsafe=True)
    with pytest.raises(adapter.ImportRejected, match="UNSAFE_ARCHIVE_PATH"):
        adapter.run(source, tmp_path / "models", tmp_path / "manifest.json")
    make_pack(source, evidence=False)
    assets = adapter.run(source, tmp_path / "models", tmp_path / "manifest.json")
    assert assets[0]["status"] == "REJECTED"
    assert "REJECTED_LICENSE" in assets[0]["diagnostics"][0]


def test_checked_in_assets_have_cc0_provenance_and_valid_bounds():
    manifest = json.loads((ROOT / "services/reconstruction/assets_manifest.json").read_text())
    approved = [item for item in manifest["assets"] if item["status"] == "APPROVED"]
    assert len(approved) == 12
    assert manifest["catalog_records"] == 175
    for item in approved:
        assert item["license"] == "CC0-1.0"
        assert item["license_evidence_sha256"] and item["runtime_sha256"]
        assert all(.1 <= value <= 4 for value in item["measured_dimensions_m"])
        assert (ROOT / "public" / item["glb_path"].lstrip("/")).exists()
