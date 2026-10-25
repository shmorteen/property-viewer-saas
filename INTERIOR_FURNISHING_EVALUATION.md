# Furnishing evaluation

The fixed four-room reference has living, bedroom, dining and office rooms. Its 12 instances are selected from 23 production catalog assets (12 imported CC0 assets and 11 project originals). The scene keeps furniture separate from its 24,824-byte structural GLB. The living-room reference uses a compact source sofa, project coffee table and media stand, and source armchair. Dining chairs use a group offset based on the selected table and chair depths.

Automated checks cover deterministic placement, complete footprint containment, opening exclusions, nonoverlap, finite transforms, physical asset bounds, source licensing, safe archive extraction, and fixed top-down visual baselines. `npm run validate:interiors` reports zero glTF errors and warnings for all production furniture GLBs and the reference shell. Visual baselines are geometric projections; they complement browser PBR inspection.

A local in-app browser inspection of `/interior-reference?view=living_room` showed the furniture in scale and reported **43 FPS, 55 draw calls and 97,139 rendered triangles** in one desktop sample. This is a single environment reading, not a device-wide performance guarantee. Mobile FPS, scene-load time, authenticated published-tour behavior and iframe rendering remain to be measured. The 3D chunk is lazy-loaded, so Photos and Floor Plan modes do not request furniture assets.

The first source import has visible limitations: source model front direction is inferred, individual models have mixed visual detail, and the imported dining chair is relatively expensive. The source desk without individual license evidence remains rejected; a dimension-mismatched wardrobe remains under review. No unverified model is exposed to the viewer.
