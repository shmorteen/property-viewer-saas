# Next phase: photographic reconstruction

Milestones 4–7 now provide an open-top GLB derived from the editor's room
polygons, plus a room-aware 3D mode in the existing public tour. The GLB is
spatially useful, but its walls and floors are simple geometry. Room photos
remain linked media, not textures.

Future work can explore AI reconstruction once the current geometry pipeline
has production usage data:

1. Collect room photo coverage and camera metadata, with clear consent and
   retention rules. Evaluate reconstruction quality against properties that
   have measured plans.
2. Estimate camera poses and photo-to-wall correspondence. Keep the editor's
   room IDs and polygon layout as the spatial source of truth.
3. Prototype photogrammetry, Gaussian splats, or NeRF in an isolated offline
   pipeline. Compare visual quality, cost, processing time, bandwidth, and
   mobile performance against the current lightweight GLB.
4. Add an explicit review step before any generated textures or geometry
   replace a published model. Keep floor-plan and photo modes as fallbacks.

Furniture inference, generative interiors, structural accuracy, and CAD/BIM
are separate product decisions and are outside the current implementation.
