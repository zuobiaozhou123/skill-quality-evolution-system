#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { DurableOutbox, type OutboxEntry } from "./outbox.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:4317/api/captures/record-bad-case";
const DEFAULT_CONTEXT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

type RuntimeMetadata = {
  threadId: string;
  previousCompletedTurnId: string;
};

type BoundRuntimeContext = RuntimeMetadata & {
  boundAt: string;
  expiresAt: string;
};

type ClockOptions = {
  now?: () => Date;
  ttlMs?: number;
};

export type AdapterResult =
  | { status: "delivered" }
  | { status: "queued" }
  | {
      status: "ignored";
      reason:
        | "runtime_context_unavailable"
        | "invalid_failure_reason"
        | "association_failed"
        | "request_rejected"
        | "outbox_unavailable";
    };

export type RecordBadCaseAdapter = {
  recordBadCase(input: { failureReason: string }): Promise<AdapterResult>;
  retryPending(): Promise<{ delivered: number; retained: number }>;
  stop(): void;
};

type AdapterOptions = {
  endpoint?: string;
  contextPath: string;
  outboxPath: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  retryIntervalMs?: number;
  requestTimeoutMs?: number;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

export const RECORD_BAD_CASE_TOOL = {
  name: "record_bad_case",
  description: "记录用户对上一轮 Skill 交付的明确否定、纠错或返工反馈；不返回治理状态。",
  inputSchema: {
    type: "object",
    properties: {
      failureReason: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description: "仅概括用户反馈中明确指出的失败点，不推测期望结果。",
      },
    },
    required: ["failureReason"],
    additionalProperties: false,
  },
} as const;

function validMetadata(value: unknown): value is RuntimeMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<RuntimeMetadata>;
  return Boolean(metadata.threadId?.trim() && metadata.previousCompletedTurnId?.trim());
}

async function atomicWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function bindRuntimeContext(
  filePath: string,
  metadata: RuntimeMetadata,
  options: ClockOptions = {},
): Promise<void> {
  if (!validMetadata(metadata)) throw new Error("threadId and previousCompletedTurnId are required");
  const now = options.now?.() ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_CONTEXT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be positive");
  const context: BoundRuntimeContext = {
    threadId: metadata.threadId.trim(),
    previousCompletedTurnId: metadata.previousCompletedTurnId.trim(),
    boundAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  await atomicWrite(filePath, context);
}

async function consumeRuntimeContext(
  filePath: string,
  now: () => Date,
): Promise<RuntimeMetadata | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }

  try {
    await unlink(filePath);
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BoundRuntimeContext>;
    const boundAtValue = parsed.boundAt;
    const expiresAtValue = parsed.expiresAt;
    if (
      !validMetadata(parsed) ||
      typeof boundAtValue !== "string" ||
      typeof expiresAtValue !== "string"
    ) {
      return null;
    }
    const expiresAt = Date.parse(expiresAtValue);
    const boundAt = Date.parse(boundAtValue);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(boundAt)) return null;
    if (boundAt > now().getTime() || expiresAt < now().getTime()) return null;
    return {
      threadId: parsed.threadId.trim(),
      previousCompletedTurnId: parsed.previousCompletedTurnId.trim(),
    };
  } catch {
    return null;
  }
}

function assertLocalEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (!(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw new Error("record_bad_case endpoint must be localhost");
  }
  return url.toString();
}

export function createRecordBadCaseAdapter(options: AdapterOptions): RecordBadCaseAdapter {
  const now = options.now ?? (() => new Date());
  const endpoint = assertLocalEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const outbox = new DurableOutbox(options.outboxPath, now);
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  async function deliver(entry: OutboxEntry): Promise<AdapterResult> {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveryRef: entry.deliveryRef,
          failureReason: entry.failureReason,
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) {
        await outbox.remove(entry.id);
        return { status: "delivered" };
      }
      if (response.status === 422) {
        await outbox.remove(entry.id);
        return { status: "ignored", reason: "association_failed" };
      }
      if (response.status >= 400 && response.status < 500) {
        await outbox.remove(entry.id);
        return { status: "ignored", reason: "request_rejected" };
      }
      await outbox.markAttempt(entry.id, `HTTP ${response.status}`);
      return { status: "queued" };
    } catch (error) {
      try {
        await outbox.markAttempt(entry.id, error instanceof Error ? error.message : String(error));
      } catch {
        return { status: "ignored", reason: "outbox_unavailable" };
      }
      return { status: "queued" };
    }
  }

  async function recordBadCase(input: { failureReason: string }): Promise<AdapterResult> {
    const failureReason = input.failureReason?.trim();
    if (!failureReason || failureReason.length > 500) {
      return { status: "ignored", reason: "invalid_failure_reason" };
    }
    const metadata = await consumeRuntimeContext(options.contextPath, now);
    if (!metadata) return { status: "ignored", reason: "runtime_context_unavailable" };

    try {
      const entry = await outbox.enqueue({
        deliveryRef: `${metadata.threadId}:${metadata.previousCompletedTurnId}`,
        failureReason,
      });
      return await deliver(entry);
    } catch {
      return { status: "ignored", reason: "outbox_unavailable" };
    }
  }

  async function retryPending(): Promise<{ delivered: number; retained: number }> {
    let delivered = 0;
    let retained = 0;
    let entries: OutboxEntry[];
    try {
      entries = await outbox.list();
    } catch {
      return { delivered: 0, retained: 0 };
    }
    for (const entry of entries) {
      const result = await deliver(entry);
      if (result.status === "queued") retained += 1;
      else delivered += 1;
    }
    return { delivered, retained };
  }

  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const timer = retryIntervalMs > 0 ? setInterval(() => void retryPending(), retryIntervalMs) : null;
  timer?.unref();

  return {
    recordBadCase,
    retryPending,
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}

export function createMcpRequestHandler(adapter: Pick<RecordBadCaseAdapter, "recordBadCase">) {
  return async (request: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    if (request.method === "notifications/initialized") return null;
    const id = request.id ?? null;
    if (request.method === "initialize") {
      const params = request.params as { protocolVersion?: string } | undefined;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "record-bad-case-adapter", version: "0.1.0" },
        },
      };
    }
    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: [RECORD_BAD_CASE_TOOL] } };
    }
    if (request.method === "tools/call") {
      const params = request.params as
        | { name?: string; arguments?: { failureReason?: unknown } }
        | undefined;
      if (params?.name !== RECORD_BAD_CASE_TOOL.name) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } };
      }
      const failureReason =
        typeof params.arguments?.failureReason === "string" ? params.arguments.failureReason : "";
      try {
        await adapter.recordBadCase({ failureReason });
      } catch {
        // Governance capture must never change the production reply.
      }
      return { jsonrpc: "2.0", id, result: { content: [] } };
    }
    if (request.id === undefined) return null;
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  };
}

function runtimePaths() {
  const root = process.env.SKILL_GOVERNANCE_RUNTIME_ROOT?.trim() || path.resolve(".runtime");
  return {
    contextPath:
      process.env.SKILL_GOVERNANCE_CONTEXT_PATH?.trim() ||
      path.join(root, "bad-case-capture-context.json"),
    outboxPath:
      process.env.SKILL_GOVERNANCE_OUTBOX_PATH?.trim() ||
      path.join(root, "bad-case-capture-outbox.json"),
  };
}

async function runMcpServer(): Promise<void> {
  const paths = runtimePaths();
  const adapter = createRecordBadCaseAdapter({
    ...paths,
    endpoint: process.env.SKILL_GOVERNANCE_CAPTURE_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
  });
  const handle = createMcpRequestHandler(adapter);
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  lines.on("line", (line) => {
    void (async () => {
      try {
        const response = await handle(JSON.parse(line) as JsonRpcRequest);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch {
        // Invalid transport input is ignored so it cannot leak into a user answer.
      }
    })();
  });
  await new Promise<void>((resolve) => lines.once("close", resolve));
  adapter.stop();
}

function argumentValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1]?.trim() ?? "") : "";
}

async function runCli(): Promise<void> {
  const [command = "serve", ...args] = process.argv.slice(2);
  if (command === "serve") {
    await runMcpServer();
    return;
  }
  if (command === "bind-context") {
    const threadId = argumentValue(args, "--thread-id");
    const previousCompletedTurnId = argumentValue(args, "--previous-completed-turn-id");
    await bindRuntimeContext(runtimePaths().contextPath, { threadId, previousCompletedTurnId });
    return;
  }
  if (command === "self-check") {
    const paths = runtimePaths();
    process.stdout.write(
      `${JSON.stringify({ endpoint: DEFAULT_ENDPOINT, ...paths, metadataBinding: "explicit" }, null, 2)}\n`,
    );
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
