import Stripe from 'stripe'

/**
 * Stripe client, built lazily.
 *
 * This module used to throw at IMPORT time when STRIPE_SECRET_KEY was absent.
 * Next evaluates route modules while collecting page data during `next build`,
 * so a missing billing key made the ENTIRE application unbuildable -- the build
 * error named /api/stripe/debug/create-session rather than the missing config,
 * and every unrelated route, all of job search included, went down with it.
 *
 * Billing that is not configured should mean billing is unavailable, not that
 * nothing ships. Callers get null and answer 503 for themselves.
 */
let _stripe: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (_stripe !== undefined) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  _stripe = key ? new Stripe(key) : null
  return _stripe
}

/** Standard 503 for a route whose Stripe configuration is missing. */
export function stripeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: 'Billing is not configured',
      detail: 'STRIPE_SECRET_KEY is required for this endpoint. Job search is unaffected.',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } }
  )
}

// Stripe configuration. Empty strings rather than non-null assertions: a
// missing value should surface as an unconfigured feature at request time, not
// as a lie to the type checker that becomes `undefined` at runtime.
export const stripeConfig = {
  publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  priceIds: {
    basic: process.env.STRIPE_BASIC_PRICE_ID ?? '',
    pro: process.env.STRIPE_PRO_PRICE_ID ?? '',
    premium: process.env.STRIPE_PREMIUM_PRICE_ID ?? '',
  },
}

// Plan configuration matching your pricing component
export const plans = [
  {
    id: 'basic',
    name: 'Basic',
    price: 10,
    priceId: stripeConfig.priceIds.basic,
    features: [
      'Basic AI model access.',
      'Limited usage quota per month.',
      'Standard email support included.',
      'Basic analytics dashboard access.',
      'Entry-level integration options available.',
    ],
  },
  {
    id: 'pro',
    name: 'Pro Plus',
    price: 20,
    priceId: stripeConfig.priceIds.pro,
    features: [
      'Advanced AI model access.',
      'Generous usage quota per month.',
      'Priority email and chat support.',
      'Enhanced analytics dashboard with insights.',
      'Expanded range of integration options.',
    ],
  },
  {
    id: 'premium',
    name: 'Premium plan',
    price: 30,
    priceId: stripeConfig.priceIds.premium,
    features: [
      'Premium AI models with customization.',
      'Unlimited usage quota per month.',
      'Dedicated account manager support.',
      'Comprehensive analytics with predictive features.',
      'Advanced integration with APIs and platforms.',
    ],
  },
]

// Helper function to get plan by ID
export function getPlanById(planId: string) {
  return plans.find(plan => plan.id === planId)
}

// Helper function to get plan by price ID
export function getPlanByPriceId(priceId: string) {
  return plans.find(plan => plan.priceId === priceId)
}
