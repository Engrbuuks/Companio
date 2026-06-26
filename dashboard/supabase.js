/* ============================================================
   COMPANIO ENGINE — LIVE DATA LAYER (Supabase)
   Loaded before engine.js. Provides:
     · supa.*    thin REST client (no SDK dependency)
     · auth.*    email/password login, session, logout
     · loadAll() hydrates the in-memory DB from Supabase
     · api.*     write helpers (insert/update) that keep DB in sync
   In demo mode (no creds) every call is a no-op and engine.js
   uses its baked-in seed DB unchanged.
   ============================================================ */

const SB = {
  url: (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) || '',
  key: (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) || '',
  token: null,            // access_token after login
  user: null,             // { id, email }
};
const IS_LIVE = !!(SB.url && SB.key);

/* ---------- low-level REST ---------- */
function sbHeaders(extra) {
  const h = { 'apikey': SB.key, 'Content-Type': 'application/json' };
  if (SB.token) h['Authorization'] = 'Bearer ' + SB.token;
  return Object.assign(h, extra || {});
}
const supa = {
  // GET /rest/v1/<table>?<query>
  async select(table, query = 'select=*') {
    const r = await fetch(`${SB.url}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
    if (!r.ok) throw new Error(`select ${table}: ${r.status} ${await r.text()}`);
    return r.json();
  },
  async insert(table, row) {
    const r = await fetch(`${SB.url}/rest/v1/${table}`, {
      method: 'POST', headers: sbHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`insert ${table}: ${r.status} ${await r.text()}`);
    return (await r.json())[0];
  },
  async update(table, id, patch) {
    const r = await fetch(`${SB.url}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH', headers: sbHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`update ${table}: ${r.status} ${await r.text()}`);
    return (await r.json())[0];
  },
  // call a Postgres function via RPC
  async rpc(fn, args) {
    const r = await fetch(`${SB.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: sbHeaders(), body: JSON.stringify(args || {}),
    });
    if (!r.ok) throw new Error(`rpc ${fn}: ${r.status} ${await r.text()}`);
    return r.json();
  },
};

/* ---------- auth (GoTrue) ---------- */
const auth = {
  async login(email, password) {
    const r = await fetch(`${SB.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': SB.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Login failed');
    SB.token = data.access_token;
    SB.user = { id: data.user.id, email: data.user.email };
    try { localStorage.setItem('companio_session', JSON.stringify({ token: SB.token, user: SB.user })); } catch (e) {}
    return SB.user;
  },
  restore() {
    try {
      const s = JSON.parse(localStorage.getItem('companio_session') || 'null');
      if (s && s.token) { SB.token = s.token; SB.user = s.user; return true; }
    } catch (e) {}
    return false;
  },
  logout() {
    SB.token = null; SB.user = null;
    try { localStorage.removeItem('companio_session'); } catch (e) {}
    location.reload();
  },
  // send a password-reset email. The link lands on set-password.html.
  async resetPassword(email) {
    const redirectTo = encodeURIComponent(location.origin + '/set-password.html');
    const r = await fetch(`${SB.url}/auth/v1/recover?redirect_to=${redirectTo}`, {
      method: 'POST', headers: { 'apikey': SB.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error_description || data.msg || 'Could not send reset email');
    }
    return true;
  },
  // confirm the logged-in user is a Companio staff member
  async verifyStaff() {
    const rows = await supa.select('staff', `select=id,full_name,is_admin&auth_user_id=eq.${SB.user.id}`);
    return rows && rows[0] ? rows[0] : null;
  },
};

/* ---------- hydrate the in-memory DB from Supabase ---------- */
async function loadAll(DB) {
  const [companions, availability, requesters, users, bookings, visits, notes, matches] = await Promise.all([
    supa.select('companions', 'select=*&order=full_name'),
    supa.select('companion_availability', 'select=*'),
    supa.select('requesters', 'select=*&order=created_at.desc'),
    supa.select('service_users', 'select=*'),
    supa.select('bookings', 'select=*'),
    supa.select('visits', 'select=*&order=scheduled_at'),
    supa.select('visit_notes', 'select=*&order=created_at.desc'),
    supa.select('matches', 'select=*').catch(() => []),
  ]);
  DB.companions = companions;
  DB.companion_availability = availability;
  DB.requesters = requesters;
  DB.service_users = users;
  DB.bookings = bookings;
  DB.visits = visits;
  DB.visit_notes = notes;
  DB.matches = matches || [];
  // Finance + ops tables — load these too, or the dashboard shows stale demo rows
  // (this is why an edited demo invoice failed: its id wasn't a real UUID).
  DB.invoices = await supa.select('invoices', 'select=*&order=created_at.desc').catch(() => []);
  DB.visit_pay = await supa.select('visit_pay', 'select=*').catch(() => []);
  DB.safeguarding_concerns = await supa.select('safeguarding_concerns', 'select=*&order=raised_at.desc').catch(() => []);
  // pricing: plans + hourly rates (single source of truth for the website too)
  try {
    DB.plans = await supa.select('plans', 'select=*&order=sort_order').catch(() => DB.plans || []);
  } catch (e) {}
  try {
    const rateRows = await supa.select('app_settings', 'select=key,value&key=in.(rate_companionship,rate_help,rate_both)').catch(() => []);
    DB.rates = DB.rates || {};
    (rateRows || []).forEach(r => { DB.rates[r.key] = r.value; });
  } catch (e) {}
}

/* ---------- write helpers (live → Supabase + local cache) ---------- */
const api = {
  live: IS_LIVE,
  async addCompanion(DB, row) {
    if (IS_LIVE) { const saved = await supa.insert('companions', row); DB.companions.push(saved); return saved; }
    const local = Object.assign({ id: 'c' + Date.now() }, row); DB.companions.push(local); return local;
  },
  async updateCompanion(DB, id, patch) {
    if (IS_LIVE) { const saved = await supa.update('companions', id, patch); }
    const c = DB.companions.find(x => x.id === id); if (c) Object.assign(c, patch); return c;
  },
  async introduceMatch(DB, userId, companionId) {
    if (IS_LIVE) {
      try { await supa.insert('matches', { service_user_id: userId, companion_id: companionId, status: 'introduced' }); } catch (e) {}
    }
    return true;
  },
  async addVisitNote(DB, note) {
    if (IS_LIVE) { const saved = await supa.insert('visit_notes', note); DB.visit_notes.unshift(saved); return saved; }
    const local = Object.assign({ id: 'n' + Date.now(), created_at: new Date().toISOString() }, note);
    DB.visit_notes.unshift(local); return local;
  },
  // server-side matching when live (uses the SQL brain); falls back to JS in demo
  async suggestMatches(DB, userId, limit) {
    if (IS_LIVE) {
      try {
        const rows = await supa.rpc('suggest_matches', { p_user: userId, p_limit: limit || 5 });
        return rows.map(m => ({
          companion: DB.companions.find(c => c.id === m.companion_id) || { full_name: '—', id: m.companion_id },
          score: m.score, reasons: m.reasons || [],
        })).sort((a, b) => b.score - a.score);
      } catch (e) { /* fall through to JS */ }
    }
    return null; // signals engine.js to use its local matcher
  },
};

/* ---------- AI assist (dormant until deployed + enabled) ---------- */
// Create a login for a companion/requester by emailing them a set-password
// invite (Model A). Calls the provision-login Edge Function with the staff JWT.
async function provisionLogin(role, id) {
  if (!IS_LIVE) return { error: 'demo' };
  let base = '';
  try {
    const rows = await supa.select('app_settings', `select=value&key=eq.ai_functions_url`);
    base = rows && rows[0] ? rows[0].value : '';
  } catch (e) {
    return { error: 'Could not read settings (check app_settings read policy): ' + (e.message || e) };
  }
  if (!base) return { error: 'Functions URL not set. Add ai_functions_url to app_settings and ensure it’s readable.' };
  // where the invite link should land: the set-password page on this same site
  const redirectTo = location.origin + '/set-password.html';
  try {
    const r = await fetch(`${base}/provision-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (SB.token || '') },
      body: JSON.stringify({ role, id, redirectTo }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error || ('Function error ' + r.status) };
    return { ok: true, email: j.email };
  } catch (e) { return { error: 'Could not reach function: ' + (e.message || e) }; }
}

async function aiAssist(task, data) {
  // live: call the ai-assist Edge Function. demo/not-configured: signal unavailable.
  if (!IS_LIVE) return { error: 'demo' };
  let base = '';
  try {
    const rows = await supa.select('app_settings', `select=value&key=eq.ai_functions_url`);
    base = rows && rows[0] ? rows[0].value : '';
  } catch (e) {}
  if (!base) return { error: 'AI not configured' };
  try {
    const r = await fetch(`${base}/ai-assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (SB.key || '') },
      body: JSON.stringify({ task, data }),
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error || 'AI request failed' };
    return { result: j.result };
  } catch (e) { return { error: String(e) }; }
}
