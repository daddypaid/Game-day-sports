# GameDay Sports & Casino — Asset Inventory

## Purpose

This inventory identifies the principal GameDay software and buyer-handoff assets currently present in the repository and connected TEST MODE backend. It is a due-diligence aid, not a representation that every third-party dependency or artwork item is automatically transferable.

## Source repository

- Repository: `daddypaid/Game-day-sports`
- Default branch: `main`
- Frontend/deployment: GitHub Pages / PWA
- Shared browser-safe configuration: `gameday-config.js`

## Canonical customer surfaces

- `index.html` — premium product hub
- `gameday-sportsbook.html` — sportsbook
- `gameday-casino-v2.html` — casino home
- `gameday-my-bets.html` — open/settled test wagers
- `gameday-auth.html` — authentication, recovery, test wallet and ledger history

## Casino / poker customer surfaces

- `gameday-blackjack.html`
- `gameday-roulette.html`
- `gameday-baccarat.html`
- `gameday-slots.html`
- `gameday-slots-lobby.html`
- `gameday-poker.html`
- `gameday-video-poker.html`
- `gameday-bonus-poker.html`
- `gameday-deuces-wild.html`
- `gameday-three-card-poker.html`
- `gameday-ultimate-texas-holdem.html`
- `gameday-caribbean-stud.html`

## Buyer / operator surfaces

- `gameday-buyer-demo.html`
- `gameday-buyer-readiness.html`
- `gameday-platform-architecture.html`
- `gameday-admin-takeover.html`
- `gameday-control-center.html`
- `gameday-operator-analytics.html`
- `gameday-system-health.html`
- `gameday-config-check.html`
- `gameday-transfer-audit.html`

## Buyer documentation

- `README.md`
- `BUYER-OVERVIEW.md`
- `SALE-LISTING.md`
- `ASSET-INVENTORY.md`
- `DUE-DILIGENCE-DISCLOSURES.md`
- `ACQUISITION-HANDOFF.md`
- `BUYER-RELEASE-CHECKLIST.md`
- `HANDOFF-REHEARSAL.md`
- `FINAL-SALE-READINESS.md`

## Frontend application assets

The repository contains UI artwork and SVG/JPG assets under `art/` and `assets/`, including sportsbook hero artwork, casino-room/table artwork and slot-card artwork. These files should be included in the sale only after the seller confirms ownership or valid transfer rights for each item.

Representative repository assets include:

- `art/gameday-sportsbook-approved-hero.jpg`
- `art/gameday-sportsbook-hero.svg`
- `assets/gameday-blackjack-table-premium.svg`
- `assets/gameday-roulette-room.svg`
- `assets/gameday-baccarat-room.svg`
- `assets/gameday-poker-room.svg`
- `assets/gameday-poker-table-room.svg`
- `assets/gameday-video-poker-premium.svg`
- `assets/gameday-account-premium.svg`
- `assets/gameday-my-bets-premium.svg`
- slot-card SVGs under `assets/`

## Connected Supabase TEST MODE backend

Current GameDay project reference: `qsvrvhcklnsbekxblpfo`.

The connected backend currently includes active Edge Functions for, among other things:

- `gameday-odds`
- `gameday-live-state`
- `place-test-wager`
- `settle-test-wager`
- `auto-settle-test-wagers`
- `refill-test-wallet`
- `blackjack-test`
- `roulette-test`
- `baccarat-test`
- `slots-test`
- `video-poker-test`
- `three-card-poker-test`
- `ultimate-texas-holdem-test`
- `caribbean-stud-test`
- `themed-slots-test`
- `gameday-operator-metrics`
- `gameday-operator-health`
- `gameday-operator-analytics`
- provider/probe/internal-support functions used by the TEST MODE data stack

A buyer should recreate or transfer the permitted schema, RLS, functions, scheduled jobs and server-side secrets into buyer-controlled infrastructure and rotate all privileged credentials.

## Data / functional asset categories

- User authentication configuration
- Profiles and test-wallet data model
- Wallet transaction ledger
- Wagers and wager selections
- Sports events, markets, outcomes and line history
- Provider snapshots and odds response cache
- Blackjack, Roulette, Baccarat, Slots and poker-family persistence
- Operator metrics / analytics / health functions
- Scheduled settlement and data-retention behavior

## CI / deployment assets

Permanent GitHub Actions include:

- Standard GitHub Pages deployment
- Premium GameDay deployment
- GameDay Transferability Check
- Final Sale Readiness Check

## Third-party / non-owned-by-default items

The asset sale should not imply ownership of or automatic transfer rights to:

- Supabase itself or Supabase subscription rights
- GitHub itself or GitHub subscription rights
- Sports-data provider accounts, feeds, licenses or upstream data
- CDN-hosted third-party libraries
- Third-party trademarks, league/team marks, athlete likenesses or other licensed content unless separately documented
- Any payment, KYC, geolocation, gaming-license or regulatory account not expressly included in the signed asset schedule

## Final transaction rule

The signed purchase agreement should contain an exhibit identifying exactly which repository, domains, artwork, source code, documents, accounts, credentials, data rights and support obligations are included or excluded. Anything not expressly included should be treated as excluded until documented.