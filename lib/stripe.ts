import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables')
}

// Initialize Stripe with your secret key
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Stripe configuration
export const stripeConfig = {
  publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  priceIds: {
    basic: process.env.STRIPE_BASIC_PRICE_ID!,
    pro: process.env.STRIPE_PRO_PRICE_ID!,
    premium: process.env.STRIPE_PREMIUM_PRICE_ID!,
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
