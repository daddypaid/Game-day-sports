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
- `gameday-operator-analytics.html` — TEST MODE activity analytics
- `gameday-system-health.html` — protected operational health checks
- `gameday-config-check.html` — buyer-facing public configuration validation
- `gameday-transfer-audit.html` — browser-facing transferability audit

## Casino surfaces

The repository includes connected GameDay casino experiences including Blackjack, Roulette, Baccarat, Slots, Poker, Video Poker, Bonus Poker, Deuces Wild, Three Card Poker, Ultimate Texas Hold'em and Caribbean Stud. Canonical lobby links should be treated as the supported navigation path during buyer review.

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

`gameday-config.js` is the canonical public client-configuration module for the current buyer-handoff architecture. It contains only browser-safe settings such as the Supabase URL, publishable key, shared function slugs, route names, brand, and TEST environment marker.

The current customer-facing transfer set is centralized on `gameday-config.js`, including the sportsbook, casino lobby, My Bets, account/test wallet, Blackjack, Roulette, Baccarat, Slots, Video Poker, Bonus Poker, Deuces Wild, Three Card Poker, Ultimate Texas Hold'em and Caribbean Stud. The operator Control Center, Operator Analytics and System Health pages use the same public configuration module.

`gameday-config-check.html` validates the configured public project settings and project reachability. `gameday-transfer-audit.html` independently checks the browser-facing customer pages for shared-config adoption and legacy embedded project references. GitHub's `GameDay Transferability Check` workflow provides an additional repository-level CI guard.

A buyer therefore has one canonical browser-configuration file to update for the current supported customer-facing platform. Backend-only credentials remain separate and must be transferred or rotated through secure server-side configuration.

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
9. Open `gameday-transfer-audit.html` and confirm the supported customer-facing pages report centralized configuration with no legacy embedded project reference.
10. Run the `GameDay Transferability Check` workflow and confirm it passes.
11. Connect buyer-owned sports-data provider accounts.
12. Run end-to-end TEST MODE validation for account, wallet, sportsbook, settlement and casino flows.
13. Configure buyer-controlled domain, deployment and monitoring.

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
- `gameday-transfer-audit.html`
- Supabase migrations
- Edge Functions
- RLS policies
- Wallet transaction invariants
- Wager placement and settlement functions
- Casino server-result functions
- Provider integration boundaries
- GitHub Actions deployment and transferability workflows
- PWA manifest and install behavior

## Transfer principle

GameDay should be sold with a clear asset schedule specifying exactly which source code, artwork, branding, domains, accounts, documentation and third-party rights are included. Any third-party service account or licensed data access should be transferred only when the applicable provider permits transfer.
