import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECORD_BAD_CASE_TOOL,
  bindRuntimeContext,
  createMcpRequestHandler,
  createRecordBadCaseAdapter,
} from "./index.js";
import { DurableOutbox } from "./outbox.js";

const fixedNow = new Date("2026-08-22T08:00:00.000Z");
const adapters: Array<{ stop(): void }> = [];

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.stop();
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "bad-case-adapter-"));
  return {
    root,
    contextPath: path.join(root, "context.json"),
    outboxPath: path.join(root, "outbox.json"),
  };
}

describe("record_bad_case adapter", () => {
  it("preserves every event when outbox writes overlap", async () => {
    const files = await fixture();
    const outbox = new DurableOutbox(files.outboxPath, () => fixedNow);
    const references = Array.from({ length: 12 }, (_, index) => `thread-${index}:turn-${index}`);

    await Promise.all(
      references.map((deliveryRef) => outbox.enqueue({ deliveryRef, failureReason: "并发写入" })),
    );

    expect((await outbox.list()).map((entry) => entry.deliveryRef).sort()).toEqual(
      references.sort(),
    );
  });

  it("fails closed without bound thread and previous completed turn metadata", async () => {
    const files = await fixture();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createRecordBadCaseAdapter({
      contextPath: files.contextPath,
      outboxPath: files.outboxPath,
      fetch,
      now: () => fixedNow,
      retryIntervalMs: 0,
    });
    adapters.push(adapter);

    await expect(adapter.recordBadCase({ failureReason: "结果中的公式错误" })).resolves.toEqual({
      status: "ignored",
      reason: "runtime_context_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(new DurableOutbox(files.outboxPath).list()).resolves.toEqual([]);
  });

  it("binds trusted metadata, persists before delivery, and never sends transcript content", async () => {
    const files = await fixture();
    await bindRuntimeContext(
      files.contextPath,
      { threadId: "thread-123", previousCompletedTurnId: "turn-456" },
      { now: () => fixedNow, ttlMs: 60_000 },
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const persisted = JSON.parse(await readFile(files.outboxPath, "utf8"));
      expect(persisted.items).toHaveLength(1);
      expect(persisted.items[0]).toMatchObject({
        deliveryRef: "thread-123:turn-456",
        failureReason: "结果中的公式错误",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        deliveryRef: "thread-123:turn-456",
        failureReason: "结果中的公式错误",
      });
      return new Response(
        JSON.stringify({ status: "captured", created: true, deliveryRef: "thread-123:turn-456" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = createRecordBadCaseAdapter({
      contextPath: files.contextPath,
      outboxPath: files.outboxPath,
      fetch,
      now: () => fixedNow,
      retryIntervalMs: 0,
    });
    adapters.push(adapter);

    await expect(adapter.recordBadCase({ failureReason: "  结果中的公式错误  " })).resolves.toEqual({
      status: "delivered",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(new DurableOutbox(files.outboxPath).list()).resolves.toEqual([]);
  });

  it("queues transport failures without throwing and retries the same idempotent reference", async () => {
    const files = await fixture();
    await bindRuntimeContext(
      files.contextPath,
      { threadId: "thread-retry", previousCompletedTurnId: "turn-retry" },
      { now: () => fixedNow, ttlMs: 60_000 },
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "duplicate", created: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const adapter = createRecordBadCaseAdapter({
      contextPath: files.contextPath,
      outboxPath: files.outboxPath,
      fetch,
      now: () => fixedNow,
      retryIntervalMs: 0,
    });
    adapters.push(adapter);

    await expect(adapter.recordBadCase({ failureReason: "需要返工" })).resolves.toEqual({
      status: "queued",
    });
    await expect(new DurableOutbox(files.outboxPath).list()).resolves.toMatchObject([
      { deliveryRef: "thread-retry:turn-retry", attempts: 1 },
    ]);

    await expect(adapter.retryPending()).resolves.toEqual({ delivered: 1, retained: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { deliveryRef: "thread-retry:turn-retry", failureReason: "需要返工" },
      { deliveryRef: "thread-retry:turn-retry", failureReason: "需要返工" },
    ]);
    await expect(new DurableOutbox(files.outboxPath).list()).resolves.toEqual([]);
  });

  it("drops a non-retryable association failure and consumes metadata only once", async () => {
    const files = await fixture();
    await bindRuntimeContext(
      files.contextPath,
      { threadId: "thread-invalid", previousCompletedTurnId: "turn-invalid" },
      { now: () => fixedNow, ttlMs: 60_000 },
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "association_failed" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const adapter = createRecordBadCaseAdapter({
      contextPath: files.contextPath,
      outboxPath: files.outboxPath,
      fetch,
      now: () => fixedNow,
      retryIntervalMs: 0,
    });
    adapters.push(adapter);

    await expect(adapter.recordBadCase({ failureReason: "引用错误" })).resolves.toEqual({
      status: "ignored",
      reason: "association_failed",
    });
    await expect(adapter.recordBadCase({ failureReason: "不能复用旧引用" })).resolves.toEqual({
      status: "ignored",
      reason: "runtime_context_unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(new DurableOutbox(files.outboxPath).list()).resolves.toEqual([]);
  });

  it("rejects stale or malformed bridge metadata without guessing", async () => {
    const files = await fixture();
    await bindRuntimeContext(
      files.contextPath,
      { threadId: "thread-stale", previousCompletedTurnId: "turn-stale" },
      { now: () => new Date("2026-08-22T07:00:00.000Z"), ttlMs: 60_000 },
    );
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createRecordBadCaseAdapter({
      contextPath: files.contextPath,
      outboxPath: files.outboxPath,
      fetch,
      now: () => fixedNow,
      retryIntervalMs: 0,
    });
    adapters.push(adapter);

    await expect(adapter.recordBadCase({ failureReason: "不能猜上一轮" })).resolves.toEqual({
      status: "ignored",
      reason: "runtime_context_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("MCP boundary", () => {
  it("exposes only the concise failure reason and keeps every tool result silent", async () => {
    expect(RECORD_BAD_CASE_TOOL).toMatchObject({
      name: "record_bad_case",
      inputSchema: {
        type: "object",
        required: ["failureReason"],
        additionalProperties: false,
        properties: { failureReason: { type: "string", minLength: 1 } },
      },
    });
    expect(JSON.stringify(RECORD_BAD_CASE_TOOL)).not.toContain("deliveryRef");
    expect(JSON.stringify(RECORD_BAD_CASE_TOOL)).not.toContain("threadId");

    const recordBadCase = vi.fn().mockResolvedValue({ status: "queued" });
    const handle = createMcpRequestHandler({ recordBadCase });
    const response = await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "record_bad_case", arguments: { failureReason: "输出遗漏关键结论" } },
    });

    expect(recordBadCase).toHaveBeenCalledWith({ failureReason: "输出遗漏关键结论" });
    expect(response).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [] } });
  });

  it("keeps the reviewed AGENTS prompt compact and free of transport fields", async () => {
    const document = await readFile(
      path.resolve(import.meta.dirname, "../../integration/AGENTS.bad-case-capture.md"),
      "utf8",
    );
    const prompt = document.match(/<!-- prompt:start -->([\s\S]*?)<!-- prompt:end -->/)?.[1].trim();

    expect(prompt).toBeTruthy();
    expect([...prompt!].length).toBeLessThanOrEqual(120);
    expect(prompt).toContain("上一轮实际调用 Skill");
    expect(prompt).toContain("静默调用 record_bad_case");
    expect(prompt).toContain("不输出治理状态");
    expect(prompt).not.toMatch(/deliveryRef|threadId|turnId|字段|JSON/);
  });
});
