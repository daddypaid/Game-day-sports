# GameDay Sports & Casino — Buyer Release Acceptance Checklist

## Purpose

Use this checklist when a buyer is reviewing or accepting the GameDay TEST MODE software asset. It is an acquisition and technical-handoff checklist, not a real-money launch authorization.

## 1. Source and ownership

- Confirm access to the buyer-controlled GitHub repository.
- Confirm the agreed source code, artwork, branding, documentation, domains, and other assets are listed in the transaction asset schedule.
- Confirm any third-party code, data, images, or services are transferred or relicensed only where their terms permit it.

## 2. Buyer-facing review

- Open `gameday-buyer-demo.html` and complete the guided product walkthrough.
- Open `gameday-buyer-readiness.html` and review the distinction between transferable TEST MODE software, buyer-owned infrastructure work, and regulated real-money requirements.
- Open `gameday-admin-takeover.html` and review the operational takeover sequence.
- Review `BUYER-OVERVIEW.md` and `ACQUISITION-HANDOFF.md`.

## 3. Public configuration

- Confirm `gameday-config.js` contains the buyer-controlled browser-safe Supabase URL and publishable key.
- Open `gameday-config-check.html` and confirm the configured project is reachable.
- Open `gameday-transfer-audit.html` and confirm the supported customer-facing pages report centralized public configuration with no legacy embedded GameDay project reference.
- Run the `GameDay Transferability Check` GitHub Actions workflow and confirm it passes.

## 4. Backend takeover

- Confirm the buyer controls the target Supabase project and organization.
- Confirm required database schema, RLS policies, indexes, triggers, functions, and migrations are present.
- Confirm required Edge Functions are deployed.
- Confirm scheduled settlement and retention jobs are recreated and enabled as intended.
- Rotate all privileged credentials and provider secrets before operational use.
- Confirm no service-role, sports-data provider, odds-provider, or other backend-only secret appears in browser source.

## 5. TEST MODE functional acceptance

- Create or use a dedicated test account.
- Verify authentication, password recovery, and account flows.
- Verify the test wallet and transaction history.
- Verify sportsbook event and market display.
- Place supported TEST MODE wagers and verify wallet debits and wager history.
- Verify automatic settlement for supported markets.
- Verify unsupported props/futures remain view-only where deterministic grading is unavailable.
- Verify Blackjack, Roulette, Baccarat, Slots, and supported poker-family games operate through authenticated server-side functions.
- Verify casino and sportsbook activity appears correctly in operator analytics without being represented as real-money revenue.

## 6. Health and deployment

- Open `gameday-system-health.html` while signed in and review database, sports-data, provider, cache, wallet, sportsbook, and casino checks.
- Confirm Standard GitHub Pages deployment succeeds.
- Confirm Premium GameDay deployment succeeds.
- Confirm the final public deployment loads the intended premium hub and canonical customer pages.
- Confirm the PWA manifest and install behavior point to the intended GameDay entry experience.

## 7. Real-money prohibition at handoff

The accepted software should remain TEST MODE unless and until the buyer independently completes all applicable legal, regulatory, operational, security, and commercial requirements. These may include, depending on jurisdiction and business model:

- Gaming and sportsbook licensing
- Age and identity verification
- KYC/AML and sanctions controls
- Geolocation
- Responsible-gaming controls and self-exclusion
- Gaming-approved banking/payment processing
- Fraud, risk, chargeback, and withdrawal controls
- Required sports-data and content rights
- Privacy, retention, security, audit, and regulatory reporting requirements

## Acceptance record

Recommended transaction record:

- Repository/commit accepted: ____________________
- Supabase environment accepted: ____________________
- Public deployment accepted: ____________________
- Transferability CI result: ____________________
- Configuration Check result: ____________________
- Transfer Audit result: ____________________
- Buyer representative: ____________________
- Seller representative: ____________________
- Acceptance date: ____________________

This checklist records technical and asset-transfer acceptance only. It does not represent legal approval or authorization to conduct real-money wagering.
