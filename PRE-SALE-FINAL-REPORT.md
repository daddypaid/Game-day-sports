# GameDay Pre-Sale Final Report

## Buyer-blocking issues found

- V5 buyer demo JavaScript parse error prevented market cards and the interactive demo slip from loading.
- Canonical sportsbook did not visibly label its top-level page as TEST MODE.
- Live `gameday-odds` Edge Function returned HTTP 503 during the September 8, 2026 buyer walkthrough, leaving the sportsbook without live GameDay lines.

## Fixes completed

- Corrected the V5 syntax error without changing wagering architecture or backend behavior.
- Added a visible TEST MODE label to the canonical sportsbook header.
- Verified the complete buyer-path files and all literal local HTML links; no missing buyer-facing local target was found.
- Added a final transfer manifest and buyer diligence checklist.

## Items requiring Ant personally

- Restore/verify the sports-data provider and `gameday-odds` function before any live buyer demonstration.
- Confirm chain of title and transfer rights for branding, artwork, marks, likenesses, code and contractor contributions.
- Decide the final asking price, minimum floor, assets/accounts included, buyer identity and deal terms; obtain a signed asset purchase agreement and use a secure closing/payment process.
- Provide or exclude the separately enumerated Supabase backend source/migrations and approve the final closing asset schedule.

## Price recommendation

- Recommended asking range: **$27,500–$35,000**.
- Recommended minimum negotiation floor: **$18,500**, assuming source, documentation and reproducible backend artifacts are delivered and the live-odds blocker is cleared.
- The current **$29,500** ask is defensible as an opening price, but not as a turnkey regulated sportsbook valuation. Public market signals span a roughly $4,900 small gambling-code listing, approximately €25,000 sportsbook setup pricing and approximately €40,000 white-label casino pricing; broader custom/turnkey offerings can be materially higher because they include compliance, payments, support, data and production operations that GameDay expressly excludes.

## Sale package

- Exact contents and exclusions are defined in `FINAL-TRANSFER-MANIFEST.md`; buyer acceptance items are in `BUYER-DILIGENCE-CHECKLIST.md`.

## Recommendation

- **NO-GO for an unrestricted live listing today.** Deploy the two frontend fixes, confirm both repository checks pass, and restore live odds first. Then **GO** to list GameDay explicitly as TEST MODE software/IP with the manifest, diligence checklist and regulatory/data-rights exclusions attached.
