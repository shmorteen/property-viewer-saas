# Next phase: structured layout to 3D tour

The current milestone is the **Property Layout Builder**: a focused, editable model of levels, indoor and outdoor spaces, polygons, openings, stairs, and photos. The next milestone should follow this path:

```text
Property Layout Builder
        ↓
Python Geometry Processor
        ↓
3D GLB Generation
        ↓
React Three Fiber Viewer
        ↓
Existing /tour/:slug
```

1. **Python Geometry Processor:** accept the structured property payload through an authenticated, queued job. Validate polygon topology, elevations, space heights, wall openings, and stair connections. Keep jobs idempotent and store errors per property without blocking the existing 2D tour.
2. **3D GLB Generation:** produce a versioned GLB asset and manifest from validated geometry. Keep source geometry and derived files separate, with explicit quality checks and a way to regenerate after layout edits.
3. **React Three Fiber Viewer:** add an optional 3D presentation mode to the existing tour. Keep the current floor-plan and photo viewer available as a fallback.
4. **Existing `/tour/:slug`:** preserve current public links and iframe embeds. Extend the tour payload with a 3D asset reference only when a verified GLB exists.

This roadmap does not turn the editor into CAD, BIM, interior-design, or construction software. Furniture, electrical/plumbing plans, structural calculations, roof design, and arbitrary drafting remain outside scope.
