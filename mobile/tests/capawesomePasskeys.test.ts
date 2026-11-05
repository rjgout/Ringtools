import { afterEach, describe, expect, it, vi } from "vitest";
import { PasskeyCancelledError, PasskeyError, getPasskeyProvider, registerPasskeyProvider } from "../src/lib/passkeys";

const pluginModule = vi.hoisted(() => ({ Passkeys: { isAvailable: vi.fn(), getPasskey: vi.fn() } }));
vi.mock("@capawesome/capacitor-passkeys", () => pluginModule);

const { createCapawesomeProvider, mapPluginError, registerCapawesomePasskeys, PASSKEY_MESSAGES } = await import("../src/lib/capawesomePasskeys");

afterEach(() => {
  registerPasskeyProvider(null);
  pluginModule.Passkeys.isAvailable.mockReset();
  pluginModule.Passkeys.getPasskey.mockReset();
});

const RP = "ringapeldoorn.nl";
const CHALLENGE = "dGhpc2lzYWNoYWxsZW5nZS0xMjM0NTY3ODkw";
const OPTIONS = { challenge: CHALLENGE, rpId: RP, timeout: 300000, userVerification: "preferred" as const, allowCredentials: [{ id: "Y3JlZC0x", type: "public-key" as const, transports: ["internal", "hybrid"] }] };
const RESULT = { id: "Y3JlZC0x", rawId: "Y3JlZC0x", type: "public-key" as const, authenticatorAttachment: "platform", response: { authenticatorData: "YXV0aA", clientDataJSON: "Y2xpZW50", signature: "c2ln", userHandle: "dXNlcg" } };

function plugin(over: Partial<{ isAvailable: () => Promise<{ available: boolean }>; getPasskey: (o: unknown) => Promise<unknown> }> = {}) {
  return { isAvailable: vi.fn(async () => ({ available: true })), getPasskey: vi.fn(async () => RESULT), ...over } as never;
}
const reject = (code?: string) => Object.assign(new Error("native fout met details"), code ? { code } : {});

describe("Capawesome-adapter: authenticatie", () => {
  it("geeft de serveropties 1-op-1 door (zonder transports), forceert user verification en levert een assertion in de vorm die de server verwacht", async () => {
    const p = plugin();
    const assertion = await createCapawesomeProvider(p, RP).authenticate(OPTIONS);
    expect((p as unknown as { getPasskey: ReturnType<typeof vi.fn> }).getPasskey).toHaveBeenCalledWith({
      challenge: CHALLENGE,
      rpId: RP,
      allowCredentials: [{ id: "Y3JlZC0x", type: "public-key" }],
      timeout: 120000, // begrensd
      userVerification: "required", // ondanks 'preferred' in de serveropties
    });
    expect(assertion).toEqual({
      id: "Y3JlZC0x",
      rawId: "Y3JlZC0x",
      type: "public-key",
      response: { clientDataJSON: "Y2xpZW50", authenticatorData: "YXV0aA", signature: "c2ln", userHandle: "dXNlcg" },
      clientExtensionResults: {},
    });
  });

  it("zonder allowCredentials/timeout (ontdekbare passkey) en met lege userHandle", async () => {
    const getPasskey = vi.fn(async () => ({ ...RESULT, response: { ...RESULT.response, userHandle: "" } }));
    const assertion = await createCapawesomeProvider(plugin({ getPasskey }), RP).authenticate({ challenge: CHALLENGE, rpId: RP });
    expect(getPasskey).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: RP, allowCredentials: undefined, userVerification: "required" });
    expect(assertion.response.userHandle).toBeUndefined();
  });

  it("weigert opties met een andere of ontbrekende RP ID of een ongeldige challenge, zonder de plug-in aan te roepen", async () => {
    const p = plugin();
    const provider = createCapawesomeProvider(p, RP);
    for (const bad of [
      { ...OPTIONS, rpId: "evil.example" },
      { ...OPTIONS, rpId: "ringapeldoorn.nl.evil.example" },
      { ...OPTIONS, rpId: undefined },
      { ...OPTIONS, challenge: "kort" },
      { ...OPTIONS, challenge: "geen base64url!!!!!!!!!!!!" },
      { ...OPTIONS, challenge: "" },
    ]) {
      await expect(provider.authenticate(bad as never)).rejects.toMatchObject({ kind: "invalid-options" });
    }
    expect((p as unknown as { getPasskey: ReturnType<typeof vi.fn> }).getPasskey).not.toHaveBeenCalled();
    expect((p as unknown as { isAvailable: ReturnType<typeof vi.fn> }).isAvailable).not.toHaveBeenCalled();
  });

  it("RP ID-vergelijking is hoofdletterongevoelig, maar exact (geen subdomein)", async () => {
    await expect(createCapawesomeProvider(plugin(), "RingApeldoorn.NL").authenticate(OPTIONS)).resolves.toBeTruthy();
    await expect(createCapawesomeProvider(plugin(), RP).authenticate({ ...OPTIONS, rpId: "app.ringapeldoorn.nl" })).rejects.toMatchObject({ kind: "invalid-options" });
  });

  it("niet-ondersteund toestel (isAvailable false of fout): not-supported en getPasskey wordt niet aangeroepen", async () => {
    const getPasskey = vi.fn();
    await expect(createCapawesomeProvider(plugin({ isAvailable: async () => ({ available: false }), getPasskey }), RP).authenticate(OPTIONS)).rejects.toMatchObject({ kind: "not-supported" });
    await expect(createCapawesomeProvider(plugin({ isAvailable: async () => { throw reject("NOT_SUPPORTED"); }, getPasskey }), RP).authenticate(OPTIONS)).rejects.toMatchObject({ kind: "not-supported" });
    expect(getPasskey).not.toHaveBeenCalled();
  });

  it("plug-infouten worden netjes vertaald: annuleren, niet ondersteund, domein niet gekoppeld, geen passkey, overig", async () => {
    const run = (code?: string) => createCapawesomeProvider(plugin({ getPasskey: async () => { throw reject(code); } }), RP).authenticate(OPTIONS);
    await expect(run("CANCELED")).rejects.toBeInstanceOf(PasskeyCancelledError);
    await expect(run("NOT_SUPPORTED")).rejects.toMatchObject({ kind: "not-supported", permanent: true });
    await expect(run("DOMAIN_NOT_ASSOCIATED")).rejects.toMatchObject({ kind: "domain-not-associated", permanent: true });
    await expect(run("NO_CREDENTIAL")).rejects.toMatchObject({ kind: "no-credential", permanent: false });
    await expect(run("GET_FAILED")).rejects.toMatchObject({ kind: "failed", permanent: false });
    await expect(run()).rejects.toMatchObject({ kind: "failed" });
    // De technische foutmelding van het toestel wordt nooit aan de gebruiker doorgegeven.
    await run("GET_FAILED").catch((e: Error) => expect(e.message).toBe(PASSKEY_MESSAGES.failed));
    expect(mapPluginError("tekst")).toBeInstanceOf(PasskeyError);
    expect(mapPluginError(null)).toBeInstanceOf(PasskeyError);
  });

  it("de gebruikersberichten adviseren nooit om MFA uit te schakelen", () => {
    for (const m of Object.values(PASSKEY_MESSAGES)) expect(m).not.toMatch(/uitschakel|uitzetten|zet .* uit/i);
  });

  it("onvolledig of vreemd resultaat van de plug-in geeft een mislukking, nooit een deels gevulde assertion", async () => {
    for (const bad of [undefined, null, {}, { ...RESULT, type: "password" }, { ...RESULT, id: 5 }, { ...RESULT, response: undefined }, { ...RESULT, response: { authenticatorData: "a", clientDataJSON: "b" } }]) {
      await expect(createCapawesomeProvider(plugin({ getPasskey: async () => bad as never }), RP).authenticate(OPTIONS)).rejects.toMatchObject({ kind: "failed" });
    }
  });

  it("één ceremonie tegelijk: een tweede gelijktijdige aanroep faalt, daarna kan het weer", async () => {
    let release: (v: typeof RESULT) => void = () => {};
    const getPasskey = vi.fn(() => new Promise<typeof RESULT>((r) => { release = r; }));
    const provider = createCapawesomeProvider(plugin({ getPasskey: getPasskey as never }), RP);
    const first = provider.authenticate(OPTIONS);
    await vi.waitFor(() => expect(getPasskey).toHaveBeenCalledTimes(1));
    await expect(provider.authenticate(OPTIONS)).rejects.toMatchObject({ kind: "failed" });
    release(RESULT);
    await expect(first).resolves.toBeTruthy();
    getPasskey.mockResolvedValueOnce(RESULT as never);
    await expect(provider.authenticate(OPTIONS)).resolves.toBeTruthy();
  });

  it("na een fout is de adapter weer vrij (geen blijvend 'bezig')", async () => {
    const getPasskey = vi.fn().mockRejectedValueOnce(reject("CANCELED")).mockResolvedValue(RESULT);
    const provider = createCapawesomeProvider(plugin({ getPasskey }), RP);
    await expect(provider.authenticate(OPTIONS)).rejects.toBeInstanceOf(PasskeyCancelledError);
    await expect(provider.authenticate(OPTIONS)).resolves.toBeTruthy();
  });
});

describe("Capawesome-adapter: registratie bij het opstarten", () => {
  it("koppelt alleen op een native toestel in een build die passkeys kan; anders blijft er geen provider (veilige melding)", async () => {
    expect(await registerCapawesomePasskeys({ isNative: false, passkeysCapable: true, rpId: RP })).toBe(false);
    expect(await registerCapawesomePasskeys({ isNative: true, passkeysCapable: false, rpId: RP })).toBe(false); // Personal Team-profiel
    expect(getPasskeyProvider()).toBeNull();
    expect(await registerCapawesomePasskeys({ isNative: true, passkeysCapable: true, rpId: RP })).toBe(true);
    expect(getPasskeyProvider()).not.toBeNull();
  });

  it("de geregistreerde provider gebruikt de echte plug-inmodule en dezelfde controles", async () => {
    await registerCapawesomePasskeys({ isNative: true, passkeysCapable: true, rpId: RP });
    pluginModule.Passkeys.isAvailable.mockResolvedValue({ available: true });
    pluginModule.Passkeys.getPasskey.mockResolvedValue(RESULT);
    await expect(getPasskeyProvider()!.authenticate({ ...OPTIONS, rpId: "evil.example" })).rejects.toMatchObject({ kind: "invalid-options" });
    await expect(getPasskeyProvider()!.authenticate(OPTIONS)).resolves.toMatchObject({ id: "Y3JlZC0x" });
  });
});
