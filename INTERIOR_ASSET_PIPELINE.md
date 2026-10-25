# Interior asset pipeline

The worker composes the existing structural GLB, semantic surfaces and a separate furniture layer. The runtime catalog contains 11 project-generated CC0 assets and 12 converted Sweet Home 3D BlendSwap CC0 assets. `scene.json` names canonical assets; identical GLBs are cached by the viewer. The source `.sh3f` is never served.

`UPSTREAM → LICENSE CHECK → SAFE SH3F INSPECTION → GEOMETRY VALIDATION → GLB CONVERSION → SEMANTIC CLASSIFICATION → CURATION → RUNTIME CATALOG`.

Run `scripts/assets/import_sh3f.py` with the approved local `BlendSwap-CC-0.sh3f`, then `scripts/assets/write_provenance.py`, `npm run validate:interiors`, and the Python tests. The importer checks the exact pack name, catalog license, each record's license, and individual source-folder license evidence. It rejects unsafe ZIP paths, duplicate entries, symlinks and oversized entries before extraction. Only files from selected model folders are copied to a temporary workspace. No archive content is executed.

The converter loads OBJ/MTL through trimesh, preserves mesh groups and UV/material data when present, converts centimetres to metres, moves the pivot to floor center, and exports Y-up, +Z-forward GLB. It compares original bounds with catalog dimensions, rejects large discrepancies, nonfinite geometry and meshes above the triangle gate, and verifies the exported GLB. The official Khronos validator is the final format check. Metadata records width/depth/height, placement relation, source hashes and license evidence. Imported model orientation is still a curation judgement: an OBJ file rarely declares a reliable front axis.

Only `APPROVED` records from `services/reconstruction/assets_manifest.json` enter the worker catalog. Unknown records are quarantined. The current 12 imports total 4,464,296 GLB bytes and 211,002 source triangles; only referenced models load for a tour. The fixed reference uses 12 furniture instances and its shell is 24,824 bytes. Further mesh reduction requires texture/normal and appearance review; raw SH3F files stay local.
