# Stripe Integration Setup Guide

This guide will walk you through setting up Stripe payments for your JobSpark AI pricing plans.

## Prerequisites

1. **Stripe Account**: Create a free account at [stripe.com](https://stripe.com)
2. **Supabase Project**: Ensure your Supabase project is set up
3. **Environment Variables**: Have your `.env.local` file ready

## Step 1: Stripe Dashboard Setup

### 1.1 Get API Keys

1. Go to your [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers** → **API keys**
3. Copy the following keys:
   - **Publishable key** (starts with `pk_test_` for test mode)
   - **Secret key** (starts with `sk_test_` for test mode)

### 1.2 Create Products and Prices

1. Navigate to **Products** in your Stripe Dashboard
2. Click **+ Add product** and create three products:

#### Basic Plan
- **Name**: "JobSpark AI - Basic Plan"
- **Description**: "Basic AI model access with limited usage quota"
- **Pricing Model**: Recurring
- **Price**: $10.00 USD
- **Billing Period**: Monthly
- **Usage Type**: Licensed
- Copy the **Price ID** (starts with `price_`)

#### Pro Plus Plan
- **Name**: "JobSpark AI - Pro Plus Plan"
- **Description**: "Advanced AI model access with generous usage quota"
- **Pricing Model**: Recurring
- **Price**: $20.00 USD
- **Billing Period**: Monthly
- **Usage Type**: Licensed
- Copy the **Price ID** (starts with `price_`)

#### Premium Plan
- **Name**: "JobSpark AI - Premium Plan"
- **Description**: "Premium AI models with unlimited usage quota"
- **Pricing Model**: Recurring
- **Price**: $30.00 USD
- **Billing Period**: Monthly
- **Usage Type**: Licensed
- Copy the **Price ID** (starts with `price_`)

### 1.3 Set Up Webhooks

1. Navigate to **Developers** → **Webhooks**
2. Click **+ Add endpoint**
3. Set the endpoint URL to: `https://yourdomain.com/api/stripe/webhook`
   - For local development: Use ngrok or similar to expose your local server
4. Select the following events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

## Step 2: Environment Variables

Add the following variables to your `.env.local` file:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_actual_secret_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_actual_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_actual_webhook_secret

# Stripe Product IDs (replace with your actual price IDs)
STRIPE_BASIC_PRICE_ID=price_your_basic_price_id
STRIPE_PRO_PRICE_ID=price_your_pro_price_id
STRIPE_PREMIUM_PRICE_ID=price_your_premium_price_id
```

## Step 3: Database Setup

Run the database migration to create the user subscriptions table:

```bash
# If using Supabase CLI
supabase migration up

# Or run the SQL directly in your Supabase dashboard
```

The migration file is located at: `supabase/migrations/20240101000000_create_user_subscriptions.sql`

## Step 4: Testing the Integration

### 4.1 Test Mode

Stripe starts in test mode by default. Use these test card numbers:

- **Successful payment**: `4242 4242 4242 4242`
- **Declined payment**: `4000 0000 0000 0002`
- **3D Secure required**: `4000 0000 0000 3220`

For all test cards:
- Use any future expiration date (e.g., 12/25)
- Use any 3-digit CVC (e.g., 123)
- Use any ZIP code (e.g., 12345)

### 4.2 Test the Flow

1. Start your development server: `npm run dev`
2. Navigate to `/pricing`
3. Click on any "Get started" button
4. You should be redirected to login if not authenticated
5. After login, you'll be redirected to Stripe Checkout
6. Use a test card to complete the payment
7. You'll be redirected back to your app

### 4.3 Verify Webhook Processing

1. Check your Stripe Dashboard → **Developers** → **Webhooks**
2. Look for successful webhook deliveries
3. Check your Supabase database for new subscription records

## Step 5: Production Setup

### 5.1 Activate Your Stripe Account

1. Complete your Stripe account activation
2. Switch from test mode to live mode in your dashboard

### 5.2 Update Environment Variables

Replace test keys with live keys:

```env
STRIPE_SECRET_KEY=sk_live_your_live_secret_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_your_live_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_live_webhook_secret
```

### 5.3 Update Webhook URL

Update your webhook endpoint URL to point to your production domain.

## Troubleshooting

### Common Issues

1. **"Invalid API key"**
   - Check that your API keys are correctly set in environment variables
   - Ensure you're using the right keys for your environment (test vs live)

2. **"No such price"**
   - Verify your price IDs in environment variables
   - Make sure you're using price IDs, not product IDs

3. **Webhook signature verification failed**
   - Check your webhook secret in environment variables
   - Ensure your webhook endpoint is accessible from the internet

4. **User not found**
   - Make sure users are properly authenticated before attempting payment
   - Check that user IDs are being passed correctly to the API

### Testing Webhooks Locally

Use the Stripe CLI to forward webhooks to your local development server:

```bash
# Install Stripe CLI
# Then run:
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

This will give you a webhook signing secret for local testing.

## Security Best Practices

1. **Never expose secret keys** in client-side code
2. **Always verify webhook signatures** to ensure requests come from Stripe
3. **Use HTTPS** in production for all webhook endpoints
4. **Implement proper error handling** for failed payments
5. **Log important events** but avoid logging sensitive data

## Support

If you encounter issues:

1. Check the [Stripe documentation](https://stripe.com/docs)
2. Review webhook logs in your Stripe Dashboard
3. Check your application logs for errors
4. Test with Stripe's test cards first

Remember to keep your API keys secure and never commit them to version control!