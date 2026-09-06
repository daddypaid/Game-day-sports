# GameDay Sports

GameDay Sports is a TEST MODE sportsbook and casino platform hosted on GitHub Pages with Supabase providing authentication, database storage, Edge Functions, test-wallet accounting, scheduled settlement jobs, operator metrics, analytics, and system-health monitoring.

## Current status

- TEST MODE only — no real-money deposits, withdrawals, or wagering.
- Customer-facing odds are branded only as **GameDay Sports**.
- Third-party provider credentials stay server-side in Supabase secrets and must never be committed to this repository.
- New test accounts receive $1,000 in test credits.
- A signed-in tester can refill a balance below $25 back to $1,000 at most once every 24 hours.

## Premium entry and buyer-facing pages

- `index.html` — premium GameDay product hub
- `gameday-buyer-demo.html` — guided acquisition/buyer walkthrough
- `gameday-control-center.html` — protected operator dashboard with aggregate platform metrics
- `gameday-operator-analytics.html` — protected buyer-facing sportsbook, casino, and wallet activity analytics
- `gameday-system-health.html` — protected system-health, provider freshness, cache, ledger, sportsbook, and casino activity monitoring
- `gameday-admin-takeover.html` — buyer/operator takeover sequence covering due diligence, infrastructure transfer, credential rotation, deployment validation, and TEST MODE safeguards
- `gameday-buyer-readiness.html` — buyer readiness scorecard separating transferable TEST MODE software from buyer-owned infrastructure work and regulated real-money requirements
- `gameday-transfer-audit.html` — browser-facing audit of centralized public configuration across supported customer pages
- `gameday-config-check.html` — public configuration validation page for buyer-controlled Supabase settings
- `BUYER-OVERVIEW.md` — buyer-ready product overview
- `ACQUISITION-HANDOFF.md` — technical transfer and due-diligence guide
- `BUYER-RELEASE-CHECKLIST.md` — buyer technical acceptance checklist for source, configuration, backend takeover, TEST MODE functionality, deployment, and handoff records

The installable PWA opens the premium hub and includes shortcuts to Sportsbook, Casino, My Bets, and Control Center.

## Canonical customer pages

- `gameday-sportsbook.html` — Sportsbook
- `gameday-casino-v2.html` — Casino home
- `gameday-my-bets.html` — Open and settled test wagers
- `gameday-auth.html` — Account, password recovery, test wallet, and wallet history

Working casino games:

- `gameday-blackjack.html`
- `gameday-roulette.html`
- `gameday-baccarat.html`
- `gameday-slots.html`

Older wallet, betslip, settlement, live, v2/v3/v4, wager, and casino routes are redirect shims only. Do not rebuild independent wagering logic in those files.

## Operator tooling

`gameday-operator-metrics` is a protected Supabase Edge Function that exposes aggregate platform totals for the Control Center without exposing service credentials in the browser.

`gameday-operator-analytics` is a protected Supabase Edge Function that exposes TEST MODE aggregate analytics for buyer due diligence, including sportsbook wager count and simulated handle, casino round count and simulated handle/payouts, activity mix by sport and casino game, recent activity, and wallet-ledger movement. These figures are simulation metrics and are not real-money revenue.

`gameday-operator-health` is a protected Supabase Edge Function that evaluates:

- Core database reachability
- Sports-data activity
- Provider snapshot freshness
- Odds-cache freshness
- Test wallet-ledger activity
- Sportsbook test-wager activity
- Casino test-round/spin activity

`gameday-admin-takeover.html` gives an acquiring buyer or replacement operator a structured handoff sequence: review the product, review the Buyer Readiness scorecard, verify health, review test analytics, run the Transfer Audit and Configuration Check, transfer source/infrastructure, rotate credentials, revalidate deployment/jobs, and keep real-money operation disabled until all required legal and operational controls are completed.

The operator pages are intended for test-mode platform demonstration, technical review, and buyer due diligence. They do not indicate licensure or real-money production readiness.

## Transferability architecture

`gameday-config.js` is the canonical browser-safe configuration module for the supported customer-facing platform. It centralizes the Supabase project URL, publishable browser key, Edge Function slugs, route names, brand, and TEST environment marker.

The supported sportsbook, account, core casino, and poker-family customer pages use this shared public configuration rather than embedding the current GameDay Supabase project reference directly in each page. `gameday-transfer-audit.html` verifies that browser-facing centralization, while the permanent `GameDay Transferability Check` GitHub Actions workflow prevents regression of the shared configuration and buyer handoff surfaces.

Backend-only secrets remain server-side and are not part of the browser configuration module.

## Sportsbook architecture

Public browser traffic calls the controlled `gameday-odds` Supabase Edge Function. The raw `odds-engine` provider layer is internal-only. A shared response cache reduces provider quota usage, while wager placement uses a protected fresh-quote bypass so accepted lines are revalidated immediately before any test-wallet debit.

Live game state is supplied by `gameday-live-state`, with shared caching and stale-cache fallback. Empty live slates use a longer cache window to conserve API quota. MLB customer cards intentionally display only score plus Top/Bottom inning state; balls, strikes, outs, bases, batter, and pitch detail are not shown.

## Test wager integrity

`place-test-wager` requires authentication and revalidates supported selections before calling the atomic database placement RPC. Wallet balance, wager creation, wager selections, and the debit ledger entry are committed atomically. A short duplicate-wager fingerprint prevents accidental double-tap/retry debits.

Supported automatic grading currently includes:

- Moneyline
- Spread
- Total
- Verified NFL/NCAAF player-stat props
- Verified MLB player props backed by final official MLB box scores

Unsupported player props and all futures remain **VIEW ONLY** until deterministic automatic grading is available. They must not debit test credits.

## Settlement

`auto-settle-test-wagers` runs every 5 minutes through Supabase Cron. Settlement is server-determined and atomic. The database verifies that every wager selection is graded exactly once and that the final wager result and credit are internally consistent.

Manual user-directed settlement is disabled.

## Casino integrity

Blackjack, Roulette, Baccarat, and Slots require authenticated Edge Functions and server-side result generation. Browser roles cannot call the atomic casino wallet RPCs directly. Blackjack hidden dealer-card/shoe state is not readable by authenticated browser users.

Live Dealer is intentionally disabled until a real provider integration exists.

## Test wallet

Browser roles have read-only access to their own wallet, wager, selection, and wallet-transaction records through RLS. All balance mutations occur through trusted server-side atomic functions.

The ledger includes wager debits, win credits, refunds, and test-credit adjustments. Duplicate sportsbook debit/credit/refund entries for the same wager are blocked at the database layer.

## Background jobs

- `auto-settle-test-wagers` — every 5 minutes
- `gameday-data-retention` — daily cleanup of expired cache and old provider/history data

## Security notes

- Never commit `SUPABASE_SERVICE_ROLE_KEY`, `API_SPORTS_KEY`, `ODDS_API_KEY`, or `sb_secret_...` values.
- The Supabase publishable browser key is intentionally public.
- Backend-only tables use RLS with no browser policies where appropriate.
- `pg_net` is currently installed in `public` because the working scheduler depends on it; do not force-move it without a supported migration path.
- Supabase leaked-password protection requires a paid plan. Client-side signup/password-reset rules currently require at least 8 characters with uppercase, lowercase, a number, and a symbol.

## Current provider limitation

The connected API-SPORTS Free plan does not expose the current 2026 WNBA season player-stat data required for reliable WNBA prop grading. Basketball props that cannot be deterministically graded must remain VIEW ONLY until an appropriate current-season data plan/provider is connected.

## Production / real-money blockers

Do not switch GameDay out of TEST MODE until the operator has completed all applicable legal, regulatory, operational, and data-rights requirements, including sportsbook/gaming licensing, age and identity verification, KYC/AML, geolocation, responsible-gambling controls, payments, fraud/risk controls, and licensed sports-data rights where required.
