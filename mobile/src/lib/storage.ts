import * as SecureStore from "expo-secure-store";

const TOKEN = "ringtools.token";
const RING = "ringtools.ring";
const PUSH = "ringtools.pushToken";
// Blijft bewust staan na uitloggen/401 tot de server het push-token heeft afgemeld.
const PENDING_UNREGISTER = "ringtools.pendingPushUnregister";

/** Het sessietoken staat uitsluitend in de beveiligde opslag van het toestel (iOS Keychain / Android Keystore). */
export const storage = {
  getToken: () => SecureStore.getItemAsync(TOKEN),
  setToken: (v: string) => SecureStore.setItemAsync(TOKEN, v),
  getRing: () => SecureStore.getItemAsync(RING),
  setRing: (v: string) => SecureStore.setItemAsync(RING, v),
  getPushToken: () => SecureStore.getItemAsync(PUSH),
  setPushToken: (v: string) => SecureStore.setItemAsync(PUSH, v),
  getPendingUnregister: () => SecureStore.getItemAsync(PENDING_UNREGISTER),
  setPendingUnregister: (v: string) => SecureStore.setItemAsync(PENDING_UNREGISTER, v),
  clearPendingUnregister: () => SecureStore.deleteItemAsync(PENDING_UNREGISTER),
  async clear() {
    await Promise.all([TOKEN, RING, PUSH].map((k) => SecureStore.deleteItemAsync(k)));
  },
};
