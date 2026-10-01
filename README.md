# Property Viewer

An interactive property tour SaaS for estate agencies. Teams create properties, add rooms and photos, draw clickable areas over a floor plan, preview the tour, and publish a link or iframe embed. The application uses React, Vite, TypeScript, Tailwind CSS, shadcn style UI primitives, Supabase, Konva, and Stripe.

## Prerequisites

- Node.js 20.19+ or 22.12+ and npm
- A Supabase project (or the Supabase CLI and Docker for a local project)
- A Stripe account in test mode for billing verification

## Local setup

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_APP_URL=http://localhost:5173`. Use the project's publishable/anon key; never put the service role key or Stripe secret in a `VITE_` variable.
3. Apply `supabase/migrations/20261001000000_initial.sql` with the Supabase SQL editor, or install the Supabase CLI and run `supabase link --project-ref YOUR_PROJECT_REF` followed by `supabase db push`.
4. Optionally run `supabase/seed.sql` in the SQL editor. It creates a public sample at `/tour/the-willow-residence`, with demo SVG assets bundled in `public/demo/`. The demo organization has no dashboard members.
5. In Supabase Authentication → URL Configuration, set Site URL to `http://localhost:5173` and add `http://localhost:5173/**` as a redirect URL. Enable Email provider. For local tests, either confirm email from the inbox or disable email confirmation in the test project.
6. Set function secrets with `supabase secrets set APP_URL=http://localhost:5173 STRIPE_SECRET_KEY=sk_test_... STRIPE_PRO_PRICE_ID=price_... STRIPE_WEBHOOK_SECRET=whsec_...`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions. Do not commit secrets.
7. Deploy the functions with `supabase functions deploy public-tour`, `supabase functions deploy create-checkout`, `supabase functions deploy customer-portal`, and `supabase functions deploy stripe-webhook`. The included `supabase/config.toml` disables gateway JWT checks; the two billing functions validate the bearer token and owner membership themselves. `public-tour` only serves published tours, and `stripe-webhook` verifies Stripe signatures.
8. Run `npm run dev` and open `http://localhost:5173`.

For a fully local Supabase stack, run `supabase start`, `supabase db reset` (which applies the migration and seed), and `supabase functions serve --env-file supabase/.env.local`. Use the local API URL and anon key printed by `supabase status` in `.env.local`. Copy the Edge Function secrets into `supabase/.env.local`; this file is ignored by Git. Use `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook` for local Stripe webhooks and set the printed signing secret. The local function `APP_URL` should be `http://localhost:5173`.

## Stripe setup

Create one recurring Professional price in Stripe test mode. Put its `price_...` ID in `STRIPE_PRO_PRICE_ID`. Enable the customer portal in Stripe. Create a webhook endpoint at `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`, subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`, and set its signing secret as `STRIPE_WEBHOOK_SECRET`.

Checkout and portal sessions are created only by Edge Functions after verifying the signed-in user is an organization owner. Subscription records can only be changed by the service role through the signed webhook. The database enforces one published tour on Free and unlimited tours on Professional. If Professional ends while several tours are live, the webhook keeps the oldest published tour and unpublishes the rest. Stripe is the source of truth for subscription status. Run a test checkout using a Stripe test card, return to Billing, and confirm the plan changes after the webhook arrives. Then open Manage Subscription and test cancellation through the portal.

## Product workflow

Sign up, create an organization, create a property, and open its Floor Plan Editor. Add rooms and upload a JPG, PNG, or WebP floor plan. Select a room, click **Draw room area**, click at least three corners, and click **Finish polygon**. Select a saved area to drag its white vertices or delete it. Upload multiple photos to each room. Preview the tour, then publish it when every room has at least one photo and polygon. The Publish screen provides the public URL and iframe code. Unpublishing removes access through the public function immediately; signed image URLs already issued may remain valid for up to one hour.

Uploads are limited to 15 MB and accepted image MIME types in both the client and private Supabase buckets. Paths begin with the organization UUID. Storage policies restrict access to organization members. The public viewer gets only a published property's necessary data and short-lived signed media URLs from `public-tour`; it has no direct anonymous table or bucket access. `tour_views` stores a minimal view count without visitor identifiers.

## Checks

Run `npm run typecheck`, `npm run lint`, and `npm run build`. Then verify in a configured Supabase project:

1. Sign up, confirm email, sign in, and create an organization.
2. Create/edit a property; upload a floor plan; add a room and multiple photos.
3. Draw, select, reshape, and delete a polygon; refresh and confirm normalized geometry persists at different viewport widths.
4. Navigate rooms and photos in private preview and the published `/tour/:slug` route.
5. Paste the iframe snippet into a page on a different origin and verify room switching; unpublish and confirm the route stops loading.
6. With a second account and organization, attempt direct reads/updates and storage access to the first organization's IDs. They must be denied by RLS/storage policies. Anonymous table reads must be denied.
7. In Stripe test mode, complete checkout, receive webhook, open the customer portal, and cancel. Confirm `subscriptions` updates and Free publishing limits apply.

## Deployment

Build with `npm run build` and deploy `dist/` to any static host with a catch-all rewrite to `/index.html` for client routes. Set production `VITE_APP_URL` to the public app origin and the same origin as Edge Function `APP_URL`. Add the production origin to Supabase Auth URL Configuration. Serve the frontend over HTTPS. Allow external sites to frame `/tour/*` in your host's `Content-Security-Policy: frame-ancestors` and do not set `X-Frame-Options: DENY` on that route. Keep private dashboard routes out of embeds through host policy if desired. Deploy the migration, functions, and Stripe webhook before enabling billing. Storage objects are private; back up the database and Storage according to your Supabase plan.

## Structure

- `src/pages/`: dashboard, property management, editor, tour, publishing, billing, and settings
- `src/components/`: shared UI and Konva floor plan canvas
- `src/lib/`: typed domain models, Supabase queries, upload validation
- `supabase/migrations/`: relational schema, indexes, triggers, RLS, and storage policies
- `supabase/functions/`: public tour and Stripe server-side operations
- `supabase/seed.sql` and `public/demo/`: sample public tour

The tour response is a presentation payload assembled at the backend edge. A future processing worker can write room geometry and assets into the same domain tables, and a 3D viewer can consume an additional representation alongside the V1 floor plan without changing property or organization ownership.
