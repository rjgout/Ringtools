import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiRequestError } from "@/lib/api";

function client(responses: { status: number; body?: unknown }[], token: string | null = "tok-abcdefghijklmnopqrstuvwxyz") {
  const calls: { url: string; init: RequestInit }[] = [];
  const onUnauthorized = vi.fn();
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { api: new ApiClient({ baseUrl: "https://ringtools.example.nl", getToken: () => token, onUnauthorized, fetchImpl }), calls, onUnauthorized };
}

describe("ApiClient", () => {
  it("stuurt het Bearer-token mee en gebruikt de /api/v1-basis", async () => {
    const { api, calls } = client([{ status: 200, body: { callings: [] } }]);
    await api.callings("ring 1", "gepauzeerd");
    expect(calls[0].url).toBe("https://ringtools.example.nl/api/v1/callings?ring=ring%201&filter=gepauzeerd");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok-abcdefghijklmnopqrstuvwxyz");
  });

  it("stuurt bij inloggen en code aanvragen géén token mee", async () => {
    const { api, calls } = client([{ status: 200, body: { ok: true, message: "x" } }, { status: 200, body: { token: "t" } }]);
    await api.requestCode("a@b.nl");
    await api.login("a@b.nl", "12345678", "iPhone");
    for (const c of calls) expect((c.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ email: "a@b.nl", code: "12345678", deviceName: "iPhone" });
  });

  it("geeft de Nederlandse servermelding en code door als fout", async () => {
    const { api } = client([{ status: 403, body: { error: "Je hebt hiervoor geen bevoegdheid.", code: "forbidden" } }]);
    await expect(api.vote("abc", true)).rejects.toMatchObject({ status: 403, message: "Je hebt hiervoor geen bevoegdheid.", code: "forbidden" });
  });

  it("meldt een verlopen sessie (401) zodat de app kan uitloggen", async () => {
    const { api, onUnauthorized } = client([{ status: 401, body: { error: "Je bent niet ingelogd.", code: "unauthenticated" } }]);
    await expect(api.me()).rejects.toBeInstanceOf(ApiRequestError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("een 401 bij inloggen (foute code) logt niemand uit", async () => {
    const { api, onUnauthorized } = client([{ status: 401, body: { error: "Deze code is onjuist of verlopen.", code: "invalid-code" } }]);
    await expect(api.login("a@b.nl", "00000000", "x")).rejects.toMatchObject({ code: "invalid-code" });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("vertaalt een netwerkfout naar een begrijpelijke melding", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x.nl", getToken: () => "t", fetchImpl });
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("verwijderen stuurt altijd de bevestiging mee", async () => {
    const { api, calls } = client([{ status: 200, body: { ok: true } }]);
    await api.deleteCalling("abc");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ confirmed: true });
  });
});
