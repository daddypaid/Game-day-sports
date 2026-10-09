const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const clone = (value) => JSON.parse(JSON.stringify(value));

function load(path, options = {}) {
  const calls = [];
  let seed = 123456789;
  let sequence = [];
  let handler;
  const state = {
    session: null,
    authenticated: true,
    rpcError: null,
    statusError: null,
    ...options,
  };
  const context = vm.createContext({
    console,
    Response,
    Request,
    Error,
    Uint32Array,
    JSON,
    Number,
    Math,
    Set,
    crypto: {
      getRandomValues(array) {
        for (let i = 0; i < array.length; i++) {
          seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
          array[i] = sequence.length ? sequence.shift() : seed;
        }
        return array;
      },
    },
    Deno: {
      env: {
        get(name) {
          return {
            SUPABASE_URL: "https://test.invalid",
            SUPABASE_ANON_KEY: "anon",
            SUPABASE_SERVICE_ROLE_KEY: "service",
          }[name];
        },
      },
      serve(fn) {
        handler = fn;
      },
    },
    createClient(url, key, config) {
      calls.push({
        operation: "client",
        key,
        authorization: config?.global?.headers?.Authorization,
      });
      if (key === "anon")
        return {
          auth: {
            async getUser() {
              calls.push({ operation: "auth" });
              return state.authenticated
                ? { data: { user: { id: "owned-user" } }, error: null }
                : { data: { user: null }, error: new Error("Invalid JWT") };
            },
          },
        };
      return {
        from(table) {
          const filters = [];
          let selection;
          const builder = {
            select(columns) {
              selection = columns;
              return builder;
            },
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            async single() {
              calls.push({ operation: "select", table, selection, filters });
              return {
                data: state.session,
                error: state.session ? null : new Error("Missing session"),
              };
            },
            async maybeSingle() {
              calls.push({ operation: "select", table, selection, filters });
              return {
                data: state.statusError ? null : state.session,
                error: state.statusError ? new Error(state.statusError) : null,
              };
            },
          };
          return builder;
        },
        async rpc(name, args) {
          calls.push({ operation: "rpc", name, args: clone(args) });
          if (state.rpcError)
            return { data: null, error: new Error(state.rpcError) };
          if (name === "play_themed_slot_paid_spin_atomic")
            return {
              data: [
                {
                  spin_id: "spin-id",
                  balance: 401 - args.p_stake + args.p_payout,
                  bonus_session_id: args.p_bonus_spins ? "bonus-id" : null,
                  bonus_spins_remaining: args.p_bonus_spins,
                },
              ],
              error: null,
            };
          assert.equal(name, "settle_themed_bonus_spin_atomic");
          const remaining = state.session.spins_remaining - 1;
          return {
            data: [
              {
                balance: 401 + args.p_payout,
                spins_remaining: remaining,
                session_status: remaining ? "active" : "completed",
                total_payout: state.session.total_payout + args.p_payout,
                bonus_spin_id: "bonus-spin-id",
              },
            ],
            error: null,
          };
        },
      };
    },
  });
  const source = fs.readFileSync(path, "utf8").replace(/^import .*\n/gm, "");
  vm.runInContext(stripTypeScriptTypes(source), context, { filename: path });
  return {
    calls,
    state,
    evaluate(code) {
      return clone(vm.runInContext(code, context));
    },
    setSeed(value) {
      seed = value;
      sequence = [];
    },
    setSequence(values) {
      sequence = [...values];
    },
    async request(body, method = "POST", rawBody) {
      const req = new Request("https://test.invalid/themed-slots-test", {
        method,
        headers: {
          Authorization: "Bearer test-jwt",
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? { body: rawBody ?? JSON.stringify(body) } : {}),
      });
      const response = await handler(req);
      const text = await response.text();
      return {
        status: response.status,
        body: text === "ok" ? text : JSON.parse(text),
      };
    },
  };
}

module.exports = { load };
