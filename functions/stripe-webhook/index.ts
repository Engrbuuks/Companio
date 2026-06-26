// ============================================================================
// COMPANIO — stripe-webhook Edge Function
// Receives subscription lifecycle events from Stripe, VERIFIES the signature
// (so forged events are rejected), and syncs each family's membership status
// into the `memberships` table. This is what keeps the dashboard truthful:
// when a card is charged, fails, or a family cancels, the DB updates itself.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt because Stripe calls it directly, not a logged-in user;
//    we authenticate via the Stripe signature instead.)
// Secrets: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
// Then in Stripe Dashboard → Developers → Webhooks, add the function URL and
// subscribe to: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted,
// invoice.paid, invoice.payment_failed.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

// ---- Stripe signature verification (HMAC-SHA256 over "t.payload") ----------
async function verify(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  // header looks like: t=timestamp,v1=signature[,v1=...]
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts["t"];
  const expected = parts["v1"];
  if (!t || !expected) return false;
  // reject if older than 5 minutes (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (isNaN(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time-ish compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_KEY || !WEBHOOK_SECRET) return new Response("Not configured", { status: 503 });

  const sig = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text(); // RAW body required for signature check

  if (!(await verify(raw, sig, WEBHOOK_SECRET))) {
    return new Response("Bad signature", { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // upsert a membership row from a Stripe subscription object
  async function syncSubscription(sub: any, requesterHint?: string) {
    const requesterId = sub?.metadata?.requester_id ?? requesterHint ?? null;
    const patch: Record<string, unknown> = {
      status: sub.status,                                // active | past_due | canceled | ...
      stripe_subscription_id: sub.id,
      stripe_customer_id: sub.customer,
      plan_key: sub?.metadata?.plan_key ?? null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (requesterId) patch.requester_id = requesterId;
    // price -> monthly_price (in pounds)
    const amount = sub?.items?.data?.[0]?.price?.unit_amount;
    if (typeof amount === "number") patch.monthly_price = amount / 100;

    // match on subscription id first; else on requester
    const { data: existing } = await admin.from("memberships").select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
    if (existing) {
      await admin.from("memberships").update(patch).eq("id", existing.id);
    } else if (requesterId) {
      // flip the latest incomplete row for this requester, or insert
      const { data: pending } = await admin.from("memberships")
        .select("id").eq("requester_id", requesterId).eq("status", "incomplete")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (pending) await admin.from("memberships").update(patch).eq("id", pending.id);
      else await admin.from("memberships").insert(patch);
    } else {
      await admin.from("memberships").insert(patch);
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // fetch the subscription to get full status/period — but metadata is on the session too
        if (s.subscription && s.metadata?.requester_id) {
          await admin.from("memberships")
            .update({ status: "active", stripe_subscription_id: s.subscription, stripe_customer_id: s.customer, updated_at: new Date().toISOString() })
            .eq("requester_id", s.metadata.requester_id).eq("status", "incomplete");
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        break;
      case "invoice.paid": {
        const inv = event.data.object;
        if (inv.subscription) {
          await admin.from("memberships").update({ status: "active", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", inv.subscription);
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object;
        if (inv.subscription) {
          await admin.from("memberships").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", inv.subscription);
        }
        break;
      }
      default:
        // ignore other events
        break;
    }
  } catch (e) {
    // log but still 200 so Stripe doesn't hammer retries on a transient DB blip;
    // Stripe will retry on non-2xx, which we reserve for signature/parse failures.
    console.error("webhook handler error:", e);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
