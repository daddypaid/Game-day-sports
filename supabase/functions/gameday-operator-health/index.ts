import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  bounded,
  operatorFailure,
  operatorMethod,
  operatorResponse,
  requireOperator,
} from "../_shared/operator-auth.ts";
import { collectOperatorHealth } from "../_shared/operator-health.ts";
Deno.serve(async (req: Request) => {
  const method = operatorMethod(req);
  if (method) return method;
  try {
    const db = await requireOperator(req),
      health = await collectOperatorHealth(db);
    // This dashboard-only check stays out of the scheduled collector to avoid self-alert loops.
    let monitoring: any = null;
    let status = "degraded",
      detail =
        "Monitoring state read unavailable; no alert-delivery status was inferred.";
    try {
      const { data, error } = await bounded<any>(
        db.rpc("get_operator_alert_health"),
      );
      const keys = [
        "pending_count",
        "dead_count",
        "delivered_count_24h",
        "max_pending_age_seconds",
      ];
      if (
        error || !data || keys.some((key) =>
          !Number.isFinite(data[key]) || data[key] < 0
        ) ||
        keys.slice(0, 3).some((key) => !Number.isSafeInteger(data[key])) ||
        typeof data.delivery_configured !== "boolean" ||
        ["last_monitor_at", "last_delivery_at"].some((key) =>
          data[key] !== null &&
          (typeof data[key] !== "string" ||
            !Number.isFinite(Date.parse(data[key])))
        )
      ) throw new Error("Monitoring unavailable");
      monitoring = Object.fromEntries(
        [...keys, "last_monitor_at", "last_delivery_at", "delivery_configured"]
          .map((key) => [key, data[key]]),
      );
      const stamp = Date.parse(monitoring.last_monitor_at), now = Date.now();
      const recent = Number.isFinite(stamp) && stamp >= now - 900000 &&
        stamp <= now + 60000;
      status = monitoring.delivery_configured && recent &&
          monitoring.dead_count === 0 &&
          monitoring.max_pending_age_seconds <= 900
        ? "healthy"
        : "stale";
      detail = !monitoring.delivery_configured
        ? "Alert delivery is not configured; automatic notification is unavailable."
        : `${monitoring.pending_count} pending alerts; ${monitoring.dead_count} exhausted deliveries. Last monitor ${
          monitoring.last_monitor_at ?? "not yet recorded"
        }; oldest pending ${
          Math.round(monitoring.max_pending_age_seconds)
        } seconds.`;
    } catch {
      /* Return the other measured checks with an explicit unavailable monitor check. */
    }
    health.checks.push({
      key: "monitoring",
      label: "Monitoring and alert delivery",
      status,
      detail,
      measured: true,
    });
    health.overall = health.checks.some((c) => c.status === "degraded")
      ? "degraded"
      : health.checks.some((c) => c.status === "stale")
      ? "attention"
      : "healthy";
    return operatorResponse({ ...health, monitoring });
  } catch (error) {
    return operatorFailure(error);
  }
});
