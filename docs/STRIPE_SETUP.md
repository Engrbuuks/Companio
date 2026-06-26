# Companio — Stripe Memberships Setup

Recurring monthly memberships, billed automatically. Card details never touch
your site or Claude — they go straight to Stripe's secure checkout. This guide
is the exact order to switch it on.

## What you'll have when done
- Operator clicks **"Set up membership"** on a family → picks a plan → gets a
  secure Stripe link to send them.
- Family enters their card on Stripe → membership activates automatically.
- The dashboard shows **✓ Member**, **Awaiting payment**, or **Payment failed**
  and keeps itself up to date as Stripe charges them each month.

---

## Step 1 — Run the SQL
In Supabase → SQL editor, run **`sql/30_stripe_subscriptions.sql`**.
This adds the `memberships` and `membership_plans` tables and seeds the three
plans (Weekly £260, Companion £570, Concierge £1110).

## Step 2 — Create the products in Stripe
In your Stripe Dashboard → **Products**, create three products, each with a
**recurring monthly Price**:
- Weekly — £260/month
- Companion — £570/month
- Concierge — £1110/month

Copy each Price id (looks like `price_1AbC...`).

## Step 3 — Link the Price ids to your plans
In Supabase → Table editor → `membership_plans`, paste each Price id into the
`stripe_price_id` column for the matching `key` (weekly / companion / concierge).

## Step 4 — Deploy the two functions
From your project folder (with the Supabase CLI):
```
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```
(The webhook uses `--no-verify-jwt` because Stripe calls it directly; it's
secured by Stripe's signature instead.)

## Step 5 — Set the secrets
```
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxx
supabase secrets set CHECKOUT_SUCCESS_URL="https://mycompanio.co.uk/welcome"
supabase secrets set CHECKOUT_CANCEL_URL="https://mycompanio.co.uk"
```
Use your **test** keys (`sk_test_…`) first to trial it safely.

## Step 6 — Add the webhook in Stripe
Stripe Dashboard → Developers → **Webhooks** → Add endpoint.
- URL: your `stripe-webhook` function URL
  (`https://<project>.supabase.co/functions/v1/stripe-webhook`)
- Events to send:
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`
- After creating it, copy the **Signing secret** (`whsec_…`) and set it:
```
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

## Step 7 — Turn it on
In Supabase → `app_settings`, set `feature.stripe` = `on`.
Make sure `ai_functions_url` is set to your functions base URL
(`https://<project>.supabase.co/functions/v1`) — the dashboard already uses
this for other functions.

## Step 8 — Test the full loop (in test mode)
1. In the dashboard, open a family → **Set up membership** → pick a plan.
2. Copy the link, open it, pay with Stripe's test card `4242 4242 4242 4242`
   (any future date, any CVC).
3. Back in the dashboard, the family should flip to **✓ Member** within a few
   seconds (the webhook firing).
4. In Stripe, you'll see the active subscription.

Once that works in test mode, swap the secrets to your live keys and you're
taking real recurring payments.

---

## Safety notes
- The Stripe **secret key lives only in Supabase function secrets** — never in
  the website, the dashboard, or `config.js`.
- The webhook **verifies Stripe's signature** and rejects anything that isn't
  genuinely from Stripe, including replays older than 5 minutes.
- Nothing charges until `feature.stripe='on'` AND the keys are set, so this is
  safe to deploy ahead of going live.
- The family portal can read its own membership (RLS), so you can later show
  "Your membership: Companion · next payment 14 July" to families.
