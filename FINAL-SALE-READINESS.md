# GameDay Sports & Casino — Final Sale Readiness Record

## Sale position

GameDay is prepared to be marketed as a **TEST MODE sportsbook + casino software/IP asset**. It is not represented as a licensed real-money gambling operation.

## Technical sale-readiness status

### Repository and deployment

- Source repository present on `main`
- Premium product hub present
- Standard GitHub Pages deployment workflow present
- Premium GameDay deployment workflow present
- GameDay Transferability Check workflow present
- Final Sale Readiness Check workflow present
- Shared service worker/PWA support present through `gameday-app.js` and `sw.js`

### Customer product

- Sportsbook canonical page present
- Casino canonical page present
- Account/auth/test-wallet page present
- My Bets page present
- Blackjack present
- Roulette present
- Baccarat present
- Slots present
- Poker-family customer pages present

### Transferability

- `gameday-config.js` is the canonical browser-safe configuration module
- Core customer and operator pages use centralized public configuration
- Buyer Configuration Check present
- Transfer Audit present
- One-command public-config transfer utility present
- Permanent Transferability CI guard present

### Backend

- Supabase TEST MODE project connected
- Sportsbook placement and settlement functions active
- Casino result functions active
- Operator metrics/health/analytics functions active
- Scheduled settlement/data-retention architecture documented
- Actionable themed-slot RLS/index performance advisor findings corrected before final sale package

### Buyer package

- Buyer Overview
- Sale Listing
- Asset Inventory
- Due Diligence Disclosures
- Platform Architecture page
- Buyer Readiness page
- Admin Takeover page
- Acquisition Handoff Guide
- Handoff Rehearsal
- Buyer Release Checklist

## Known disclosures that remain intentionally open

These items do not prevent sale as a TEST MODE software asset, but must remain disclosed:

- No real-money wagering, deposits or withdrawals
- No claim of gaming/sportsbook/casino licensure
- No production KYC/AML/geolocation/responsible-gaming stack
- No gaming-approved production payment processing
- Live Dealer is not operational
- Current data-provider limitations may leave some player props view-only
- Operator tools are authenticated but not represented as a full role-based enterprise admin system
- Supabase `pg_net` public-schema advisor warning remains documented because the working scheduler depends on it
- Supabase leaked-password protection remains a production hardening item
- Third-party data, marks, likenesses, artwork and service accounts transfer only where rights permit

## Recommended commercial defaults

These are suggested seller defaults, not binding transaction terms:

- Asking price: **$29,500 USD**
- Suggested post-closing handoff support: **14 calendar days**
- Transaction type: asset sale of agreed software/IP and transferable assets
- Buyer must use buyer-controlled production infrastructure and rotate all privileged credentials

## What still requires the seller personally

The software package can be technically sale-ready without these decisions, but a transaction cannot close until the seller personally:

1. Confirms the final asking price and minimum acceptable price.
2. Confirms exactly which domains/accounts/artwork are legally owned and included.
3. Chooses whether any third-party accounts are transferred, recreated or excluded.
4. Approves the final purchase agreement and representations/warranties.
5. Signs the closing documents and receives payment.

## Final technical gate

Before sending the package to a serious buyer, confirm the latest `main` commit has successful:

- Standard Pages deployment
- Premium GameDay deployment
- GameDay Transferability Check
- Final Sale Readiness Check

Then use `BUYER-RELEASE-CHECKLIST.md` for buyer technical acceptance.

## Boundary

“Sale ready” in this record means prepared to market and transfer the current TEST MODE software/IP asset. It does not mean legally cleared or technically certified for real-money gaming operation.