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
});
