# GameDay schema and application restore

The repository contains the canonical deployed Edge Function sources and chronological database migration history. The inventories in `scripts/gameday-edge-source-inventory.json` and `scripts/gameday-database-migration-inventory.json` record the captured versions and SHA-256 hashes. Canonical timestamps match the hosted history; exporting these files did not modify that history.

The split-hand columns were originally created outside recorded migration history. The recorded `reconcile_blackjack_split_columns` migration adds those columns without replacing the current insurance-aware RPC. The old DoubleSplit SQL is archived under `supabase/restore/historical-prerequisites` for isolated legacy fixtures and is not an extra deployment migration.

## Rehearse the application database

Requires Node 22, `npm ci`, Docker and a certificate bundle trusted by the build network. The Dockerfile pins PostgreSQL 17.6 by digest and official extension source commits with archive checksums. It compiles real pg_cron v1.6.4 and pg_net v0.20.4. Upstream pg_cron's SQL extension identifies itself as 1.6; the hosted package identifies itself as 1.6.4. The scheduler and network extensions run locally, with no restored jobs or outbound requests.

```sh
docker build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt \
  -t gameday-restore-postgres:17.6 supabase/restore
GAMEDAY_RESTORE_ARTIFACT_DIR=/tmp/gameday-restore-artifacts \
  node scripts/rehearse-gameday-restore.mjs --load
```

In a managed cloud environment use its documented local Docker socket and proxy CA configuration. In CI the system certificate bundle is sufficient unless that runner uses a custom proxy. Keep TLS verification enabled.

The runner starts a disposable container bound to loopback, creates a fresh database, applies the local platform adapter followed by every migration in chronological order, and compares the resulting catalog against the read-only production fingerprint. It checks ownership/RLS and restricted RPC execution with synthetic users. It then populates synthetic wallet/ledger, wager and casino rows, creates a custom-format `pg_dump`, and restores that backup into a second fresh runtime. It verifies the rows, complete application catalog and owner isolation after restoration. `--load` additionally runs the sustained concurrent wallet, sportsbook, slots, poker and durable-retry workload against that restored database.

The runner writes the schema-only baseline, catalog fingerprints, synthetic backup and verification results to the artifact directory, then removes its containers and volumes. The synthetic backup is private to the local rehearsal; it contains no production data. `--keep` retains the isolated containers for further verification. `GAMEDAY_RESTORE_PORT`, `GAMEDAY_RESTORE_CONTAINER` and `GAMEDAY_RESTORE_IMAGE` control only this local runtime. It has no remote connection option.

Do not apply the schema-only baseline on top of the migrations. The baseline is a checkpoint of their final schema. The chronological migration path is the exercised restore path.

## Configure a replacement hosted project

Provision a compatible Supabase project and its managed Auth schemas, roles and extensions. Deploy the chronological application migrations and all functions with the JWT settings in `supabase/config.toml`. Configure the environment variable names listed in `scripts/gameday-required-environment.json` using new destination credentials and the providers' secure configuration controls. The list contains names only; source control never contains their values.

The required settings include the destination Supabase URL/client key/service key, sports-provider credentials, operator alert destination and signing secret. Recreate operator authorization in controlled app metadata. Recreate settlement and monitoring schedules with newly generated job credentials. Verify those schedules and alert delivery in the destination; existing scheduler commands, authorization headers and secret rows are intentionally not exported.

Update the frontend's destination API configuration and verify authentication, owner isolation, provider access, settlement, receipts and alert delivery before routing traffic.

## Limits of this rehearsal

This proves restoration of application schema, RPCs, policies, ACLs, triggers, indexes and source/configuration coverage on real PostgreSQL. The local `auth.users` adapter supports synthetic trigger/RLS tests; it does not implement GoTrue authentication or restore managed Supabase Auth internals.

No private customer rows, Auth identities/sessions, stored credentials, cron commands, storage objects or provider accounts are exported. A full disaster recovery plan additionally requires separately secured data backups, Auth/platform backups, storage object copies, destination secret provisioning, external provider access, DNS and scheduled-job configuration. Those private-data and hosted-service restore steps were not rehearsed here.
