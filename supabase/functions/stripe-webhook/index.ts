import Stripe from 'https://esm.sh/stripe@17.5.0?target=deno'
import { json, service } from '../_shared/common.ts'

const stripeId = (value: string | { id: string } | null): string | null => value ? typeof value === 'string' ? value : value.id : null

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const signature = req.headers.get('stripe-signature')
  if (!secret || !webhookSecret || !signature) return json({ error: 'Webhook not configured' }, 500)
  const stripe = new Stripe(secret, { apiVersion: '2024-09-30.acacia', httpClient: Stripe.createFetchHttpClient() })
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider())
  } catch {
    return json({ error: 'Invalid signature' }, 400)
  }
  const admin = service()
  const { error: claimError } = await admin.from('stripe_events').insert({ id: event.id })
  if (claimError?.code === '23505') return json({ received: true })
  if (claimError) return json({ error: 'Could not claim event' }, 500)
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const orgId = session.client_reference_id || session.metadata?.organization_id
      const customerId = stripeId(session.customer as string | { id: string } | null)
      if (orgId && customerId) {
        const { error } = await admin.from('subscriptions').update({ stripe_customer_id: customerId }).eq('organization_id', orgId)
        if (error) throw error
      }
    }
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const payload = event.data.object as Stripe.Subscription
      const sub = event.type === 'customer.subscription.deleted' ? payload : await stripe.subscriptions.retrieve(payload.id)
      const customerId = stripeId(sub.customer as string | { id: string })!
      let orgId = sub.metadata?.organization_id
      if (!orgId) {
        const { data } = await admin.from('subscriptions').select('organization_id').eq('stripe_customer_id', customerId).single()
        orgId = data?.organization_id
      }
      if (orgId) {
        const { data: existing } = await admin.from('subscriptions').select('stripe_subscription_id').eq('organization_id', orgId).single()
        if (event.type !== 'customer.subscription.deleted' || !existing?.stripe_subscription_id || existing.stripe_subscription_id === sub.id) {
          const active = ['active', 'trialing'].includes(sub.status)
          const { error } = await admin.from('subscriptions').update({
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            stripe_price_id: sub.items.data[0]?.price.id || null,
            plan: active ? 'professional' : 'free',
            status: sub.status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          }).eq('organization_id', orgId)
          if (error) throw error
          if (!active) {
            const { data: properties, error: propertiesError } = await admin.from('properties').select('id').eq('organization_id', orgId)
            if (propertiesError) throw propertiesError
            const ids = (properties || []).map(p => p.id)
            if (ids.length) {
              const { data: live, error: liveError } = await admin.from('tours').select('id,property_id').in('property_id', ids).eq('published', true).order('published_at', { ascending: true })
              if (liveError) throw liveError
              for (const tour of (live || []).slice(1)) {
                const { error: unpublishError } = await admin.from('tours').update({ published: false, published_at: null }).eq('id', tour.id)
                if (unpublishError) throw unpublishError
              }
            }
          }
        }
      }
    }
    return json({ received: true })
  } catch (error) {
    console.error(error)
    await admin.from('stripe_events').delete().eq('id', event.id)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
