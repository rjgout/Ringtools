import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ keychain: new Map<string, string>(), installation: "install-one" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({ identity: async () => ({ id: state.installation }) }) }));
vi.mock("@aparajita/capacitor-secure-storage", () => ({ KeychainAccess: { afterFirstUnlockThisDeviceOnly: "local" }, SecureStorage: {
  setSynchronize: vi.fn(), setDefaultKeychainAccess: vi.fn(),
  get: async (k: string) => state.keychain.get(k) ?? null,
  set: async (k: string,v: string) => { state.keychain.set(k,v); },
  remove: async (k: string) => { state.keychain.delete(k); }, keys: async () => [...state.keychain.keys()],
} }));
async function coldStart() { vi.resetModules(); return (await import("../src/lib/storage")).storage; }
beforeEach(() => { state.keychain.clear(); state.installation = "install-one"; });
it("NEE: token blijft in geheugen bij een appwissel; cold start vereist aanmelden", async () => {
  const s = await coldStart(); await s.setToken("synthetic-token", "u1");
  expect(await s.getToken()).toBe("synthetic-token"); expect(state.keychain.has("ringtools.session")).toBe(false);
  expect(await (await coldStart()).getToken()).toBeNull();
});
it("JA: expliciete toestelregistratie staat hervatten en tokenrotatie toe", async () => {
  const s = await coldStart(); await s.setToken("first", "u1");
  await s.setDeviceKey(JSON.stringify({ tag: "tag", installationId: "device", userId: "u1" })); await s.persistSession();
  const next = await coldStart(); expect(await next.hasSession()).toBe(true); expect(await next.getToken()).toBe("first");
  await next.setToken("rotated", "u1"); expect(state.keychain.get("ringtools.session")).toBe("rotated");
});
it("herinstallatie wist achtergebleven Keychainreferenties en sessies", async () => {
  const s = await coldStart(); await s.setDeviceKey(JSON.stringify({ tag: "tag", userId: "u1" })); await s.setToken("old", "u1");
  state.installation = "install-two"; const next = await coldStart();
  expect(await next.hasSession()).toBe(false); expect(await next.getDeviceKey()).toBeNull(); expect(await next.getToken()).toBeNull();
});
it("accountwissel bewaart geen sessie onder andermans toestelsleutel", async () => {
  const s = await coldStart(); await s.setDeviceKey(JSON.stringify({ tag: "tag", userId: "u1" }));
  await s.setToken("other-user", "u2"); expect(await s.getToken()).toBe("other-user"); expect(state.keychain.has("ringtools.session")).toBe(false);
});

it("afmelden offline: intrekking blijft uitsluitend beveiligd bewaard, niet als hervatbare sessie", async () => {
  const s = await coldStart(); await s.setToken("logout-only", "u1");
  await s.queueLogout("logout-only"); await s.clearSession();
  const next = await coldStart();
  expect(await next.getToken()).toBeNull(); expect(await next.getPendingLogouts()).toEqual(["logout-only"]);
  await next.removeQueuedLogout("logout-only"); expect(await next.getPendingLogouts()).toEqual([]);
});
it("zonder bewezen account-ID wordt nooit een token bij andermans toestelsleutel bewaard", async () => {
  const s = await coldStart(); await s.setDeviceKey(JSON.stringify({ tag: "old", userId: "u1" }));
  await s.setToken("pending-other-account"); await s.persistSession();
  expect(state.keychain.has("ringtools.session")).toBe(false);
});
