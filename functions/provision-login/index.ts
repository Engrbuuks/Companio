// ============================================================================
// COMPANIO — provision-login Edge Function (Model A: invite on approval)
// When staff approve a companion or requester, this emails them a secure
// set-your-password invite and links the new Supabase Auth account to their
// row. No passwords are ever stored by Companio.
//
// Uses the SERVICE ROLE key, so it MUST run server-side here (never browser).
// Caller must be a logged-in STAFF member (verified via their JWT).
//
// Deploy:  supabase functions deploy provision-login
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge
//          Functions automatically. If your project names differ, set:
//          supabase secrets set SERVICE_ROLE_KEY=...
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors() });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: "Server not configured" }), { status: 503, headers: cors() });

  // 1. Verify the caller is logged-in staff (their JWT in Authorization).
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!jwt) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: cors() });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: cors() });

  const { data: staffRow } = await admin.from("staff").select("id").eq("auth_user_id", caller.user.id).eq("active", true).maybeSingle();
  if (!staffRow) return new Response(JSON.stringify({ error: "Only Companio staff can create logins" }), { status: 403, headers: cors() });

  // 2. Parse request: { role, id }
  let body: { role?: string; id?: string; redirectTo?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: cors() }); }

  const role = body.role; // 'companion' | 'requester'
  const table = role === "companion" ? "companions" : role === "requester" ? "requesters" : null;
  if (!table || !body.id) return new Response(JSON.stringify({ error: "role (companion|requester) and id required" }), { status: 400, headers: cors() });

  // 3. Load the row, get email
  const { data: row, error: rowErr } = await admin.from(table).select("id, email, full_name, auth_user_id").eq("id", body.id).maybeSingle();
  if (rowErr || !row) return new Response(JSON.stringify({ error: "Record not found" }), { status: 404, headers: cors() });
  if (row.auth_user_id) return new Response(JSON.stringify({ error: "This person already has a login" }), { status: 409, headers: cors() });

  const email = (row.email || "").trim().toLowerCase();
  if (!email) return new Response(JSON.stringify({ error: "No email on file for this person" }), { status: 422, headers: cors() });

  // 4. Send the set-your-password invite (creates the auth user too)
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: row.full_name, role },
    redirectTo: body.redirectTo,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors() });

  const authUserId = data.user?.id;
  if (!authUserId) return new Response(JSON.stringify({ error: "Could not create login" }), { status: 500, headers: cors() });

  // 5. Link the auth account to their row + mark invited
  const { error: linkErr } = await admin.from(table).update({ auth_user_id: authUserId, login_provisioned: true, login_invited_at: new Date().toISOString() }).eq("id", body.id);
  if (linkErr) return new Response(JSON.stringify({ error: "Invite sent but linking failed: " + linkErr.message }), { status: 500, headers: cors() });

  return new Response(JSON.stringify({ ok: true, email }), { status: 200, headers: cors() });
});
