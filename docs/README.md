# Companio Engine

The operational backend for Companio — the four-role data model, matching brain,
security, and an admin dashboard. Built to run on **Supabase** (Postgres + Auth +
auto REST API) so it shares one database with the website's enquiry/matcher forms.

## The four roles

| Role | Who | In the system |
|------|-----|---------------|
| **Companio** | You / operators | `staff` — sees and manages everything |
| **Companion** | The person who delivers visits (supply) | `companions` (+ `companion_availability`) |
| **Requester** | The buyer — usually the adult child | `requesters` |
| **Service user** | The person who receives visits — usually the parent | `service_users` |

The crucial design choice: **the buyer and the beneficiary are different people.**
A requester arranges and pays; one requester can have several service users (e.g.
both parents). Bookings tie a requester + a service user + a companion together.

## What's here

```
sql/
  01_schema.sql     tables, enums, relationships, indexes, updated_at triggers
  02_rls.sql        Row-Level Security — locks vulnerable people's data by role
  03_functions.sql  match_score(), suggest_matches(), generate_visits(), companion_load
  04_seed.sql       illustrative demo data for one launch town (Guildford/Woking)
dashboard/
  index.html        admin dashboard (Companio-branded ops console)
  engine.js         data layer + matching algorithm + views
docs/
  README.md         this file
```

## The matching brain

`match_score(user, companion)` returns 0–100 + plain-English reasons, weighting the
signals that actually drive a good companionship pairing:

- **Shared interests — 35** (the biggest signal)
- **Service capability — 20** (does the companion offer what's needed: companionship / help / both)
- **Geography — 20** (same postcode district > same town)
- **Temperament fit — 15**
- **Capacity headroom — 10** (a companion with free slots gives more attention)

`suggest_matches(user, limit)` ranks all active companions and stores the top N.
It's deliberately explainable — every score comes with its reasons, so an operator
makes a confident human introduction rather than trusting a black box.

## Deploying to Supabase

1. Create a Supabase project (free tier is fine to start).
2. In the SQL editor, run the files **in order**: `01_schema` → `02_rls` → `03_functions`.
   Optionally run `04_seed` to load demo data (skip for production).
3. **Auth:** create your operator login under Authentication, then insert a `staff`
   row with that user's `auth_user_id` and `is_admin = true`. RLS keys off this.
4. **Dashboard:** open `dashboard/index.html`, set `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` at the top of the inline config. Blank = demo mode (baked-in
   data); filled = live mode: shows a staff login, then runs on your real database.
5. Host the dashboard anywhere static (Netlify, Vercel, or the same host as the site).

## Security model (RLS)

Enabled on every table. Summary:

- **Staff** — full access to everything.
- **Companions** — their own profile, availability, assigned visits/bookings, and the
  service users they're matched to or booked with. They write the notes for their own visits.
- **Requesters** — their own service users, bookings, visits, and the notes shared with family.
- **Service users** — no login; represented by their requester.

Because this system holds data about vulnerable older people, RLS is deny-by-default:
a query returns only the rows the logged-in role is explicitly allowed to see.

## How it connects to the website

The website's enquiry form, companion-matcher, and "Become a Companion" application
already post to Supabase. Map them like this:

- A **matcher / enquiry** submission → a `requesters` row (`source = 'matcher'`,
  `matcher_notes` = the captured summary) + a draft `service_users` row.
- A **companion application** → a `companions` row with `status = 'applicant'`.

This routing is automatic. The website writes every submission into an `enquiries`
inbox table; a Postgres trigger (`05_website_link.sql`) then **promotes** each row
into the proper engine tables. To enable it:

1. Run `05_website_link.sql` (after 01–03).
2. That's it — no website change is needed. The WordPress bridge already posts the
   right fields (name, phone, email, relationship, city, message, matcher) to
   `/rest/v1/enquiries`, and the trigger does the rest.
3. To promote any enquiries that arrived *before* you ran the link, run
   `select promote_backlog();` once.

Nothing is ever lost: the raw submission stays in `enquiries` for audit, with
`promoted_kind` / `promoted_id` recording what each became. The `enquiry_inbox`
view gives a tidy feed of everything that's come in.

The same database powers both the public site and this private ops engine, so a lead
becomes an operational record with no copying or integration glue.

## Not yet built (deliberate next steps)

- **Stripe live charging** — the payments schema, invoice generation, and payment
  recording are built (`06`/`07`), and the invoice tables carry `stripe_*` columns;
  what's left is connecting Stripe Checkout/webhooks to actually take card payments.
- **Automated visit reminders** — `generate_visits()` lays the groundwork; SMS/email
  reminders before each visit are not wired.

Figures in the seed data (pay £14/hr, rate £32/hr) are illustrative — replace with
your verified unit economics before going live.

## What IS built (full backend)

- **Schema, RLS, matching** (`01`–`03`) — the four roles, security, matching brain.
- **Website link** (`05`) — site enquiries auto-promote into requesters/companions.
- **Payments & invoicing** (`06`/`07`) — invoices from completed visits, payment
  tracking, billing summary; run `select generate_invoice('<requester-id>');`.
- **Email** (`08` + `functions/send-email`) — branded transactional email via Resend:
  enquiry acknowledgements, note-to-family after each visit, invoice emails.
- **Operator dashboard** (`dashboard/index.html`) — the staff console.
- **Companion portal** (`dashboard/portal-companion.html`) — companions see their
  visits, write notes to family, manage availability.
- **Editable dashboard text** (`14`) — operators can edit every heading, eyebrow
  and tab description live: click **✏️ Edit text** in the sidebar, click any
  highlighted text, type, and it saves to `app_settings` as `text.<key>`. Buttons,
  data and structural labels are intentionally not editable, to keep the tool safe.
- **AI assist** (`13` + `functions/ai-assist`) — Claude-powered, DORMANT until you
  deploy the function, add `ANTHROPIC_API_KEY`, and turn **AI assist** on in Settings.
  Four tasks, each keeping a human in control (AI drafts, a person reviews & sends):
  · **note_draft** — companion's rough notes → a warm family update (in the companion portal)
  · **match_explain** — human reasoning on why a companion suits a user (operator match drawer)
  · **visit_prep** — a "before you go" briefing from past notes
  · **enquiry_triage** — a suggested first reply + urgency flag for new enquiries
  Uses **Google Gemini 2.5 Flash** (generous free tier — get a key at
  https://aistudio.google.com/apikey).
  Setup: `supabase functions deploy ai-assist`, then
  `supabase secrets set GEMINI_API_KEY=AIza...`, then store the function URL:
  `insert into app_settings(key,value) values ('ai_functions_url','https://YOURPROJECT.functions.supabase.co') on conflict (key) do update set value=excluded.value;`
- **Activate-when-ready features** (`12`) — a feature-flag control panel
  (dashboard **Settings** tab). All dormant until you flip them on:
  · **Stripe** card payments (add keys + deploy a checkout function)
  · **Visit reminders** 24h before (needs Resend)
  · **Document storage** for DBS/ID/agreements (create a `companio-docs` bucket)
  · **Trend reporting** (dashboard **Reports** tab — fills as data grows).
  Each capability reads its flag before doing anything, so nothing fires early.
- **Operations** (`11`) — `cancel_visit`, `reschedule_visit`, `reassign_visit`,
  `reassign_booking`, and `action_items()` (the "needs attention" feed). The
  operator dashboard adds a **Schedule** week-calendar, a **Recruiting** pipeline
  (applicant→vetting→active→paused), per-visit ops controls, and an action panel.
- **Family portal** (`dashboard/portal-requester.html`) — requesters see their loved
  ones, visit schedule, notes from companions, and invoices.

### Email setup (Resend)

1. Sign up at resend.com, verify your `mycompanio.co.uk` domain (add their DNS records).
2. Get a Resend API key.
3. Deploy the function: `supabase functions deploy send-email`
4. Set secrets:
   `supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL="Companio <hello@mycompanio.co.uk>" OPS_EMAIL=hello@mycompanio.co.uk`
5. Run `08_email.sql`, then store your function URL + service key once:
   ```sql
   insert into app_settings(key,value) values
     ('functions_url','https://YOURPROJECT.functions.supabase.co'),
     ('service_key','YOUR-SERVICE-ROLE-KEY')
   on conflict (key) do update set value = excluded.value;
   ```
   Until those are set, email simply no-ops — nothing else breaks.

### Run order (full)

`01_schema` → `02_rls` → `03_functions` → `04_seed` (optional) → `05_website_link`
→ `06_payments` → `07_payments_rls` → `08_email` (after deploying the function)
→ `09_payouts` → `10_payouts_rls` → `11_operations` → `12_features` → `13_ai` → `14_text` → `15_pipeline` → `16_recruiting` → `17_theme` → `18_pricing` → `19_vetting` → `20_checkin` → `21_login`.

### The full money cycle (end to end)

1. **Visit happens** → `select complete_visit('<visit-id>')` (the operator dashboard's
   "Mark visit happened" button). This marks it completed AND accrues the companion's
   pay at their `hourly_pay` into `visit_pay`. It's idempotent.
2. **Bill the family (money in)** → `select generate_invoice('<requester-id>')`.
3. **Pay the companion (money out)** → `select run_payout('<companion-id>')`, then
   `select mark_payout_paid('<payout-id>')`.
4. **See the position** → the `finance_overview` view (revenue, companion cost, gross
   margin, margin %) and `companion_earnings` (per-companion pending/paid). Both are
   surfaced in the operator dashboard's **Finance** tab; companions see their own
   earnings in their portal; families see their invoices in theirs.
