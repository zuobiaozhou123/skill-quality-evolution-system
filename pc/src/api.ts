import type {
  AttributionType,
  BadCase,
  Dashboard,
  DeliveryUnitDetail,
  DeliveryUnitPage,
  Evidence,
  SessionSummary,
  SkillSummary,
} from "./types";

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = options.body === undefined
    ? options.headers ?? {}
    : { "Content-Type": "application/json", ...options.headers };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败：${response.status}`);
  return body;
}

export const api = {
  getDashboard: () => request<Dashboard>("/api/dashboard"),
  getSessions: () => request<{ items: SessionSummary[] }>("/api/sessions?limit=60"),
  getDeliveryUnits: (offset = 0, limit = 20) =>
    request<DeliveryUnitPage>(`/api/delivery-units?offset=${offset}&limit=${limit}`),
  getDeliveryUnit: (deliveryRef: string) =>
    request<DeliveryUnitDetail>(`/api/delivery-units/${encodeURIComponent(deliveryRef)}`),
  getSkills: () => request<{ items: SkillSummary[] }>("/api/skills"),
  registerSkill: (id: string) =>
    request<SkillSummary>(`/api/skills/${encodeURIComponent(id)}/register`, { method: "POST" }),
  getBadCases: () => request<{ items: BadCase[] }>("/api/bad-cases"),
  createBadCase: (input: Partial<BadCase> & { title: string }) =>
    request<BadCase>("/api/bad-cases", { method: "POST", body: JSON.stringify(input) }),
  updateBadCase: (id: string, input: Pick<BadCase, "title" | "problem" | "expectedOutcome">) =>
    request<BadCase>(`/api/bad-cases/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  confirmBadCase: (id: string) =>
    request<BadCase>(`/api/bad-cases/${id}/confirm`, { method: "POST" }),
  rejectBadCase: (id: string) =>
    request<BadCase>(`/api/bad-cases/${id}/reject`, { method: "POST" }),
  attributeBadCase: (id: string, attribution: AttributionType, note: string) =>
    request<BadCase>(`/api/bad-cases/${id}/attribute`, {
      method: "POST",
      body: JSON.stringify({ attribution, note }),
    }),
  promoteBadCase: (id: string) =>
    request<BadCase>(`/api/bad-cases/${id}/promote`, { method: "POST" }),
  getEvidence: () => request<{ items: Evidence[] }>("/api/evidence"),
};
