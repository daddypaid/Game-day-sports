# GameDay Sports & Casino — Due Diligence Disclosures

## Operating status

GameDay is **TEST MODE software only**. It is not represented as a licensed sportsbook, licensed online casino, money-transmission business, payment institution or regulated gaming operator.

The current system uses test credits and does not enable real-money deposits, withdrawals or wagering.

## Real-money launch requirements

A buyer seeking a real-money launch is responsible for all applicable jurisdiction-specific requirements, which may include:

- Gaming / sportsbook / casino licensing
- Age and identity verification
- KYC / AML / sanctions screening
- Geolocation
- Responsible-gaming controls and self-exclusion
- Gaming-approved banking and payment processing
- Fraud, chargeback and withdrawal controls
- Privacy, cybersecurity, retention, audit and regulatory reporting
- Sports-data and other commercial content rights

## Sports-data limitation

The current connected provider plan has a known limitation around reliable current-season WNBA player-stat data for deterministic prop grading. Unsupported or unverifiable props must remain view-only until an appropriate data source or plan is connected.

## Live dealer

Live Dealer is intentionally not represented as operational. A real live-dealer experience would require an appropriate provider integration, commercial agreement and any applicable regulatory approvals.

## Operator access model

The current Control Center, Operator Analytics and System Health surfaces are authenticated operator-style tools. They should not be represented as a fully implemented role-based enterprise administration system unless a buyer adds explicit administrative role/allowlist controls.

## Public client configuration

`gameday-config.js` intentionally contains browser-safe values such as the Supabase project URL and publishable browser key. Privileged server credentials and upstream provider secrets must remain server-side.

## Security advisor notes

Current Supabase security review contains:

- Several RLS-enabled tables with no browser policies. In the current architecture those tables are intentionally inaccessible to ordinary browser roles and are used through trusted server-side paths.
- `pg_net` remains installed in the `public` schema because the current scheduled-job implementation depends on it. This is a known advisor warning and should be reviewed during any buyer infrastructure migration.
- Supabase leaked-password protection is currently disabled. Enabling it may require the applicable Supabase plan/settings and should be part of a production security review.

No claim is made that the TEST MODE environment has completed a production penetration test, SOC audit, gaming-lab certification, PCI assessment or regulator security review.

## Performance advisor notes

The actionable themed-slot RLS initialization warnings and a missing themed-slot foreign-key covering index were corrected before this sale package was finalized. Remaining current advisor messages are informational unused-index notices and should be reassessed under buyer production traffic rather than removed solely to silence the linter.

## Third-party rights

The buyer must independently verify transferability and commercial rights for any third-party dependency, data feed, league/team mark, athlete likeness, image, artwork, font, library or service account. Repository presence alone does not prove the seller has unrestricted assignment rights.

## Artwork / branding

Repository artwork and branding assets are intended for inclusion only to the extent the seller confirms ownership or valid transfer rights in the signed asset schedule. Third-party marks or likenesses are excluded unless expressly licensed and assignable.

## Revenue / traffic

Unless separately documented with verifiable records, buyer materials should not imply existing real-money revenue, licensed gaming revenue, guaranteed users, guaranteed traffic, guaranteed conversion rates or guaranteed profitability.

## Technical acceptance

A buyer should complete `BUYER-RELEASE-CHECKLIST.md`, review `gameday-platform-architecture.html`, run the repository CI/deployment checks and independently test the transferred environment before signing technical acceptance.

## Transaction documentation

The final transaction should use a signed asset purchase agreement or other appropriate written agreement covering:

- Purchase price and payment timing
- Exact assets included/excluded
- IP representations and warranties
- Third-party rights and licenses
- Account/domain transfer mechanics
- Data handling and privacy obligations
- Support period and scope
- Liability limitations and indemnities
- Governing law / dispute terms
- Closing conditions and acceptance record

This document is a factual sale-preparation disclosure for the current software package and is not legal advice.