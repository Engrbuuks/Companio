// ============================================================================
// COMPANIO — send-email Edge Function (Supabase + Resend)
// One endpoint that sends branded transactional emails via Resend.
// Called by database webhooks/triggers (see 08_email.sql) or directly.
//
// Deploy:  supabase functions deploy send-email
// Secrets: supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL="Companio <hello@mycompanio.co.uk>"
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Companio <hello@mycompanio.co.uk>";
const OPS_EMAIL = Deno.env.get("OPS_EMAIL") ?? "hello@mycompanio.co.uk";

// shared brand wrapper so every email looks like Companio
function wrap(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F4F0EA;font-family:Mulish,Arial,sans-serif;color:#241F2B">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="text-align:center;margin-bottom:18px">
      <span style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:50%;background:#E7B86A;color:#322E3D;font-weight:800">&#8734;</span>
      <div style="font-family:Georgia,serif;font-size:20px;color:#322E3D;font-weight:700;margin-top:6px">Companio</div>
    </div>
    <div style="background:#fff;border:1px solid #E2DBD0;border-radius:14px;padding:26px 24px">
      <h1 style="font-family:Georgia,serif;color:#322E3D;font-size:20px;margin:0 0 14px">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;color:#7A7488;font-size:12px;margin-top:18px">Companio · A Friend, Not a Carer · mycompanio.co.uk</p>
  </div></body></html>`;
}

// templates keyed by `type`
function build(type: string, data: Record<string, unknown>) {
  switch (type) {
    case "enquiry_received": // -> ops team
      return {
        to: OPS_EMAIL,
        subject: `New enquiry: ${data.name ?? "someone"}`,
        html: wrap("New enquiry", `
          <p style="margin:0 0 10px">A new enquiry just came in from the website.</p>
          <p style="margin:0 0 6px"><b>Name:</b> ${data.name ?? "—"}</p>
          <p style="margin:0 0 6px"><b>Phone:</b> ${data.phone ?? "—"}</p>
          <p style="margin:0 0 6px"><b>Email:</b> ${data.email ?? "—"}</p>
          <p style="margin:0 0 6px"><b>City:</b> ${data.city ?? "—"}</p>
          ${data.matcher ? `<p style="margin:10px 0 0;padding:10px;background:#FAF7F1;border-radius:8px"><b>Matcher:</b> ${data.matcher}</p>` : ""}
          ${data.message ? `<p style="margin:10px 0 0"><b>Message:</b> ${data.message}</p>` : ""}`),
      };
    case "enquiry_ack": // -> the family who enquired
      return {
        to: String(data.email ?? ""),
        subject: "Thank you for getting in touch with Companio",
        html: wrap(`Thank you, ${data.first_name ?? "there"}`, `
          <p style="margin:0 0 12px">We’ve received your enquiry and a coordinator will be in touch very soon to arrange a free, no-pressure introduction call.</p>
          <p style="margin:0 0 12px">There’s nothing else you need to do right now. We’ll take it from here.</p>
          <p style="margin:0">With warmth,<br>The Companio team</p>`),
      };
    case "note_to_family": // -> requester after a visit note
      return {
        to: String(data.email ?? ""),
        subject: `A note after ${data.user_name ?? "your loved one"}’s visit`,
        html: wrap(`How ${data.user_name ?? "the"} visit went`, `
          <p style="margin:0 0 12px;color:#7A7488;font-size:13px">From ${data.companion_name ?? "your companion"} · ${data.when ?? ""}</p>
          <p style="margin:0 0 14px;line-height:1.6">${data.summary ?? ""}</p>
          <p style="margin:0;color:#7A7488;font-size:13px">You can see all visit notes any time in your family portal.</p>`),
      };
    case "invoice_sent": // -> requester
      return {
        to: String(data.email ?? ""),
        subject: `Your Companio invoice ${data.number ?? ""}`,
        html: wrap("Your invoice", `
          <p style="margin:0 0 12px">Here’s your latest invoice for companionship visits.</p>
          <p style="margin:0 0 6px"><b>Invoice:</b> ${data.number ?? "—"}</p>
          <p style="margin:0 0 6px"><b>Amount:</b> £${data.total ?? "0.00"}</p>
          <p style="margin:0 0 12px"><b>Due:</b> ${data.due_date ?? "—"}</p>
          <p style="margin:0;color:#7A7488;font-size:13px">View the full breakdown in your family portal.</p>`),
      };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500 });

  let payload: { type?: string; data?: Record<string, unknown> };
  try { payload = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }

  const msg = build(payload.type ?? "", payload.data ?? {});
  if (!msg) return new Response(JSON.stringify({ error: "unknown email type" }), { status: 400 });
  if (!msg.to) return new Response(JSON.stringify({ error: "no recipient" }), { status: 400 });

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: msg.to, subject: msg.subject, html: msg.html }),
  });

  const out = await r.text();
  return new Response(out, { status: r.status, headers: { "Content-Type": "application/json" } });
});
