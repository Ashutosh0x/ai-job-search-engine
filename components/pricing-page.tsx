"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, Loader2 } from "lucide-react"
import Navigation from "@/components/navigation"
import { loadStripe } from '@stripe/stripe-js'
import { getSupabaseClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

// Initialize Stripe
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function PricingPage() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const router = useRouter()

  const plans = [
    {
      id: "basic",
      name: "Basic",
      price: "$10",
      period: "/mo",
      billing: "Billed annually",
      popular: false,
      features: [
        "Basic AI model access.",
        "Limited usage quota per month.",
        "Standard email support included.",
        "Basic analytics dashboard access.",
        "Entry-level integration options available.",
      ],
    },
    {
      id: "pro",
      name: "Pro Plus",
      price: "$20",
      period: "/mo",
      billing: "Billed annually",
      popular: true,
      features: [
        "Advanced AI model access.",
        "Generous usage quota per month.",
        "Priority email and chat support.",
        "Enhanced analytics dashboard with insights.",
        "Expanded range of integration options.",
      ],
    },
    {
      id: "premium",
      name: "Premium plan",
      price: "$30",
      period: "/mo",
      billing: "Billed annually",
      popular: false,
      features: [
        "Premium AI models with customization.",
        "Unlimited usage quota per month.",
        "Dedicated account manager support.",
        "Comprehensive analytics with predictive features.",
        "Advanced integration with APIs and platforms.",
      ],
    },
  ]

  const handleSubscribe = async (planId: string) => {
    try {
      setLoadingPlan(planId)

      // Check if user is authenticated
      const supabase = getSupabaseClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        // Redirect to login if not authenticated
        router.push('/login?redirect=/pricing')
        return
      }

      // Create checkout session
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId,
          userId: user.id,
        }),
      })

      const { sessionId, url, error } = await response.json()

      if (error) {
        console.error('Error creating checkout session:', error)
        return
      }

      // Redirect to Stripe Checkout
      if (url) {
        window.location.href = url
      }
    } catch (error) {
      console.error('Error initiating subscription:', error)
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-20">
          {/* Breadcrumb */}
          <div className="flex items-center justify-center mb-8">
            <Badge
              variant="secondary"
              className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-3 py-1"
            >
              Pricing
            </Badge>
          </div>

          {/* Header */}
          <div className="text-center space-y-4 mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white">
              Simple, fair pricing for your team
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Choose the better option for you.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {plans.map((plan, index) => (
              <div key={plan.name} className="relative group">
                {/* Hover-based plan tags - positioned outside the card */}
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50 pointer-events-none">
                  <Badge className="bg-purple-600 text-white px-4 py-1 rounded-full shadow-lg border-2 border-white">
                    {plan.popular ? "Most popular" : plan.name}
                  </Badge>
                </div>
                
                <Card
                  className={`card-glow p-8 ${
                    plan.popular 
                      ? "ring-2 ring-purple-500 dark:ring-purple-400 scale-105 hover:ring-purple-600 dark:hover:ring-purple-300" 
                      : "hover:scale-105 hover:ring-2 hover:ring-purple-500 dark:hover:ring-purple-400"
                  } transition-all duration-300 overflow-hidden`}
                >
                  {/* Animated border overlay */}
                  <div className={`absolute inset-0 pointer-events-none z-10 ${
                    plan.popular 
                      ? "border-2 border-purple-500 dark:border-purple-400" 
                      : "border-2 border-transparent"
                  } group-hover:border-purple-500 dark:group-hover:border-purple-400 transition-all duration-300`}>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-500/20 to-transparent transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
                  </div>

                  <CardContent className="p-0 space-y-8 relative z-10">
                  {/* Pricing Header */}
                  <div className="text-center space-y-2 group-hover:scale-105 transition-transform duration-300">
                    <div className="flex items-baseline justify-center">
                      <span className="text-4xl font-bold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors duration-300">{plan.price}</span>
                      <span className="text-xl text-gray-600 dark:text-gray-400">{plan.period}</span>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors duration-300">{plan.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{plan.billing}</p>
                  </div>

                  {/* Features List */}
                  <div className="space-y-4">
                    {plan.features.map((feature, featureIndex) => (
                      <div key={featureIndex} className="flex items-start space-x-3 group-hover:translate-x-1 transition-transform duration-300">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mt-0.5 group-hover:bg-green-200 dark:group-hover:bg-green-800/50 transition-colors duration-300">
                          <Check className="w-3 h-3 text-green-600 dark:text-green-400 group-hover:scale-110 transition-transform duration-300" />
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors duration-300">{feature}</p>
                      </div>
                    ))}
                  </div>

                  {/* CTA Button */}
                  <Button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={loadingPlan === plan.id}
                    className={`w-full py-3 font-medium rounded-full transition-all duration-300 group-hover:scale-105 ${
                      plan.popular
                        ? "bg-purple-600 hover:bg-purple-700 text-white hover:shadow-lg hover:shadow-purple-500/25 group-hover:shadow-xl group-hover:shadow-purple-500/30"
                        : "bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-700 group-hover:shadow-lg group-hover:shadow-gray-500/20"
                    }`}
                  >
                    {loadingPlan === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Get started'
                    )}
                  </Button>
                </CardContent>
                </Card>
              </div>
            ))}
          </div>

          {/* Feature Comparison Table */}
          <div className="mt-20 max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Compare plans</h2>
            </div>

            <div className="card-glow rounded-xl overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-4 gap-4 p-6 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                <div></div>
                <div className="text-center space-y-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Basic</h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">$10/mo</p>
                  <Button 
                    onClick={() => handleSubscribe('basic')}
                    disabled={loadingPlan === 'basic'}
                    className="btn-secondary w-full text-sm"
                  >
                    {loadingPlan === 'basic' ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Get started'
                    )}
                  </Button>
                </div>
                <div className="text-center space-y-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Pro Plus</h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">$20/mo</p>
                  <Button 
                    onClick={() => handleSubscribe('pro')}
                    disabled={loadingPlan === 'pro'}
                    className="bg-purple-600 hover:bg-purple-700 text-white w-full text-sm rounded-full"
                  >
                    {loadingPlan === 'pro' ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Get started'
                    )}
                  </Button>
                </div>
                <div className="text-center space-y-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Premium plan</h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">$30/mo</p>
                  <Button 
                    onClick={() => handleSubscribe('premium')}
                    disabled={loadingPlan === 'premium'}
                    className="btn-secondary w-full text-sm"
                  >
                    {loadingPlan === 'premium' ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Get started'
                    )}
                  </Button>
                </div>
              </div>

              {/* Content Section */}
              <div className="p-6">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Content</h4>

                {/* Resume Analysis */}
                <div className="grid grid-cols-4 gap-4 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Resume Analysis</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="text-center text-gray-600 dark:text-gray-400">5 analyses per month</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Unlimited</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Unlimited</div>
                </div>

                {/* Job Applications */}
                <div className="grid grid-cols-4 gap-4 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Job Applications</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Up to 10 per month</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Unlimited</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Unlimited</div>
                </div>

                {/* Application History */}
                <div className="grid grid-cols-4 gap-4 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Application History</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="text-center text-gray-600 dark:text-gray-400">30 Days</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">90 Days</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Unlimited</div>
                </div>

                {/* Analytics */}
                <div className="grid grid-cols-4 gap-4 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Analytics</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Basic</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Basic</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">Advanced</div>
                </div>
              </div>

              {/* AI Features Section */}
              <div className="p-6 bg-gray-50/50 dark:bg-gray-800/25">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">AI Features</h4>

                {/* Auto-Apply */}
                <div className="grid grid-cols-4 gap-4 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Auto-Apply</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </div>
                </div>

                {/* Priority Support */}
                <div className="grid grid-cols-4 gap-4 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Priority Support</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="text-center text-gray-600 dark:text-gray-400">—</div>
                  <div className="flex justify-center">
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </div>
                </div>

                {/* Custom AI Training */}
                <div className="grid grid-cols-4 gap-4 py-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-900 dark:text-white">Custom AI Training</span>
                    <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">?</span>
                    </div>
                  </div>
                  <div className="text-center text-gray-600 dark:text-gray-400">—</div>
                  <div className="text-center text-gray-600 dark:text-gray-400">—</div>
                  <div className="flex justify-center">
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mt-24 max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Frequently asked questions</h2>
              <p className="text-gray-600 dark:text-gray-400">
                Everything you need to know about our pricing and plans.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Can I change my plan anytime?</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Yes, you can upgrade or downgrade your plan at any time. Changes will be reflected in your next
                    billing cycle.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Is there a free trial?</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    We offer a 14-day free trial for all new users. No credit card required to get started.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                    What payment methods do you accept?
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    We accept all major credit cards, PayPal, and bank transfers for annual plans.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Do you offer refunds?</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Yes, we offer a 30-day money-back guarantee for all paid plans. No questions asked.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Can I cancel my subscription?</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    You can cancel your subscription at any time from your account settings. Your access will continue
                    until the end of your billing period.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Do you offer team discounts?</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Yes, we offer special pricing for teams of 10 or more. Contact our sales team for custom pricing.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="mt-24 text-center">
            <Card className="card-glow p-12 max-w-4xl mx-auto">
              <CardContent className="p-0 space-y-6">
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Ready to get started?</h2>
                <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
                  Join thousands of job seekers who have already found their dream jobs with our AI-powered platform.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                  <Button className="btn-primary text-lg px-8 py-3">Start Free Trial</Button>
                  <Button className="btn-secondary text-lg px-8 py-3">Contact Sales</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
