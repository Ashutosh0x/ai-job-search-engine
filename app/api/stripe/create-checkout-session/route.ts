import { NextRequest, NextResponse } from 'next/server'
import { stripe, getPlanById } from '@/lib/stripe'
import { getSupabaseServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    console.log('=== Stripe Checkout Session Request ===')
    const { planId, userId } = await request.json()
    console.log('Received planId:', planId, 'userId:', userId)

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan ID is required' },
        { status: 400 }
      )
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const plan = getPlanById(planId)
    console.log('Found plan:', plan)
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

    // Create Supabase client
    const supabase = getSupabaseServerClient()

    // Get user details from Supabase auth
    const { data: authUser, error: userError } = await supabase.auth.admin.getUserById(userId)

    if (userError || !authUser.user) {
      console.error('User lookup error:', userError)
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    const user = authUser.user
    console.log('Found user:', user.email)

    // Determine origin dynamically to avoid wrong port issues in dev
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

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