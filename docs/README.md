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

- **Payments** — the schema carries rates and visit lengths so invoicing/Stripe can
  bolt on cleanly, but billing isn't wired yet.
- **Companion & requester self-service portals** — the data model and RLS already
  support their logins; the dashboard here is the operator (staff) view only.
  (Live operator login + Supabase data layer are now built — see `dashboard/supabase.js`.)
- **Automated visit reminders / note nudges** — `generate_visits()` lays the groundwork.

Figures in the seed data (pay £14/hr, rate £32/hr) are illustrative — replace with
your verified unit economics before going live.
