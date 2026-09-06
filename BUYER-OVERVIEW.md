# GameDay Sports & Casino — Buyer Overview

## Product position

GameDay is a connected **TEST MODE sportsbook and casino software platform** prepared as a transferable technology/IP asset. It combines a mobile-first sportsbook, casino game experiences, account authentication, a shared test wallet, automated supported wager settlement, sports-data infrastructure, centralized browser configuration and buyer/operator tooling.

GameDay is **not** represented as a licensed real-money gambling operation. The current software is configured for test credits only.

## Customer-facing modules

### GameDay Sportsbook

- Pregame markets
- Live / in-play views
- Player props
- Futures views
- Bet slip
- Single and parlay test wagering
- Fresh-quote validation before accepted supported test wagers
- Automated server-determined settlement for supported markets

### GameDay Casino

- Blackjack
- Roulette
- Baccarat
- Slots
- Video Poker
- Bonus Poker
- Deuces Wild
- Three Card Poker
- Ultimate Texas Hold'em
- Caribbean Stud
- Shared GameDay test wallet

### Account system

- Supabase authentication
- Sign-up and sign-in
- Password recovery
- Test-wallet balance
- Wallet transaction history
- Controlled test-credit refill behavior

### My Bets

- Open wagers
- Settled wagers
- Selection details
- Stake and potential/actual return
- Automated settlement status

## Buyer / operator features

- Sale Room — buyer diligence hub, suggested asking price and sale documents
- Platform Architecture — frontend/backend/data/provider boundaries
- Buyer Readiness — transferable software vs buyer-owned and regulated-launch requirements
- Admin Takeover — structured acquisition handoff sequence
- GameDay Control Center — aggregate platform metrics
- Operator Analytics — TEST MODE sportsbook/casino/wallet activity
- System Health — database/provider/cache/wallet/sportsbook/casino checks
- Configuration Check — validates public project settings
- Transfer Audit — validates centralized customer configuration

## Backend architecture

The current implementation uses Supabase for:

- Authentication
- PostgreSQL database
- Row Level Security
- Edge Functions
- Test-wallet accounting
- Atomic wager placement
- Casino-result generation
- Sports-data caching
- Scheduled wager settlement
- Data-retention jobs
- Buyer/operator metrics, analytics and health endpoints

Sportsbook browser traffic is routed through controlled GameDay Edge Functions rather than exposing backend provider credentials to the browser.

## Transferability architecture

`gameday-config.js` is the canonical browser-safe configuration module. Supported customer and operator pages use it for the public Supabase URL, publishable browser key, route names and Edge Function slugs.

The package includes:

- Configuration Check
- Transfer Audit
- One-command public-config transfer utility
- Permanent GameDay Transferability Check CI
- Final Sale Readiness Check CI

Privileged backend credentials remain separate from browser code and must be rotated during buyer takeover.

## Wager integrity

GameDay TEST MODE wagering includes:

- Authentication requirement
- Fresh quote revalidation for supported selections
- Atomic wallet debit + wager creation
- Duplicate-wager protection
- Server-determined settlement
- Atomic settlement credit behavior
- Browser roles restricted from direct wallet mutation

## Casino integrity

Connected casino games use authenticated server-side functions and server-side result generation. Browser clients do not directly control protected wallet mutation or hidden game state used to determine results.

## Current operating mode

**TEST MODE ONLY**

GameDay currently does not enable:

- Real-money deposits
- Real-money withdrawals
- Real-money wagering
- Licensed geolocation enforcement
- Production KYC / AML services
- Real-money gaming payment processing

## Production requirements for a buyer

A buyer/operator intending to pursue real-money wagering must independently complete all applicable legal, regulatory, technical, commercial and operational requirements, including where applicable:

- Gaming / sportsbook licensing
- Casino licensing
- Age and identity verification
- KYC / AML / sanctions screening
- Geolocation
- Responsible-gaming controls
- Approved gaming payment processing and withdrawals
- Fraud and risk controls
- Sports-data licensing / commercial rights
- Privacy, security, audit and compliance review

## Current acquisition package

The repository now includes the sale-preparation package:

1. `gameday-sale-room.html` — buyer diligence hub
2. `SALE-LISTING.md` — offering, suggested price and deal structure
3. `ASSET-INVENTORY.md` — source/backend/artwork/transfer inventory
4. `DUE-DILIGENCE-DISCLOSURES.md` — limitations, rights and security disclosures
5. `gameday-platform-architecture.html` — system architecture view
6. `gameday-buyer-readiness.html` — readiness scorecard
7. `gameday-admin-takeover.html` — takeover sequence
8. `ACQUISITION-HANDOFF.md` — technical migration guide
9. `HANDOFF-REHEARSAL.md` — buyer-controlled acceptance rehearsal
10. `BUYER-RELEASE-CHECKLIST.md` — technical acceptance record
11. `FINAL-SALE-READINESS.md` — final sale-readiness record
12. Permanent deployment, transferability and final sale-readiness GitHub Actions checks

## Suggested buyer positioning

GameDay should be marketed as a **sportsbook + casino software platform / technology asset**, not as an operating licensed gambling company. Its value is in the connected customer experience, wagering architecture, casino modules, backend controls, data pipeline, transfer tooling, test environment and ability for a qualified buyer to continue development toward its own compliant production deployment.

## Suggested commercial starting point

The current seller-preparation package uses a **$29,500 USD suggested initial asking price** and **14 calendar days of suggested post-closing technical handoff support**. Those are negotiation defaults only and must be confirmed by the seller in the final transaction documents.