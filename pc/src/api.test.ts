import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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
});
