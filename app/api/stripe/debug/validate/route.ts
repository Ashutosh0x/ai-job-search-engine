import { NextResponse } from 'next/server'
import { getStripe, stripeUnavailable, stripeConfig } from '@/lib/stripe'

/**
 * Debug helper. Never expose this in production: it reveals Stripe
 * configuration and can drive the Stripe API without authentication.
 */
function blockedInProduction() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_STRIPE_DEBUG_ROUTES !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return null
}

export async function GET() {
  // Billing not configured -> this endpoint is unavailable and says so. All
  // other routes, including job search, are unaffected.
  const stripe = getStripe()
  if (!stripe) return stripeUnavailable()

  try {
    const blocked = blockedInProduction()
    if (blocked) return blocked

    const checks: Array<{
      name: string
      id?: string
      isSet: boolean
      looksLikePrice: boolean
      retrievable: boolean
      error?: string
    }> = []

    const entries: Array<[string, string | undefined]> = [
      ['STRIPE_BASIC_PRICE_ID', stripeConfig.priceIds.basic],
      ['STRIPE_PRO_PRICE_ID', stripeConfig.priceIds.pro],
      ['STRIPE_PREMIUM_PRICE_ID', stripeConfig.priceIds.premium],
    ]

    for (const [name, id] of entries) {
      const isSet = Boolean(id)
      const looksLikePrice = Boolean(id && id.startsWith('price_'))
      let retrievable = false
      let error: string | undefined

      if (looksLikePrice && id) {
        try {
          const price = await stripe.prices.retrieve(id)
          retrievable = Boolean(price && price.id === id)
        } catch (err: any) {
          error = err?.message ?? 'Failed to retrieve price'
        }
      } else if (isSet && !looksLikePrice) {
        error = 'Value is not a Price ID (expected to start with "price_")'
      }

      checks.push({ name, id, isSet, looksLikePrice, retrievable, error })
    }

    return NextResponse.json({
      ok: true,
      stripeKeySet: Boolean(process.env.STRIPE_SECRET_KEY),
      checks,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unexpected error' },
      { status: 500 }
    )
  }
}
