import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiRequestError } from "../src/lib/api";

function client(fetchImpl: typeof fetch, token: string | null = "tok-123", onUnauthorized = vi.fn()) {
  return { api: new ApiClient({ baseUrl: "https://ringapeldoorn.nl/api/mobile/v1", getToken: () => token, fetchImpl, onUnauthorized }), onUnauthorized };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ApiClient", () => {
  it("stuurt het token alleen in de Authorization-header en nooit in de URL", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const { api } = client(fetchImpl as unknown as typeof fetch);
    await api.calling("abc/def");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ringapeldoorn.nl/api/mobile/v1/callings/abc%2Fdef");
    expect(url).not.toContain("tok-123");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });
  it("stuurt bij login en open-link geen token mee", async () => {
    const fetchImpl = vi.fn(async () => json({ valid: true }));
    const { api } = client(fetchImpl as unknown as typeof fetch);
    await api.openLink("t".repeat(20));
    await api.requestCode("a@b.nl");
    for (const call of fetchImpl.mock.calls) expect(((call[1] as RequestInit).headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it("meldt 401 als sessie verlopen en geeft de servertekst door", async () => {
    const { api, onUnauthorized } = client((async () => json({ error: "Je sessie is verlopen.", code: "unauthenticated" }, 401)) as unknown as typeof fetch);
    await expect(api.me()).rejects.toMatchObject({ status: 401, message: "Je sessie is verlopen.", code: "unauthenticated" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
  it("401 zonder token (bijv. foute inlogcode) triggert geen uitlog", async () => {
    const { api, onUnauthorized } = client((async () => json({ error: "Onjuist", code: "invalid-code" }, 401)) as unknown as typeof fetch, null);
    await expect(api.login("a@b.nl", "12345678", "iPhone")).rejects.toBeInstanceOf(ApiRequestError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it("vertaalt netwerkfouten naar een duidelijke offline-fout", async () => {
    const { api } = client((async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch);
    const err = await api.me().catch((e) => e as ApiRequestError);
    expect(err.isNetwork).toBe(true);
    expect(err.message).toMatch(/Geen verbinding/);
  });
});
