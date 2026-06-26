// ============================================================================
// COMPANIO — stripe-checkout Edge Function
// Staff-only. Creates a Stripe Checkout Session for a monthly MEMBERSHIP
// (recurring subscription) for a given family (requester), and returns a URL
// the operator can send them. The Stripe SECRET key never leaves the server.
//
// Deploy:  supabase functions deploy stripe-checkout
// Secrets: supabase secrets set \
//            STRIPE_SECRET_KEY=sk_live_xxx \
//            CHECKOUT_SUCCESS_URL="https://mycompanio.co.uk/welcome" \
//            CHECKOUT_CANCEL_URL="https://mycompanio.co.uk"
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Call (from the operator dashboard, with the staff JWT):
//   POST { requester_id, plan_key }           // uses the plan's stripe_price_id
//   POST { requester_id, price_id }            // or pass a Price id directly (custom)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUCCESS_URL = Deno.env.get("CHECKOUT_SUCCESS_URL") ?? "https://mycompanio.co.uk/welcome";
const CANCEL_URL  = Deno.env.get("CHECKOUT_CANCEL_URL")  ?? "https://mycompanio.co.uk";

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Stripe's API is form-encoded. Small helper to flatten nested params.
function form(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") parts.push(form(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

async function stripe(path: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message ?? `Stripe ${path} failed`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors() });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: "Server not configured" }), { status: 503, headers: cors() });
  if (!STRIPE_SECRET) return new Response(JSON.stringify({ error: "Stripe is not set up yet (no secret key)" }), { status: 503, headers: cors() });

  // 1. Verify caller is logged-in, active staff
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!jwt) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: cors() });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: cors() });
  const { data: staffRow } = await admin.from("staff").select("id").eq("auth_user_id", caller.user.id).eq("active", true).maybeSingle();
  if (!staffRow) return new Response(JSON.stringify({ error: "Only Companio staff can set up memberships" }), { status: 403, headers: cors() });

  // 2. Parse request
  let body: { requester_id?: string; plan_key?: string; price_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400, headers: cors() }); }
  if (!body.requester_id) return new Response(JSON.stringify({ error: "requester_id required" }), { status: 400, headers: cors() });

  // 3. Load the family
  const { data: r } = await admin.from("requesters").select("id, full_name, email, stripe_customer_id").eq("id", body.requester_id).maybeSingle();
  if (!r) return new Response(JSON.stringify({ error: "Family not found" }), { status: 404, headers: cors() });

  // 4. Resolve the Stripe Price to charge
  let priceId = body.price_id ?? "";
  let planKey = body.plan_key ?? "custom";
  if (!priceId && body.plan_key) {
    const { data: plan } = await admin.from("membership_plans").select("stripe_price_id, key").eq("key", body.plan_key).maybeSingle();
    if (!plan?.stripe_price_id) return new Response(JSON.stringify({ error: `Plan "${body.plan_key}" has no Stripe price set. Add its stripe_price_id first.` }), { status: 422, headers: cors() });
    priceId = plan.stripe_price_id;
    planKey = plan.key;
  }
  if (!priceId) return new Response(JSON.stringify({ error: "plan_key or price_id required" }), { status: 400, headers: cors() });

  try {
    // 5. Ensure a Stripe customer exists for this family
    let customerId = r.stripe_customer_id;
    if (!customerId) {
      const cust = await stripe("customers", {
        name: r.full_name ?? undefined,
        email: r.email ?? undefined,
        metadata: { requester_id: r.id },
      });
      customerId = cust.id;
      await admin.from("requesters").update({ stripe_customer_id: customerId }).eq("id", r.id);
    }

    // 6. Create the Checkout Session (subscription mode)
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      "subscription_data[metadata][requester_id]": r.id,
      "subscription_data[metadata][plan_key]": planKey,
      "metadata[requester_id]": r.id,
      "metadata[plan_key]": planKey,
      allow_promotion_codes: true,
    });

    // 7. Record a pending membership row (webhook will flip it to active)
    await admin.from("memberships").upsert({
      requester_id: r.id,
      plan_key: planKey,
      status: "incomplete",
      stripe_customer_id: customerId,
    }, { onConflict: "stripe_subscription_id", ignoreDuplicates: false }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, url: session.url }), { status: 200, headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 400, headers: cors() });
  }
});
