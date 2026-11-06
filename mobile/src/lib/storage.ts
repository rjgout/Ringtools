import { Capacitor } from "@capacitor/core";
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";

/**
 * Bewaart het sessietoken en de installatie-ID uitsluitend in de platformopslag (iOS Keychain,
 * Android Keystore via Android-versleutelde opslag). Er wordt NOOIT localStorage/sessionStorage gebruikt
 * voor gevoelige gegevens. In een gewone browser (alleen voor ontwikkelen) blijft alles in het geheugen.
 */
const TOKEN = "ringtools.session";
const RING = "ringtools.ring";
const MODE = "ringtools.mode";
const PUSH = "ringtools.pushToken";
const DEVICE = "ringtools.deviceId";
const DEVICE_KEY = "ringtools.deviceKey";
const PENDING_UNREGISTER = "ringtools.pendingPushUnregister";

const memory = new Map<string, string>();
const native = Capacitor.isNativePlatform();
let ready: Promise<void> | null = null;

function init(): Promise<void> {
  if (!native) return Promise.resolve();
  ready ??= (async () => {
    await SecureStorage.setSynchronize(false); // niet via iCloud synchroniseren
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly); // niet in back-ups naar andere toestellen
  })();
  return ready;
}

async function get(key: string): Promise<string | null> {
  if (!native) return memory.get(key) ?? null;
  await init();
  const value = await SecureStorage.get(key);
  return typeof value === "string" ? value : null;
}
async function set(key: string, value: string): Promise<void> {
  if (!native) return void memory.set(key, value);
  await init();
  await SecureStorage.set(key, value);
}
async function remove(key: string): Promise<void> {
  if (!native) return void memory.delete(key);
  await init();
  await SecureStorage.remove(key).catch(() => false);
}

export const storage = {
  getToken: () => get(TOKEN),
  setToken: (v: string) => set(TOKEN, v),
  /** "admin" na een webmin-login; anders leeg (gewone gebruiker). */
  getMode: () => get(MODE),
  setMode: (v: string) => set(MODE, v),
  getRing: () => get(RING),
  setRing: (v: string) => set(RING, v),
  getPushToken: () => get(PUSH),
  setPushToken: (v: string) => set(PUSH, v),
  getPendingUnregister: () => get(PENDING_UNREGISTER),
  setPendingUnregister: (v: string) => set(PENDING_UNREGISTER, v),
  clearPendingUnregister: () => remove(PENDING_UNREGISTER),
  /** Willekeurige installatie-ID (geen hardware-ID); bepaalt tokenrotatie op de server. */
  async deviceId(): Promise<string> {
    const existing = await get(DEVICE);
    if (existing) return existing;
    const id = crypto.randomUUID().replace(/-/g, "");
    await set(DEVICE, id);
    return id;
  },
  /** Verwijzing naar de toestelsleutel (installatie-ID, tag); de privésleutel zelf verlaat nooit de beveiligde hardware. Blijft bestaan bij uitloggen. */
  getDeviceKey: () => get(DEVICE_KEY),
  setDeviceKey: (v: string) => set(DEVICE_KEY, v),
  /** Wist de sessiegegevens; de installatie-ID en een nog niet afgemeld pushtoken blijven bewust bestaan. */
  async clearSession() {
    await Promise.all([TOKEN, RING, PUSH, MODE].map(remove));
  },
};
