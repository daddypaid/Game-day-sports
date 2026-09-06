# GameDay Sports & Casino — Handoff Rehearsal

## Goal

This rehearsal defines the exact sequence a technical buyer should be able to execute when taking ownership of the TEST MODE software asset. It is designed to prove transferability without enabling real-money operation.

## Rehearsal sequence

### 1. Source control takeover

- Buyer receives or duplicates the accepted GameDay repository commit into a buyer-controlled GitHub account.
- Buyer confirms the default branch and GitHub Actions workflows are present.
- Buyer confirms `gameday-config.js` is the canonical public browser configuration file.

### 2. Buyer-controlled Supabase environment

- Buyer creates or controls a Supabase project.
- Buyer applies the GameDay database migrations/schema required for the agreed transfer.
- Buyer confirms required RLS policies, indexes, triggers and database functions exist.
- Buyer deploys the required Edge Functions.
- Buyer recreates scheduled settlement and retention jobs.
- Buyer configures server-side provider/job secrets using the buyer's own values.

### 3. Public configuration switch

- Buyer updates only the browser-safe Supabase URL and publishable key in `gameday-config.js`.
- Buyer leaves privileged service-role/provider credentials outside browser source.
- Buyer runs `gameday-config-check.html`.
- Buyer runs `gameday-transfer-audit.html`.
- Buyer runs the GameDay Transferability Check workflow.

### 4. Authentication and wallet test

- Create a dedicated TEST MODE account.
- Verify sign-up/sign-in and password recovery.
- Verify the test wallet appears for the authenticated account.
- Verify transaction history is readable only for the authenticated owner.
- Verify the controlled test-credit refill path behaves as documented.

### 5. Sportsbook test

- Load the canonical sportsbook.
- Confirm GameDay-branded event/market data renders.
- Confirm supported selection types can enter the bet slip.
- Place a supported TEST MODE wager.
- Confirm fresh-quote validation occurs through the server placement path.
- Confirm wager, selections and test-wallet debit persist atomically.
- Confirm the wager appears in My Bets.
- Confirm supported settlement is server-determined and the final test credit is applied correctly.
- Confirm unsupported/unverifiable props or futures remain view-only where documented.

### 6. Casino test

For Blackjack, Roulette, Baccarat, Slots and supported poker-family games:

- Confirm authentication is required for protected play.
- Place a TEST MODE wager/round.
- Confirm result generation occurs through the expected server-side Edge Function.
- Confirm the test-wallet debit/payout is reflected in the ledger.
- Confirm round/hand/spin history is persisted where the game supports history.

### 7. Operator / buyer test

- Open Control Center while signed in.
- Open Operator Analytics while signed in.
- Open System Health while signed in.
- Confirm metrics are presented as TEST MODE/simulation activity, not real-money revenue.
- Open Buyer Readiness, Platform Architecture, Transfer Audit, Configuration Check and Admin Takeover.

### 8. Deployment test

- Run Standard GitHub Pages deployment.
- Run Premium GameDay deployment.
- Confirm the installable PWA opens the intended premium entry experience.
- Confirm canonical customer routes and buyer-facing routes are present in the deployed artifact.

### 9. Credential rotation

Before buyer operational use:

- Rotate Supabase privileged credentials.
- Rotate sports-data/provider keys.
- Rotate scheduled-job secrets.
- Rotate deployment credentials where applicable.
- Confirm no backend-only credential is stored in browser HTML/JS/CSS.

### 10. Acceptance record

Record:

- Accepted repository commit
- Buyer Supabase project reference
- Standard deployment result
- Premium deployment result
- Transferability CI result
- Final Sale Readiness CI result
- Configuration Check result
- Transfer Audit result
- Test account used for acceptance
- Date/time of final technical acceptance

## Pass condition

The handoff rehearsal passes when the buyer can reproduce the agreed TEST MODE customer and operator experience on buyer-controlled infrastructure using the documented migration/configuration process, with no requirement to expose privileged credentials to the browser.

## Out of scope

A successful handoff rehearsal does **not** authorize or validate a real-money launch. Licensing, regulated payments, KYC/AML, geolocation, responsible-gaming controls, commercial data rights and other production requirements remain separate buyer obligations.