# Furnishing rule origins

The private *Fundamentals of Interior Design* PDF was not present at `.local-references/` during this milestone. No claims or numerical standards are attributed to that book. This file records independently implemented rules; the private folder is gitignored.

| Rule | Origin | Implementation |
| --- | --- | --- |
| Entire footprint must remain inside its room; no furniture or wall overlap | GEOMETRY_INVARIANT | Shapely footprint tests |
| Door, entrance, window and stair approach exclusions | GEOMETRY_INVARIANT | Buffered opening/stair zones |
| Sofa faces into the room; TV and coffee table relate to the sofa | PRODUCT_HEURISTIC | Living-room group candidates |
| Bed/headboard, bedside table, dining table/chairs and desk/chair are placed as groups | PRODUCT_HEURISTIC | Room-specific candidate order and offsets |
| Preserve comfortable front and side use zones | PRODUCT_HEURISTIC | Asset metadata clearances, tested before placement |
| Leave intentional empty space and omit optional items when a room is tight | DESIGN_PRINCIPLE | Candidate omission and occupancy diagnostic |
| Neutral contemporary finishes and furniture form one restrained presentation | PRODUCT_HEURISTIC | Material defaults and style tags |

Scores in `design_diagnostics` are explainable project heuristics, not regulatory ratings or calibrated probabilities. The geometric checks are hard gates; the soft scores record functional coverage, clearance, room occupancy and material/concept consistency. Future design-book review may refine those soft rules without changing structural geometry.
