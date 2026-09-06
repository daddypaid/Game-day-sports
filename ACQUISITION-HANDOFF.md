# GameDay Sports & Casino — Acquisition Handoff Guide

## Purpose

This document gives a prospective buyer or technical team a concise handoff map for the GameDay TEST MODE sportsbook and casino software platform.

GameDay is software/IP in TEST MODE. It is not represented as a licensed real-money sportsbook or online casino.

## Core customer surfaces

- `index.html` — premium product hub
- `gameday-sportsbook.html` — canonical sportsbook
- `gameday-casino-v2.html` — canonical casino home
- `gameday-my-bets.html` — open and settled test wagers
- `gameday-auth.html` — authentication, recovery, wallet and transaction history
- `gameday-buyer-demo.html` — guided acquisition walkthrough
- `gameday-control-center.html` — operator/buyer metrics dashboard
- `gameday-config-check.html` — buyer-facing public configuration validation

## Casino surfaces

The repository includes connected GameDay casino experiences including Blackjack, Roulette, Baccarat, Slots, Poker and additional casino-poker variants. Canonical lobby links should be treated as the supported navigation path during buyer review.

## Backend

GameDay uses Supabase for:

- Authentication
- PostgreSQL database
- Row Level Security
- Edge Functions
- Test-wallet accounting
- Wager persistence
- Casino round persistence
- Sports event/market/outcome storage
- Provider response caching
- Scheduled settlement and maintenance jobs

Current connected GameDay Supabase project reference:

`qsvrvhcklnsbekxblpfo`

A buyer should create or control its own Supabase organization/project and migrate the schema, functions, secrets and scheduled jobs before final production ownership.

## Sportsbook architecture

Customer sportsbook requests are routed through controlled backend functions rather than exposing upstream provider credentials in the browser. Supported TEST MODE selections are revalidated before wallet debit. Test wager placement and wallet accounting are designed to be atomic.

Automatic grading currently covers supported sportsbook markets documented in `README.md`. Unsupported markets must remain view-only unless deterministic settlement logic is implemented.

## Casino architecture

Connected casino games use server-side Edge Functions for result generation and wallet mutation. Browser clients should not receive service-role credentials or direct write access to protected wallet mutation paths.

## Configuration and secrets

`gameday-config.js` is the canonical public client-configuration module for the buyer-handoff architecture. It contains only browser-safe settings such as the Supabase URL, publishable key, shared function slugs, route names, brand, and TEST environment marker.

`gameday-config-check.html` validates that public configuration and checks whether the configured Supabase project is reachable. A buyer should use it after replacing public project settings.

Some legacy customer pages still contain embedded public Supabase settings and should be migrated to `gameday-config.js` during the buyer-controlled frontend consolidation. This is a transferability improvement in progress, not a claim that every legacy page has already been converted.

Never commit backend-only credentials to GitHub. A buyer must replace all environment-specific values and secrets, including as applicable:

- Supabase service-role credentials
- Sports-data provider API credentials
- Odds-provider API credentials
- Scheduled-job secrets
- Future KYC/geolocation/payment credentials

The Supabase publishable browser key is intentionally client-visible; privileged credentials are not.

## Buyer migration sequence

1. Transfer or duplicate the GitHub repository into the buyer-controlled account.
2. Create a buyer-controlled Supabase project.
3. Recreate database schema, RLS policies, indexes, triggers and database functions from migrations.
4. Deploy Edge Functions to the buyer-controlled Supabase project.
5. Configure backend secrets.
6. Recreate scheduled settlement and retention jobs.
7. Update `gameday-config.js` with the buyer's browser-safe Supabase URL and publishable key.
8. Open `gameday-config-check.html` and verify the new project is reachable.
9. Migrate any remaining legacy frontend pages that still embed public Supabase settings to the shared config module.
10. Connect buyer-owned sports-data provider accounts.
11. Run end-to-end TEST MODE validation for account, wallet, sportsbook, settlement and casino flows.
12. Configure buyer-controlled domain, deployment and monitoring.

## Real-money production blockers

A buyer must not enable real-money wagering solely by replacing the TEST MODE wallet. Before real-money operation, the buyer is responsible for all applicable requirements, including:

- Gaming/sportsbook licensing and jurisdiction approvals
- Age and identity verification
- KYC/AML and sanctions controls
- Geolocation
- Responsible-gaming controls and self-exclusion
- Gaming-approved banking and payment processing
- Fraud and chargeback controls
- Withdrawal controls
- Required sports-data and content rights
- Security, privacy, retention and audit requirements

## Recommended technical due diligence

A technical buyer should review:

- `README.md`
- `gameday-config.js`
- `gameday-config-check.html`
- Supabase migrations
- Edge Functions
- RLS policies
- Wallet transaction invariants
- Wager placement and settlement functions
- Casino server-result functions
- Provider integration boundaries
- GitHub Actions deployment workflows
- PWA manifest and install behavior

## Transfer principle

GameDay should be sold with a clear asset schedule specifying exactly which source code, artwork, branding, domains, accounts, documentation and third-party rights are included. Any third-party service account or licensed data access should be transferred only when the applicable provider permits transfer.
