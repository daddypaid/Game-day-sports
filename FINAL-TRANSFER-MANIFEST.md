# GameDay Final Transfer Manifest

## Included source code

- All committed HTML, CSS, JavaScript, PWA, configuration, utility-script and workflow source in the accepted `daddypaid/Game-day-sports` repository commit.
- Customer surfaces: product hub, sportsbook, account, wallet, My Bets and settlement views.
- Casino surfaces: casino lobby, Blackjack, Roulette, Baccarat, Slots, Video Poker, Bonus Poker, Deuces Wild, Three Card Poker, Ultimate Texas Hold'em and Caribbean Stud.
- Buyer/operator surfaces: Sale Room, V5 Demo, Buyer Walkthrough, Control Center, Analytics, System Health, Architecture, Buyer Readiness, Configuration Check, Admin Takeover and Transfer Audit.

## Frontend assets

- Web app manifest, service worker, offline page, icons and repository-hosted styles/scripts.
- Responsive/mobile presentation code and browser-safe shared configuration in `gameday-config.js`.

## Documentation

- README, sales pack, sale listing, buyer overview, asset inventory, disclosures, acquisition handoff, handoff rehearsal, release checklist, final sale-readiness record, this manifest and buyer diligence checklist.

## Supabase architecture, migrations and functions

- Transfer only the database schema/migrations, RLS policies, database functions, Edge Function source, scheduled-job definitions and agreed TEST MODE records that the seller actually delivers and lists in the signed asset purchase agreement.
- The GitHub repository is the frontend package; Supabase project ownership, backend source exports and migration artifacts must be separately enumerated at closing. Current production credentials are never part of the source package.

## GitHub workflows

- Pages deployment, premium-page validation, Final Sale Readiness Check and Transferability Check workflows under `.github/workflows/`.

## Artwork and other assets

- Repository icons, SVG/JPG artwork and casino/card-game assets only to the extent the seller owns them or has written, assignable rights.
- Third-party marks, athlete likenesses, league/team branding, fonts, stock assets or other restricted content are excluded unless expressly identified and supported by transferable rights.

## Configuration

- Browser-safe route map, TEST environment marker, Supabase project URL, publishable key and Edge Function slugs.
- Buyer must replace buyer-controlled public configuration after takeover and keep TEST MODE enforced until separately cleared for regulated operation.

## Not automatically transferable

- Supabase organization/project or subscription; GitHub user account; domain/DNS; sports-data-provider accounts, feeds or licenses; email/SMS services; payment accounts; monitoring/analytics accounts; app-store accounts; cloud subscriptions; vendor support agreements; gambling licenses or regulatory approvals.
- Transfer of any account is conditional on provider terms, seller authority and the signed agreement. Otherwise the buyer must create a new account.

## Secrets and credentials to rotate or recreate

- Supabase service-role keys, database passwords, JWT/signing secrets and management tokens.
- Sports-data API keys; scheduled-job/cron secrets; webhook signing secrets; email/SMS credentials; payment credentials; monitoring tokens; GitHub deploy tokens; DNS/registrar credentials; operator/admin credentials.
- No secret should be committed to the repository or delivered through an ordinary document. Use an agreed secure handoff method, then revoke seller access.

## Express exclusions and operating boundary

- No gambling license, real-money authorization, KYC/AML stack, geolocation, regulated payment processing, production security certification, automatic sports-data rights, guaranteed traffic, users, revenue or profitability.
- GameDay transfers as TEST MODE software/IP only. The signed agreement controls the final asset schedule.
