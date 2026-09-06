# GameDay Sports & Casino — Buyer Overview

## Product position

GameDay is a connected **TEST MODE sportsbook and casino software platform** designed as an acquisition-ready technology asset. It combines a mobile-first sportsbook, casino game experiences, account authentication, a shared test wallet, automated wager settlement, sports-data infrastructure, and operator-facing platform metrics.

GameDay is **not** represented as a licensed real-money gambling operation. The software is currently configured for test credits only.

## Customer-facing modules

- GameDay Sportsbook
  - Pregame markets
  - Live / in-play views
  - Player props
  - Futures views
  - Bet slip
  - Single and parlay test wagering
  - Fresh-quote validation before accepted test wagers

- GameDay Casino
  - Blackjack
  - Roulette
  - Baccarat
  - Slots
  - Poker routes including video poker and additional casino-poker experiences
  - Shared GameDay test wallet

- Account system
  - Supabase authentication
  - Sign-up and sign-in
  - Password recovery
  - Test-wallet balance
  - Wallet transaction history
  - Controlled test-credit refill behavior

- My Bets
  - Open wagers
  - Settled wagers
  - Selection details
  - Stake and potential/actual return
  - Automated settlement status

## Operator / acquisition features

- GameDay Control Center
  - Aggregate sportsbook metrics
  - Casino activity metrics
  - Test-user and wager totals
  - Sports event / market / outcome totals
  - Line-history and provider-snapshot visibility
  - Platform-health presentation for buyers and operators

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

Sportsbook browser traffic is routed through controlled GameDay Edge Functions rather than exposing backend provider credentials to the browser.

## Wager integrity

GameDay test wagering includes:

- Authentication requirement
- Fresh quote revalidation for supported selections
- Atomic wallet debit + wager creation
- Duplicate-wager protection
- Server-determined settlement
- Atomic settlement credit behavior
- Browser roles restricted from direct wallet mutation

## Casino integrity

Connected casino games use authenticated server-side functions and server-side result generation. Browser clients do not directly control wallet mutation or hidden game state used to determine results.

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

A buyer/operator intending to launch real-money wagering must independently complete all applicable legal, regulatory, technical, commercial, and operational requirements, including where applicable:

- Gaming / sportsbook licensing
- Casino licensing
- Age and identity verification
- KYC / AML
- Geolocation
- Responsible-gaming controls
- Approved payment processing
- Fraud and risk controls
- Sports-data licensing / commercial rights
- Security and compliance review

## Transfer package target

A completed acquisition package should include:

1. GitHub source repository
2. Supabase project schema and Edge Functions
3. Environment-variable inventory
4. Provider-integration inventory
5. Deployment instructions
6. Architecture overview
7. Brand / artwork inventory and ownership notes
8. Known limitations and production blockers
9. As-is asset-transfer schedule
10. Post-sale support terms, if any

## Suggested buyer positioning

GameDay should be marketed as a **sportsbook + casino software platform / technology asset**, not as an operating licensed gambling company. Its value is in the connected customer experience, wagering architecture, casino modules, backend controls, data pipeline, test environment, and ability for a qualified buyer to continue development toward a compliant production deployment.
