import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  try {
    const { price_id } = await request.json()
    if (!price_id) {
      return NextResponse.json({ error: 'price_id is required' }, { status: 400 })
    }

    if (!String(price_id).startsWith('price_')) {
      return NextResponse.json(
        { error: 'price_id must start with "price_" (Price ID, not Product ID)' },
        { status: 400 }
      )
    }

    const origin = request.headers.get('origin') || 'http://localhost:3000'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: `${origin}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?canceled=true`,
    })

    return NextResponse.json({ ok: true, url: session.url, id: session.id })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unexpected error' },
      { status: 500 }
    )
  }
}
