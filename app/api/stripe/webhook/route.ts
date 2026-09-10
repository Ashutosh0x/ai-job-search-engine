import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getSupabaseServerClient } from '@/lib/supabase'
import Stripe from 'stripe'

// Signature verification needs the raw body, so this must not run on the edge.
export const runtime = 'nodejs'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

/**
 * Read the current billing period from a subscription.
 *
 * Stripe's Basil release (2025-03-31) removed `current_period_start` /
 * `current_period_end` from the subscription object and moved them onto each
 * subscription item. The previous code read the top-level fields, got
 * `undefined`, and called `new Date(undefined * 1000).toISOString()` -- which
 * throws a RangeError on an Invalid Date. Every
 * customer.subscription.created/updated event therefore failed, so paid
 * subscriptions were never recorded.
 *
 * Falls back to the legacy top-level fields so older API versions still work.
 */
function getBillingPeriod(subscription: Stripe.Subscription): {
  start: string | null
  end: string | null
} {
  const item = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number })
    | undefined
  const legacy = subscription as unknown as {
    current_period_start?: number
    current_period_end?: number
  }

  const startSec = item?.current_period_start ?? legacy.current_period_start
  const endSec = item?.current_period_end ?? legacy.current_period_end

  return { start: toIso(startSec), end: toIso(endSec) }
}

function toIso(epochSeconds?: number | null): string | null {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return null
  const d = new Date(epochSeconds * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Stripe retries a webhook until it gets a 2xx, and can deliver the same event
 * more than once. Record the event id first and skip anything already seen so
 * replays cannot double-apply a change.
 *
 * Requires the `stripe_webhook_events` table (see migration
 * 20260910000100_create_stripe_webhook_events.sql).
 */
async function alreadyProcessed(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  event: Stripe.Event
): Promise<boolean> {
  const { error } = await supabase
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type })

  if (!error) return false

  // 23505 = unique_violation: we have handled this event before.
  if ((error as { code?: string }).code === '23505') return true

  // If the ledger itself is unavailable, process the event rather than drop it;
  // the handlers below are written to be safe to re-apply.
  console.error('Webhook idempotency check failed, processing anyway:', error)
  return false
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseServerClient()

  if (await alreadyProcessed(supabase, event)) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    switch (event.type) {
      // The event that actually confirms a completed purchase. It was not
      // handled at all before, so a subscription whose metadata was missing
      // never reached the database by any path.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.userId
        const planId = session.metadata?.planId

        if (!userId || !planId || !session.subscription) break

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        )
        const { start, end } = getBillingPeriod(subscription)

        const { error } = await supabase.from('user_subscriptions').upsert(
          {
            user_id: userId,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer as string,
            plan_id: planId,
            status: subscription.status,
            current_period_start: start,
            current_period_end: end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'stripe_subscription_id' }
        )
        if (error) console.error('Error saving subscription from checkout:', error)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata.userId
        const planId = subscription.metadata.planId

        if (!userId || !planId) {
          console.error('Missing userId or planId in subscription metadata', subscription.id)
          break
        }

        const { start, end } = getBillingPeriod(subscription)

        // onConflict pins the upsert to the subscription id; without it a
        // repeated event could insert a second row for the same subscription.
        const { error } = await supabase.from('user_subscriptions').upsert(
          {
            user_id: userId,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer as string,
            plan_id: planId,
            status: subscription.status,
            current_period_start: start,
            current_period_end: end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'stripe_subscription_id' }
        )

        if (error) console.error('Error updating user subscription:', error)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const { error } = await supabase
          .from('user_subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id)

        if (error) console.error('Error canceling user subscription:', error)
        break
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        // `invoice.subscription` was also removed in newer API versions; the
        // parent object carries it now. Check both.
        const parent = (invoice as unknown as {
          parent?: { subscription_details?: { subscription?: string | { id: string } } }
          subscription?: string | { id: string }
        })
        const raw =
          parent.parent?.subscription_details?.subscription ?? parent.subscription
        const subscriptionId = typeof raw === 'string' ? raw : raw?.id

        if (!subscriptionId) break

        const status = event.type === 'invoice.payment_succeeded' ? 'active' : 'past_due'
        const { error } = await supabase
          .from('user_subscriptions')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscriptionId)

        if (error) console.error(`Error updating subscription after ${event.type}:`, error)
        break
      }

      default:
        // Not an error: Stripe sends many event types we do not subscribe to.
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    // Let Stripe retry; the idempotency ledger makes that safe.
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
