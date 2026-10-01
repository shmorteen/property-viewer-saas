# Next phase ideas

These are planned directions, not part of V1.

1. **Automatic floor-plan room detection:** add an opt-in processing job that proposes polygon boundaries and room names. Agents review and edit proposals in the existing normalized polygon editor before publishing.
2. **Python/FastAPI processing worker:** add a queued worker with scoped service credentials, idempotent jobs, status tracking, and separate derived-asset storage. The app should request work through an authenticated Edge Function; worker output should map back to existing properties, rooms, and floor plans.
3. **AI 3D reconstruction:** process vetted floor plans and room imagery into geometry and textures, with explicit quality checks and an agent approval step.
4. **React Three Fiber viewer:** add a 3D presentation mode to the public tour payload. Keep the V1 2D floor-plan and gallery viewer available as a fallback.
5. **Automatic walkthrough generation:** generate a suggested room sequence, camera path, and exportable walkthrough from approved spatial data.
6. **Analytics:** extend minimal view counts with privacy-conscious events, referrers, conversions, and per-tour reporting; define retention and consent requirements first.
7. **White-label and custom domains:** add domain verification, tenant-aware routing, branding controls, and domain-specific embed policies.
8. **API and SDK integration:** provide scoped API keys, rate limits, webhooks, and a small JavaScript embed SDK for agencies with larger listing workflows.
