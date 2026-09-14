import { NextRequest, NextResponse } from 'next/server'
import { getStripe, stripeUnavailable, getPlanById } from '@/lib/stripe'
import { getSupabaseServerClient } from '@/lib/supabase'
import { requireUser } from '@/lib/api-auth'
import { guard } from '@/lib/api-guard'

export const runtime = 'nodejs'

/**
 * Only these origins may be used to build success/cancel URLs. The origin
 * header is attacker-controlled, so echoing it into a Stripe redirect turns
 * checkout into an open redirect.
 */
function resolveOrigin(requestOrigin: string | null): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const allowed = new Set(
    [configured, process.env.NEXT_PUBLIC_SITE_URL, 'http://localhost:3000']
      .filter(Boolean)
      .map((u) => {
        try { return new URL(u as string).origin } catch { return null }
      })
      .filter(Boolean) as string[]
  )
  if (requestOrigin && allowed.has(requestOrigin)) return requestOrigin
  return new URL(configured).origin
}

export async function POST(request: NextRequest) {
  // Authenticated, but authentication is not a rate limit: a signed-in
  // caller could still open checkout sessions in a loop.
  const limited = guard(request, 'stripe-checkout', { windowMs: 60_000, max: 10 })
  if (limited) return limited

  // Billing not configured -> this endpoint is unavailable and says so. All
  // other routes, including job search, are unaffected.
  const stripe = getStripe()
  if (!stripe) return stripeUnavailable()

  try {
    // userId used to be read from the request body, so anyone could open a
    // checkout session against another account (and learn its email address
    // via the admin lookup below). Identity now comes from the caller's token.
    const auth = await requireUser(request)
    if ('response' in auth) return auth.response
    const user = auth.user
    const userId = user.id

    const { planId } = await request.json()

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan ID is required' },
        { status: 400 }
      )
    }

    const plan = getPlanById(planId)
    if (!plan) {
      console.error('Plan not found for planId:', planId)
      return NextResponse.json(
        { error: 'Invalid plan ID' },
        { status: 400 }
      )
    }

    if (!plan.priceId) {
      console.error('Plan missing priceId:', plan)
      return NextResponse.json(
        { error: 'Plan configuration incomplete - missing price ID' },
        { status: 500 }
      )
    }

    // Validate that a Price ID (price_...) is configured, not a Product ID (prod_...)
    if (!plan.priceId.startsWith('price_')) {
      console.error('Configured priceId is not a Price ID. Received:', plan.priceId)
      return NextResponse.json(
        {
          error:
            'Invalid Stripe configuration: expected a Price ID (starts with "price_") but received a non-price ID. Go to Stripe Dashboard → Products → select product → Prices → copy the Price ID and set it in your .env.local (e.g., STRIPE_PRO_PRICE_ID="price_...").',
        },
        { status: 400 }
      )
    }

    // The verified token already carries the email; no admin lookup needed, and
    // no PII in the logs.
    const origin = resolveOrigin(request.headers.get('origin'))

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: user.email,
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?canceled=true`,
      metadata: {
        userId,
        planId,
      },
      subscription_data: {
        metadata: {
          userId,
          planId,
        },
      },
    })

    return NextResponse.json({ 
      sessionId: session.id,
      url: session.url 
    })
  } catch (error) {
    console.error('Error creating checkout session:', error)
    const message = (error as Error)?.message || 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}