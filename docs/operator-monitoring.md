# Operator monitoring

`gameday-operator-monitor` collects the same measured checks as the protected health dashboard every five minutes. It records health transitions in a durable outbox. Reads, stored-data freshness, grading backlog and query failures are measured; payment readiness, licensing and external provider availability are not inferred from a database read.

The monitor uses a dedicated opaque job token, not a customer JWT. Deploy with `verify_jwt = false` and all three shared files: `operator-health.ts`, `operator-auth.ts`, `operator-alerts.ts`. The customer-facing operator APIs separately require a server-controlled operator role. Job secrets, delivery configuration and the outbox are RLS enabled and inaccessible to browser roles.

Set either both Edge Function secrets `GAMEDAY_OPERATOR_ALERT_WEBHOOK_URL` and `GAMEDAY_OPERATOR_ALERT_SIGNING_SECRET`, or configure the service-only database fallback with `configure_operator_alert_delivery(url, signing_secret)`. Partial or invalid environment configuration does not fall back silently. The signing secret must contain at least 32 characters; generate it securely and share it only with the receiver operator. The destination must be an operator-provided HTTPS URL. Local HTTP is accepted only by the explicitly injected test fixture. Credentials in the URL, fragments, local/private host literals and redirects are rejected. The response body and URL are never recorded in the outbox.

A receiver must validate `x-gameday-signature`, `x-gameday-sent-at`, and `x-gameday-alert-id`. The signature is `v1=` followed by the lowercase hexadecimal HMAC-SHA256 of `sent_at + '.' + exact_request_body`, using the configured signing secret. Reject old timestamps, deduplicate using the alert UUID, and retain the largest `transition_sequence` for each check key before notifying a person. A late retry with a smaller sequence should receive an acknowledgement without reverting the receiver's current state or issuing an obsolete notification. Delivery is at least once: an interrupted acknowledgement can retry an already accepted request with the same UUID. The JSON payload contains the UUID, check key, incident number, transition sequence, transition, measured status, aggregate detail and observation timestamp. It includes no customer identifiers or private records.

Apply both the outbox migration and the additive transition-sequence repair, then deploy the function before scheduling it. The repair preserves existing alert UUIDs and adds a monotonic sequence for each measured check. Create or replace the cron job from a trusted database administration session, using the public project URL and a scalar query for the dedicated job secret. Do not paste the secret into a cron command or commit it:

```sql
select cron.schedule(
  'gameday-operator-monitor',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/gameday-operator-monitor',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-gameday-job-token',(select secret from public.operator_monitor_job_secret where singleton)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
```

Check `get_operator_alert_health()` and recent cron/HTTP status after deployment. Missing destination configuration must remain visible as a monitoring warning; it does not prove delivery. A real receiver acknowledgement is still required to verify hosted end-to-end notification delivery.

Retries use exclusive three-minute leases, begin after 15 seconds and back off to one hour. Five concurrent delivery workers process up to twenty alerts in four waves with a four-second HTTP deadline. Database SDK operations have a fifteen-second deadline, and the full invocation aborts at ninety seconds, below the cron request's two-minute limit. Unfinished leases remain durable and can be reclaimed. A check's recovery notification waits for its earlier pending alert. After eight attempts, a failed alert moves to the dead-letter state and appears in monitoring health. A worker that exits during its final attempt also becomes a dead letter when the lease expires. After fixing the destination, a trusted service session can call `retry_operator_alert(alert_id)`, preserving the UUID for receiver deduplication. Never clear failed deliveries to manufacture a healthy status.

Verification:

```sh
node --test tests/operator-alerts.test.cjs tests/operator-apis.test.cjs
node scripts/check-gameday-handoff.mjs --mode all
# Explicit local PostgreSQL regression; creates and drops its own disposable database.
GAMEDAY_POSTGRES_CONTAINER=gameday-capacity-postgres node tests/operator-alerts-postgres.cjs
```

The alert regression uses actual loopback HTTP requests and checks HMAC validation, retry, acknowledgement interruption, receiver deduplication and sequence fencing, deadlines, redirect rejection, leases, dead letters, role restrictions and missing configuration. The separate PostgreSQL regression verifies transition retention, causal ordering and preservation of existing alert identities on the real database engine. Local success validates the implementation; it is not evidence that an unconfigured hosted destination has received a notification.
