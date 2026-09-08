# GameDay Sports & Casino — V5 Buyer Sales Pack

## What is being sold

GameDay is a transferable sportsbook-and-casino software product presented in TEST MODE. The package includes the customer-facing web application, PWA assets, sportsbook UI, casino portfolio, shared test wallet, authentication flows, wager-history experience, operator tooling, health and analytics surfaces, centralized browser-safe configuration, GitHub deployment automation, and technical handoff documentation.

The sale is for software, source code, product design, technical architecture, deployment assets, and associated documentation. It is not represented as a licensed real-money gambling business.

## V5 buyer demo

Open `gameday-v5.html` first. V5 is an account-free sales demonstration that lets a buyer:

- tap sample sportsbook odds;
- build a single or parlay demo slip;
- enter a demo stake;
- see the calculated potential return;
- create a clearly labeled demo receipt;
- jump directly into the connected TEST MODE sportsbook, buyer walkthrough, or Sale Room.

No backend wager, wallet debit, payment, or real-money transaction is created by the V5 sales demo.

## Connected product surfaces

- `gameday-sportsbook.html` — canonical sportsbook with pregame, live/in-play, player props, futures, and authenticated test-credit wagering.
- `gameday-casino-v2.html` — casino lobby.
- `gameday-my-bets.html` — open and settled test wagers.
- `gameday-auth.html` — authentication, account, test-wallet balance, refill rules, and wallet history.
- `gameday-control-center.html` — operator metrics.
- `gameday-operator-analytics.html` — buyer-facing test analytics.
- `gameday-system-health.html` — backend/provider/wallet/wager/casino health checks.
- `gameday-admin-takeover.html` — acquisition handoff sequence.
- `gameday-sale-room.html` — buyer due-diligence entry point.

## Product architecture highlights

- GitHub Pages customer frontend.
- Supabase authentication, Postgres database, Edge Functions, wallet accounting, settlement, analytics, and system-health services.
- Centralized public configuration in `gameday-config.js` for easier buyer takeover.
- Server-side provider credentials; no service-role or sports-data secret should be stored in the public repository.
- Atomic TEST MODE wallet/wager placement architecture with duplicate protection.
- Scheduled wager settlement and retention jobs.
- RLS-based browser access boundaries documented in the repository.
- Legacy routes preserved as redirect shims rather than duplicate application logic.

## Current TEST MODE capabilities

Sportsbook:

- worldwide sport browsing;
- pregame and live/in-play views;
- moneyline, spread, and total markets;
- player-prop browsing;
- futures browsing;
- authenticated single/parlay test-credit bet slip;
- fresh-quote validation before supported wager placement;
- automatic grading for documented supported markets;
- wager history and test-wallet ledger.

Casino:

- Blackjack;
- Roulette;
- Baccarat;
- Slots;
- Poker-family experiences documented in the repository;
- shared TEST MODE wallet architecture;
- server-side result generation for documented connected games.

Operator/buyer tooling:

- control center;
- aggregate analytics;
- system-health page;
- configuration check;
- transfer audit;
- buyer-readiness scorecard;
- takeover guide;
- GitHub CI verification workflows.

## What the buyer receives

1. GitHub repository and commit history.
2. Customer-facing source files and assets.
3. PWA manifest, icons, offline shell, and service-worker assets.
4. Existing Supabase architecture and transfer documentation, subject to the agreed infrastructure-transfer method.
5. Buyer overview and due-diligence materials.
6. Asset inventory and release checklist.
7. V5 interactive sales demonstration.
8. Existing GitHub Actions deployment/readiness/transferability checks.

## Buyer diligence sequence

Recommended review order:

1. `gameday-v5.html`
2. `gameday-buyer-demo.html`
3. `gameday-sportsbook.html`
4. `gameday-casino-v2.html`
5. `gameday-auth.html`
6. `gameday-my-bets.html`
7. `gameday-control-center.html`
8. `gameday-operator-analytics.html`
9. `gameday-system-health.html`
10. `gameday-transfer-audit.html`
11. `gameday-config-check.html`
12. `gameday-admin-takeover.html`
13. `FINAL-SALE-READINESS.md`
14. `DUE-DILIGENCE-DISCLOSURES.md`

## Important sale disclosure

GameDay remains TEST MODE software. A buyer must independently satisfy all legal, licensing, regulatory, payments, KYC/AML, geolocation, responsible-gaming, fraud/risk, data-rights, tax, and operational obligations applicable to any intended real-money deployment. No claim of gaming licensure, regulated-market approval, or permission to accept real-money wagers is included with the software sale.

## Suggested listing headline

**GameDay Sports & Casino — Transferable Sportsbook + Casino Software Platform with Supabase Backend, PWA, Test Wallet, Operator Analytics & Buyer Handoff Package**

## Suggested short listing copy

GameDay is a mobile-first sportsbook and casino software platform built as a transferable TEST MODE product. The package includes a polished sportsbook, casino portfolio, test-credit wallet, authentication, wager history, automated settlement architecture, operator analytics, health monitoring, PWA support, centralized buyer configuration, and a complete acquisition-handoff package. V5 adds an instant interactive bet-slip demo so a buyer can experience the product before creating an account.

This listing is for software/source code and related IP/assets only, not a licensed real-money gambling operation.
