import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiRequestError } from "../src/lib/api";
import { resumeSession } from "../src/lib/resume";

const ME = { user: { id: "u1", name: "A", email: "a@b.nl", emailNotificationsEnabled: true, mfaEnabled: false }, rings: [], pendingCount: 0 };
const deps = (over: Partial<Parameters<typeof resumeSession>[0]> = {}) => ({
  getToken: async () => "tok" as string | null,
  useToken: vi.fn(),
  me: async () => ME,
  ...over,
});

describe("resumeSession: de app blijft nooit op het laadscherm hangen", () => {
  it("zonder token: uitgelogd (zonder netwerkverzoek)", async () => {
    const me = vi.fn();
    expect(await resumeSession(deps({ getToken: async () => null, me }))).toEqual({ kind: "signedOut" });
    expect(me).not.toHaveBeenCalled();
  });
  it("onleesbare beveiligde opslag: uitgelogd in plaats van een uitzondering", async () => {
    expect(await resumeSession(deps({ getToken: async () => { throw new Error("keystore"); } }))).toEqual({ kind: "signedOut" });
  });
  it("geldig token: ingelogd, het token is in gebruik genomen vóór /me", async () => {
    const d = deps();
    expect(await resumeSession(d)).toEqual({ kind: "signedIn", me: ME });
    expect(d.useToken).toHaveBeenCalledWith("tok");
  });
  it("401: uitgelogd", async () => {
    expect(await resumeSession(deps({ me: async () => { throw new ApiRequestError(401, "x", "unauthenticated"); } }))).toEqual({ kind: "signedOut" });
  });
  it.each([
    ["geen verbinding", new ApiRequestError(0, "offline", "network")],
    ["serverfout 500", new ApiRequestError(500, "kapot", "server")],
    ["verboden 403", new ApiRequestError(403, "nee", null)],
  ])("%s: 'unavailable' met opnieuw proberen (token blijft bewaard)", async (_n, error) => {
    const result = await resumeSession(deps({ me: async () => { throw error; } }));
    expect(result).toEqual({ kind: "unavailable", error });
  });
  it("een onverwachte fout (geen ApiRequestError) levert ook een eindtoestand op", async () => {
    const result = await resumeSession(deps({ me: async () => { throw new TypeError("boem"); } }));
    expect(result.kind).toBe("unavailable");
  });
});

describe("ApiClient time-out", () => {
  it("een hangende verbinding eindigt als netwerkfout i.p.v. eeuwig laden", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x.nl/api/mobile/v1", getToken: () => "t", fetchImpl, timeoutMs: 30 });
    const err = (await api.me().catch((e: unknown) => e)) as ApiRequestError;
    expect(err.isNetwork).toBe(true);
  });
});
