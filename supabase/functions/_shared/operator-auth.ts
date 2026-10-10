import { createClient } from "npm:@supabase/supabase-js@2.117.3";

export const operatorHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
export class OperatorError extends Error {
  constructor(
    message: string,
    public status = 503,
    public code = "UNAVAILABLE",
  ) {
    super(message);
  }
}
export function operatorResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: operatorHeaders,
  });
}
export function operatorFailure(error: unknown) {
  const failure = error instanceof OperatorError
    ? error
    : new OperatorError("Operator data is unavailable. Retry to reconnect.");
  return operatorResponse({
    ok: false,
    error: failure.message,
    code: failure.code,
  }, failure.status);
}
export function operatorMethod(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: operatorHeaders });
  }
  if (!["GET", "POST"].includes(req.method)) {
    return operatorResponse({
      ok: false,
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    }, 405);
  }
  return null;
}
export async function bounded<T>(
  operation: PromiseLike<T>,
  milliseconds = 15000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() =>
          reject(
            new OperatorError("Operator data timed out. Retry to reconnect."),
          ), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function operatorFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const upstreamSignal = init?.signal ??
    (input instanceof Request ? input.signal : undefined);
  upstreamSignal?.addEventListener("abort", abort, { once: true });
  if (upstreamSignal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    // Supabase parses JSON after headers arrive. Keep the transport deadline
    // until that body has arrived as well, then return an independent buffer.
    return await bounded((async () => {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      if (!response.body) return response;
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    })());
  } finally {
    // Also abort a body stalled behind a timed-out SDK promise.
    controller.abort();
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abort);
  }
}
export async function requireOperator(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "")
    ?.[1];
  if (!token || token.length > 8192) {
    throw new OperatorError(
      "Sign in to an operator account.",
      401,
      "AUTH_REQUIRED",
    );
  }
  const url = Deno.env.get("SUPABASE_URL"),
    anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    throw new OperatorError("Operator sign-in verification is unavailable.");
  }
  const options = {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: operatorFetch,
    },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
  };
  const client = createClient(url, anon, options);
  const { data, error } = await bounded(client.auth.getUser(token));
  if (error && ![401, 403].includes(Number(error.status))) {
    throw new OperatorError(
      "Operator sign-in verification is unavailable. Retry to reconnect.",
      503,
      "AUTH_UNAVAILABLE",
    );
  }
  if (error || !data?.user?.id) {
    throw new OperatorError(
      "Your sign-in expired. Sign in to an operator account.",
      401,
      "AUTH_REQUIRED",
    );
  }
  // Fresh Auth user data only. Never trust decoded JWT claims or user_metadata.
  const role = data.user.app_metadata?.role;
  if (role !== "operator" && role !== "admin") {
    throw new OperatorError(
      "Operator access is required for this page.",
      403,
      "OPERATOR_REQUIRED",
    );
  }
  // Construct the privileged client only after the authorization gate succeeds.
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!service) throw new OperatorError("Operator data is unavailable.");
  return createClient(url, service, {
    global: { fetch: operatorFetch },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
  });
}
export async function exactCount(query: PromiseLike<any>): Promise<number> {
  const { count, error } = await bounded(query);
  if (error || !Number.isSafeInteger(count) || count < 0) {
    throw new OperatorError(
      "Operator counts are unavailable. Retry to reconnect.",
    );
  }
  return count;
}
export async function allRows(
  db: any,
  table: string,
  columns: string,
  asOf: string,
  timeColumn = "created_at",
  testOnly = true,
) {
  const rows: any[] = [], pageSize = 500;
  let cursor: string | null = null;
  for (;;) {
    let query = db.from(table).select(columns).lte(timeColumn, asOf).order(
      "id",
      { ascending: true },
    ).limit(pageSize);
    if (testOnly) query = query.eq("is_test", true);
    if (table === "wager_selections") query = query.eq("wagers.is_test", true);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await bounded<any>(query);
    if (error || !Array.isArray(data)) {
      throw new OperatorError(
        "Operator analytics are unavailable. Retry to reconnect.",
      );
    }
    for (const row of data) {
      if (!row || typeof row.id !== "string" || (cursor && row.id <= cursor)) {
        throw new OperatorError(
          "Operator analytics returned an incomplete page.",
        );
      }
      cursor = row.id;
      rows.push(row);
    }
    if (data.length < pageSize) return rows;
    if (rows.length >= 100000) {
      throw new OperatorError(
        "Operator analytics exceed the current reporting limit. No partial totals were returned.",
      );
    }
  }
}
