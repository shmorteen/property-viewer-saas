# Sweet Home 3D CC0 import

The approved source is **`BlendSwap-CC-0.sh3f`** from Sweet Home 3D's `3DModels-BlendSwap-CC-0-1.9.3` public-domain library. The tested copy came from the `YoannDev90/SweetHome3D-Packs` mirror because the official SourceForge endpoint returned HTML in this environment. The local source SHA-256 is `2511e9673d6cfda92dec7b7154aba86f8b5061be1b21ff2ada094c42ec305641`; the official ZIP listing reports `f87b1689df18a1b4302446dcb51922eca4d93ae9f388cf86624eb633f3068c39` for its outer ZIP. The ZIP and SH3F hashes are different artifacts.

The source archive contains 175 catalog records. Twelve models passed this first curated conversion. Desk 152 was rejected because its model folder has no individual CC0 license evidence. Wardrobe 68 remains `NEEDS_REVIEW` because its measured width differs from catalog metadata by about 24%. The other records have no automatic runtime approval. `BlendSwap-CC-BY.sh3f`, all other named non-CC0 packs and the mixed `Furniture-Pack.zip` fail the importer name gate before extraction. A regression test covers that rejection and archive path traversal.

Place the source at `.local-references/sweet-home-3d/BlendSwap-CC-0.sh3f` (gitignored). Run:

```powershell
.\services\reconstruction\.venv\Scripts\python.exe scripts/assets/import_sh3f.py .local-references\sweet-home-3d\BlendSwap-CC-0.sh3f
python scripts/assets/write_provenance.py
npm run validate:interiors
```

The manifest retains source creator, model path, source and license-evidence hashes, measured and declared dimensions, conversion status and runtime hash. Review any `NEEDS_REVIEW` or `REJECTED` result before changing the allowlist. Source licensing is documented by [Sweet Home 3D's library list](https://www.sweethome3d.com/import-models/) and the [mirror's per-pack license table](https://github.com/YoannDev90/SweetHome3D-Packs/blob/main/README.md). Neither page authorizes importing the mixed packs as CC0.
