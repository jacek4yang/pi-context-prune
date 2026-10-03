import assert from "node:assert/strict";
import { test, after } from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(join(root, ".boundary-test-"));
const agent = mkdtempSync(join(tmpdir(), "pruner-boundary-"));
const settings = join(agent, "context-prune", "settings.json");
mkdirSync(join(agent, "context-prune"));
const out = join(dir, "index.mjs");
await build({
  entryPoints: [join(root, "index.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "isolated-settings",
      setup(build) {
        build.onLoad({ filter: /src\/config\.ts$/ }, async ({ path }) => ({
          contents: readFileSync(path, "utf8").replace(
            "join(getAgentDir(),",
            "join(" + JSON.stringify(agent) + ",",
          ),
          loader: "ts",
        }));
      },
    },
  ],
});
const { default: extension } = await import(pathToFileURL(out).href);
const guardOut = join(dir, "guard.mjs");
await build({
  entryPoints: [join(root, "src/retry-guard.ts")],
  outfile: guardOut,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { PruneRetryGuard } = await import(pathToFileURL(guardOut).href);
after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(agent, { recursive: true, force: true });
});
const identity = {
  provider: "openai-codex",
  api: "openai-codex-responses",
  id: "gpt-6-astra",
  baseUrl: "https://example.test/codex",
};
const assistant = (content) => ({
  role: "assistant",
  content,
  ...identity,
  model: identity.id,
  stopReason: "stop",
  timestamp: Date.now(),
  usage: {
    input: 10,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 11,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
function addWork(sm, id) {
  sm.appendMessage({
    role: "user",
    content: "work " + id,
    timestamp: Date.now(),
  });
  sm.appendMessage(
    assistant([
      { type: "toolCall", id, name: "read", arguments: { path: id } },
    ]),
  );
  sm.appendMessage({
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [
      { type: "text", text: "VALUE_" + id + " " + "large output ".repeat(200) },
    ],
    isError: false,
    timestamp: Date.now(),
  });
}
function compact(sm, generation) {
  const id = sm.appendCompaction(
    "[opaque native state]",
    sm.getLeafId(),
    10000,
    {
      strategy: "codex-remote-compaction-v2",
      schema: 1,
      generation,
      identity: {
        provider: identity.provider,
        api: identity.api,
        model: identity.id,
        endpoint: identity.baseUrl,
      },
      encrypted: "opaque-test-" + generation,
    },
  );
  const cp = sm.getEntries().find((e) => e.id === id);
  // Native extension's existing persisted convention: self-kept boundary.
  cp.firstKeptEntryId = id;
  return cp;
}
async function harness(sm = SessionManager.inMemory(), mode = "agentic-auto") {
  writeFileSync(
    settings,
    JSON.stringify({
      enabled: true,
      pruneOn: mode,
      summarizerModel: "openai-codex/gpt-6-luna",
      notifySkipped: false,
    }),
  );
  const handlers = new Map(),
    tools = new Map(),
    requests = [],
    notifications = [];
  let fail, during, oversized;
  const ctx = {
    sessionManager: sm,
    hasUI: false,
    model: { ...identity },
    ui: {
      setStatus() {},
      notify(text) {
        notifications.push(text);
      },
    },
    modelRegistry: {
      find(provider, id) {
        return { ...identity, provider, id };
      },
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "test" };
      },
      getProvider() {
        return {
          stream(model, context, options) {
            requests.push({ model, context, options });
            const final = () =>
              assistant([
                {
                  type: "text",
                  text: [
                    ...new Set(
                      JSON.stringify(context).match(/VALUE_[A-Za-z0-9_-]+/g) ??
                        [],
                    ),
                  ].join(" "),
                },
              ]);
            return {
              result: async () => final(),
              async *[Symbol.asyncIterator]() {
                if (during) await during();
                if (fail) throw new Error(fail);
                if (oversized) yield {type:"text_delta",partial:assistant([{type:"text",text:"runaway".repeat(1000)}])};
                const values =
                  JSON.stringify(context).match(/VALUE_[A-Za-z0-9_-]+/g) ?? [];
                yield {
                  type: "done",
                  message: assistant([
                    { type: "text", text: [...new Set(values)].join(" ") },
                  ]),
                };
              },
            };
          },
        };
      },
    },
  };
  const pi = {
    getActiveTools() {
      return [...tools.keys()];
    },
    setActiveTools() {},
    registerCommand() {},
    registerMessageRenderer() {},
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    on(event, fn) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
    },
    appendEntry(type, data) {
      return sm.appendCustomEntry(type, data);
    },
    sendMessage(message) {
      sm.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details,
      );
    },
  };
  extension(pi);
  async function emit(event, payload = {}) {
    let result;
    for (const fn of handlers.get(event) ?? []) {
      const next = await fn(payload, ctx);
      if (next !== undefined) {
        result = next;
        payload = { ...payload, ...next };
      }
    }
    return result;
  }
  await emit("session_start");
  return {
    sm,
    ctx,
    pi,
    requests,
    notifications,
    emit,
    setFailure(error) {
      fail = error;
    },
    setDuring(fn) {
      during = fn;
    },
    setOversized() { oversized = true; },
    async prune(signal) {
      return (
        await tools
          .get("context_prune")
          .execute("prune", {}, signal, undefined, ctx)
      ).details;
    },
    frontier() {
      return sm
        .getBranch()
        .filter(
          (e) =>
            e.type === "custom" && e.customType === "context-prune-frontier",
        )
        .at(-1)?.data;
    },
    summaries() {
      return sm
        .getBranch()
        .filter(
          (e) =>
            e.type === "custom_message" &&
            e.customType === "context-prune-summary",
        );
    },
  };
}

test("stream budget never commits a partial summary or repeats the attempted range", async () => {
  const h = await harness(); addWork(h.sm,"budget"); h.setOversized();
  assert.equal((await h.prune()).reason,"skipped-oversized");
  assert.equal(h.summaries().length,0);
  assert.equal(h.frontier().outcome,"skipped-oversized");
  assert(h.requests[0].options.signal.aborted);
  assert.equal((await h.prune()).reason,"empty");
  assert.equal(h.requests.length,1);
  assert(JSON.stringify(h.sm.getBranch()).includes("VALUE_budget"));
});

test("retry clock is bounded, transient failures recover, deterministic failures await changed state", () => {
  const guard = new PruneRetryGuard();
  guard.fail("range", new Error("temporary"), 100);
  assert.equal(guard.blocked("range", 60_099), true);
  assert.equal(guard.blocked("range", 60_100), false);
  guard.fail(
    "range",
    new Error("Checkpoint provider/API/model/endpoint mismatch"),
    100,
  );
  assert.equal(guard.blocked("range", 1e15), true);
  assert.equal(guard.blocked("changed", 101), false);
  guard.reset();
  assert.equal(guard.blocked("range", 101), false);
});

test("actual extension: Luna before checkpoint, opaque boundary, no work, next frontier, reload", async () => {
  let h = await harness();
  addWork(h.sm, "before");
  assert.equal((await h.prune()).ok, true);
  const cp = compact(h.sm, 1),
    original = JSON.stringify(cp);
  const count = h.requests.length;
  assert.equal((await h.prune()).reason, "empty");
  assert.equal(h.requests.length, count);
  addWork(h.sm, "after1");
  assert.equal((await h.prune()).ok, true);
  const req = h.requests.at(-1);
  assert.equal(req.model.id, "gpt-6-luna");
  assert(!JSON.stringify(req.context).includes("VALUE_before"));
  assert(!JSON.stringify(req.context).includes("opaque-test"));
  assert.equal(req.options.sessionId, undefined);
  assert.equal(req.options.previous_response_id, undefined);
  assert.equal(JSON.stringify(cp), original);
  assert.equal((await h.prune()).reason, "empty");
  addWork(h.sm, "after2");
  assert.equal((await h.prune()).ok, true);
  const frontier = h.frontier();
  assert(frontier.lastAttemptedTurnIndex > 0);
  await h.emit("session_tree");
  assert.equal((await h.prune()).reason, "empty");
  assert.deepEqual(h.frontier(), frontier);
});

test("long session: 24 native boundaries, 72 prune cycles; reload/fork, bounded active context", async () => {
  const sm = SessionManager.inMemory();
  let h = await harness(sm),
    lastTurn = -1,
    totalRequests = 0;
  for (let generation = 1; generation <= 24; generation++) {
    addWork(sm, "covered-" + generation);
    const cp = compact(sm, generation),
      original = JSON.stringify(cp);
    assert.equal((await h.prune()).reason, "empty");
    for (let turn = 0; turn < 3; turn++) {
      const id = generation + "-" + turn;
      addWork(sm, id);
      assert.equal((await h.prune()).ok, true);
      const request = h.requests.at(-1);
      assert(JSON.stringify(request.context).includes("VALUE_" + id));
      assert(!JSON.stringify(request.context).includes("VALUE_covered"));
      assert.equal(h.frontier().lastAttemptedToolCallId, id);
      assert(h.frontier().lastAttemptedTurnIndex > lastTurn);
      lastTurn = h.frontier().lastAttemptedTurnIndex;
      const active = sm.buildSessionContext().messages;
      const pruned = await h.emit("context", { messages: active });
      assert(pruned.messages.length <= 12);
      assert(!pruned.messages.some((m) => m.role === "toolResult"));
      assert.equal((await h.prune()).reason, "empty");
      assert.equal(JSON.stringify(cp), original);
    }
    totalRequests += h.requests.length;
    // Hydrate a new extension instance from the same persisted branch.
    h = await harness(sm);
    assert.equal((await h.prune()).reason, "empty");
  }
  assert.equal(totalRequests, 72);
  const summaries = h.summaries();
  assert.equal(summaries.length, 72);
  const bodies = summaries.map((e) => e.content);
  assert.equal(new Set(bodies).size, 72);
  const rawResults = sm
    .getEntries()
    .filter((e) => e.type === "message" && e.message.role === "toolResult");
  assert.equal(rawResults.length, 96, "raw recoverable history is untouched");
  // Fork to an older checkpoint: no obsolete later frontier or summary resurrected.
  const old = sm.getBranch().filter((e) => e.type === "compaction")[10];
  sm.branch(old.id);
  await h.emit("session_tree");
  assert.equal((await h.prune()).reason, "empty");
  addWork(sm, "fork-new");
  assert.equal((await h.prune()).ok, true);
  assert.equal(h.requests.length, 1);
});

test("deterministic failures are not retried until state changes; context remains intact", async () => {
  const h = await harness();
  compact(h.sm, 1);
  addWork(h.sm, "failing");
  h.setFailure("Checkpoint provider/API/model/endpoint mismatch");
  assert.equal((await h.prune()).reason, "summarizer-failed");
  for (let i = 0; i < 30; i++)
    assert.equal((await h.prune()).reason, "retry-suppressed");
  assert.equal(h.requests.length, 1);
  assert.equal(h.frontier(), undefined);
  assert.equal(h.summaries().length, 0);
  h.setFailure(undefined);
  h.ctx.model = { ...identity, baseUrl: "https://new.test" };
  assert.equal((await h.prune()).ok, true);
  assert.equal(h.requests.length, 2);
});

test("transient failure, cancellation, and compaction during summarization never commit stale work", async () => {
  const h = await harness();
  addWork(h.sm, "network");
  h.setFailure("temporary network failure");
  assert.equal((await h.prune()).ok, false);
  assert.equal((await h.prune()).reason, "retry-suppressed");
  h.setFailure(undefined);
  await h.emit("session_tree"); // explicit reload permits a repaired retry
  const abort = new AbortController();
  h.setDuring(() => abort.abort());
  assert.equal((await h.prune(abort.signal)).reason, "aborted");
  assert.equal(h.summaries().length, 0);
  assert.equal(h.frontier(), undefined);
  h.setDuring(() => {
    compact(h.sm, 1);
  });
  assert.equal((await h.prune()).reason, "stale-context");
  assert.equal(h.summaries().length, 0);
  h.setDuring(undefined);
  assert.equal((await h.prune()).reason, "empty");
  addWork(h.sm, "fresh");
  assert.equal((await h.prune()).ok, true);
});

test("disk resume and copied legacy V2 session preserve boundary/frontier and original ciphertext", async () => {
  const sessionDir = join(agent, "sessions");
  mkdirSync(sessionDir);
  const sm = SessionManager.create(agent, sessionDir);
  addWork(sm, "before-disk");
  const cp = compact(sm, 1);
  // Emulate an existing serialized V2 record, including self-kept firstKeptEntryId.
  const file = sm.getSessionFile();
  const lines = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  lines.find((e) => e.id === cp.id).firstKeptEntryId = cp.id;
  writeFileSync(file, lines.map((e) => JSON.stringify(e)).join("\n") + "\n");
  let h = await harness(SessionManager.open(file, sessionDir));
  assert.equal((await h.prune()).reason, "empty");
  addWork(h.sm, "disk-new");
  assert.equal((await h.prune()).ok, true);
  const frontier = h.frontier();
  const copied = join(sessionDir, "copied.jsonl");
  copyFileSync(file, copied);
  h = await harness(SessionManager.open(copied, sessionDir));
  assert.deepEqual(h.frontier(), frontier);
  assert.equal((await h.prune()).reason, "empty");
  assert.equal(
    h.sm.getBranch().find((e) => e.id === cp.id).details.encrypted,
    "opaque-test-1",
  );
  addWork(h.sm, "copy-new");
  assert.equal((await h.prune()).ok, true);
  assert(!readFileSync(file, "utf8").includes("copy-new"));
  assert.equal(h.requests.length, 1);
});

test("failed index persistence cannot remove raw tools from active context", async () => {
  const h = await harness();
  addWork(h.sm, "persist");
  const append = h.pi.appendEntry;
  h.pi.appendEntry = (type, data) => {
    if (type === "context-prune-index") throw new Error("disk full");
    return append(type, data);
  };
  assert.equal((await h.prune()).ok, false);
  const context = await h.emit("context", {
    messages: h.sm.buildSessionContext().messages,
  });
  assert.equal(context, undefined, "no raw tool removal without durable index");
  assert.equal(h.frontier(), undefined);
});

test("session delivery also handles durable index failure before advancing frontier", async () => {
  const h = await harness(undefined, "every-turn");
  h.ctx.hasUI = true;
  addWork(h.sm, "session-persist");
  const append = h.sm.appendCustomEntry.bind(h.sm);
  h.sm.appendCustomEntry = (type, data) => {
    if (type === "context-prune-index") throw new Error("disk full");
    return append(type, data);
  };
  const messages = h.sm
    .getBranch()
    .filter((e) => e.type === "message")
    .map((e) => e.message);
  await h.emit("turn_end", {
    message: messages.findLast((m) => m.role === "assistant"),
    toolResults: [messages.at(-1)],
    turnIndex: 0,
  });
  assert.equal(h.requests.length, 1);
  assert.equal(h.frontier(), undefined);
  assert.equal(
    await h.emit("context", { messages: h.sm.buildSessionContext().messages }),
    undefined,
  );
  assert(h.notifications.some((n) => n.includes("disk full")));
});

test("text compaction retains eligible kept tail; automatic pruning respects same boundary", async () => {
  const h = await harness(undefined, "every-turn");
  addWork(h.sm, "covered");
  const kept = h.sm.appendMessage({
    role: "user",
    content: "retained",
    timestamp: Date.now(),
  });
  addWork(h.sm, "kept-tail");
  h.sm.appendCompaction("ordinary text summary", kept, 10000);
  const messages = h.sm
    .getBranch()
    .filter((e) => e.type === "message")
    .map((e) => e.message);
  const turn = {
    message: messages.findLast((m) => m.role === "assistant"),
    toolResults: [messages.at(-1)],
    turnIndex: 1,
  };
  await h.emit("turn_end", turn);
  assert.equal(h.requests.length, 1);
  assert(JSON.stringify(h.requests[0].context).includes("VALUE_kept-tail"));
  assert(!JSON.stringify(h.requests[0].context).includes("VALUE_covered"));
  await h.emit("turn_end");
  assert.equal(h.requests.length, 1);
});
