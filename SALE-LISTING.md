# GameDay Sports & Casino — Software Asset for Sale

## Offering

GameDay Sports & Casino is offered as a **TEST MODE sportsbook + casino software/IP asset**. The sale is for the software platform and agreed transferable assets — not for a licensed gambling operation, gambling license, regulated payment account, or guaranteed right to operate real-money wagering.

## What the buyer receives

Subject to the final asset purchase agreement and ownership confirmation, the intended transfer package includes:

- GameDay source repository and customer-facing web/PWA code
- Sportsbook TEST MODE experience with pregame, live, props/futures display, Single and Parlay wagers, Round Robin combinations, supported 4–7-point Teaser selections and verified Buy Points in 0.5-point steps up to 2.0 points, fresh-quote validation and automated supported settlement
- Casino TEST MODE experiences including Blackjack, Roulette, Baccarat, Slots and poker-family games
- Supabase-backed authentication, Postgres schema, RLS, Edge Functions, test-wallet ledger, wager records, casino records, provider cache and scheduled jobs
- Buyer/operator surfaces: Control Center, Operator Analytics, System Health, Buyer Readiness, Transfer Audit, Configuration Check, Admin Takeover and Platform Architecture
- Centralized browser-safe configuration through `gameday-config.js`
- Buyer handoff documentation, transfer checklist and release acceptance checklist
- Repository artwork/assets only to the extent the seller confirms ownership and transfer rights

## Current buyer demonstration

Start at `gameday-sportsbook.html` for the latest customer-facing Sportsbook and at `gameday-casino-v2.html` for casino games. `gameday-buyer-demo.html` gives a guided walkthrough. Browsing is available where supported; supported TEST MODE wager placement requires the buyer to sign into an account with test credits. The historical `gameday-v5.html` sample slip remains available as a standalone simulated demonstration only and does not create backend wagers.

## Current operating state

**TEST MODE ONLY**

GameDay does not currently accept or enable real-money deposits, withdrawals or wagering. A buyer intending to pursue a real-money launch must independently obtain all applicable licensing, KYC/AML, age verification, geolocation, responsible-gaming controls, approved payments, fraud/risk controls, data/content rights and other jurisdiction-specific approvals.

## Technical highlights

- Mobile-first GitHub Pages/PWA frontend
- Supabase Auth + PostgreSQL + Row Level Security
- Server-side Edge Functions for sportsbook wager placement and connected casino results
- Atomic test-wallet accounting and duplicate-wager protection
- Scheduled automatic settlement for supported sportsbook markets
- Shared odds/live-state caching and controlled provider boundary
- Centralized buyer-transfer configuration
- Permanent GitHub Actions checks for deployment and transferability
- Buyer-facing architecture, takeover, readiness and acceptance materials

## Suggested commercial positioning

Position GameDay as a **sportsbook + casino software platform / technology asset** suitable for a buyer that already has, or plans to build, the regulated operating layer required for a commercial gaming launch.

## Current Flippa price range

**$5,000–$7,000 USD — Open to Offers**, as stated by the seller on November 4, 2026. Confirm the current range on Flippa before negotiating; this document is not an independent appraisal, binding sale price or guaranteed valuation. The final purchase price and terms are negotiated with the buyer.

## Suggested deal structure

- Asset sale of the agreed GameDay software/IP package
- Buyer receives the accepted repository commit and agreed transferable backend materials
- Buyer creates or controls its own production accounts and rotates all privileged credentials
- 14 calendar days of reasonable technical handoff support after closing is a suggested default, unless the purchase agreement states otherwise
- Third-party accounts, data licenses and services transfer only where their provider terms permit transfer

## Transfer-at-closing package

At closing, the seller should transfer or deliver only the items specifically listed in the signed asset purchase agreement. The default technical handoff package should include:

1. The accepted `main` branch commit for the GameDay repository.
2. A repository export/archive and the GitHub repository transfer itself if included in the transaction.
3. The buyer-facing documentation set, including `BUYER-OVERVIEW.md`, `V5-BUYER-SALES-PACK.md`, `ASSET-INVENTORY.md`, `DUE-DILIGENCE-DISCLOSURES.md`, `ACQUISITION-HANDOFF.md`, `BUYER-RELEASE-CHECKLIST.md`, and `FINAL-SALE-READINESS.md`.
4. The shared public configuration map in `gameday-config.js` and the documented process for replacing the seller-controlled Supabase project with buyer-controlled infrastructure.
5. Backend schema, Edge Functions, migrations, scheduler/job configuration, and other Supabase materials that the seller owns and the agreement includes.
6. Repository artwork and media only where ownership and transfer rights are confirmed.
7. A credential-rotation checklist. Privileged credentials should be rotated by the buyer rather than delivered as permanent seller credentials.
8. A written inventory of third-party dependencies and any services that require the buyer to establish its own account, subscription, license, API key, or commercial agreement.
9. A final acceptance record showing the agreed repository commit and the latest passing sale-readiness and transferability checks.

The transfer package should **not** be represented as including gambling licensure, payment processing approval, sportsbook/casino operating rights, sports-data licenses, provider contracts, or third-party accounts unless the signed agreement expressly states that they are transferable and included.

## Buyer review path

1. Review `BUYER-OVERVIEW.md`.
2. Open `gameday-sportsbook.html` and `gameday-casino-v2.html` to review the current customer product.
3. Open `gameday-buyer-demo.html` for the guided acquisition walkthrough.
4. Open `gameday-platform-architecture.html`.
5. Open `gameday-buyer-readiness.html`.
6. Review `DUE-DILIGENCE-DISCLOSURES.md` and `ASSET-INVENTORY.md`.
7. Review `ACQUISITION-HANDOFF.md` and `BUYER-RELEASE-CHECKLIST.md`.
8. Run the repository deployment, sale-readiness and transferability checks.
9. Complete buyer technical diligence and negotiate the asset purchase agreement.

## Important

This listing is commercial sale-preparation material, not legal, tax, accounting, securities, gaming-regulatory or valuation advice. Final transaction terms should be documented in a signed asset purchase agreement reviewed by appropriate professionals.