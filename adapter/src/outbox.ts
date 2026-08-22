import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type OutboxEntry = {
  id: string;
  deliveryRef: string;
  failureReason: string;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
};

type OutboxState = {
  version: 1;
  items: OutboxEntry[];
};

const EMPTY_STATE: OutboxState = { version: 1, items: [] };

function isEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<OutboxEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.deliveryRef === "string" &&
    typeof entry.failureReason === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.attempts === "number" &&
    (entry.lastAttemptAt === null || typeof entry.lastAttemptAt === "string") &&
    (entry.lastError === null || typeof entry.lastError === "string")
  );
}

export class DurableOutbox {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<OutboxEntry[]> {
    return this.serial(async () => (await this.read()).items.map((item) => ({ ...item })));
  }

  async enqueue(input: { deliveryRef: string; failureReason: string }): Promise<OutboxEntry> {
    return this.serial(async () => {
      const state = await this.read();
      const existing = state.items.find((item) => item.deliveryRef === input.deliveryRef);
      if (existing) return { ...existing };

      const entry: OutboxEntry = {
        id: randomUUID(),
        deliveryRef: input.deliveryRef,
        failureReason: input.failureReason,
        createdAt: this.now().toISOString(),
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      };
      state.items.push(entry);
      await this.write(state);
      return { ...entry };
    });
  }

  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.read();
      const items = state.items.filter((item) => item.id !== id);
      if (items.length === state.items.length) return;
      await this.write({ version: 1, items });
    });
  }

  async markAttempt(id: string, error: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.read();
      const entry = state.items.find((item) => item.id === id);
      if (!entry) return;
      entry.attempts += 1;
      entry.lastAttemptAt = this.now().toISOString();
      entry.lastError = error.slice(0, 500);
      await this.write(state);
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<OutboxState> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<OutboxState>;
      if (parsed.version !== 1 || !Array.isArray(parsed.items) || !parsed.items.every(isEntry)) {
        throw new Error("Invalid outbox format");
      }
      return { version: 1, items: parsed.items.map((item) => ({ ...item })) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_STATE, items: [] };
      throw error;
    }
  }

  private async write(state: OutboxState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
