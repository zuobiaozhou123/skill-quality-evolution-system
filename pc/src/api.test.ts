import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns typed JSON from the local service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: "s1" }] }),
    }));

    await expect(api.getSessions()).resolves.toEqual({ items: [{ id: "s1" }] });
    expect(fetch).toHaveBeenCalledWith("/api/sessions?limit=60", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("surfaces the server error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "请先补充问题描述和期望结果" }),
    }));

    await expect(api.confirmBadCase("case-1")).rejects.toThrow("请先补充问题描述和期望结果");
  });

  it("does not send a JSON content type for POST requests without a body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "case-1" }),
    }));

    await api.confirmBadCase("case-1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/bad-cases/case-1/confirm",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
  });

  it("loads paginated delivery summaries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], pagination: { offset: 20, limit: 20, hasMore: false } }),
    }));

    await api.getDeliveryUnits(20, 20);

    expect(fetch).toHaveBeenCalledWith(
      "/api/delivery-units?offset=20&limit=20",
      expect.any(Object),
    );
  });

  it("encodes the delivery reference when loading full context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deliveryRef: "thread 1:turn/2" }),
    }));

    await api.getDeliveryUnit("thread 1:turn/2");

    expect(fetch).toHaveBeenCalledWith(
      "/api/delivery-units/thread%201%3Aturn%2F2",
      expect.any(Object),
    );
  });

  it("encodes the delivery reference when loading the session timeline", async () => {
    const context = {
      deliveryRef: "thread 1:turn/2",
      threadId: "thread 1",
      triggerTurnId: "turn/2",
      feedbackTurnId: null,
      feedback: null,
      sourcePath: "/sessions/example.jsonl",
      turns: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => context,
    }));

    await expect(api.getSessionContext("thread 1:turn/2")).resolves.toEqual(context);
    expect(fetch).toHaveBeenCalledWith(
      "/api/delivery-units/thread%201%3Aturn%2F2/session-context",
      expect.any(Object),
    );
  });

  it("preserves a stable context error code for the UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Session 源文件不可用", code: "source_unavailable" }),
    }));

    const error = await api.getSessionContext("thread:turn").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "Session 源文件不可用",
      code: "source_unavailable",
      status: 503,
    });
  });
});
