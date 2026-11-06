import { rateLimit } from "../rateLimit";
import { claimPairing, completePairing, TrustedDeviceError } from "../trustedDevices";
import { ApiError, str } from "./http";

const WINDOW = 15 * 60 * 1000;

async function errors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TrustedDeviceError) throw new ApiError(err.status, err.message, err.code);
    throw err;
  }
}

/** Per IP én globaal begrensd: de koppelcode (60 bits) is niet te raden, maar pogingen blijven schaars. */
function limit(kind: string, clientKey: string) {
  if (!rateLimit(`${kind}:${clientKey}`, 10, WINDOW).allowed || !rateLimit(`${kind}:all`, 120, WINDOW).allowed) {
    throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  }
}

/** Publiek (app niet ingelogd): de koppelcode autoriseert alleen een toestelregistratie, nooit een sessie. */
export async function claimPairingApi(body: Record<string, unknown>, clientKey: string) {
  limit("pair-claim", clientKey);
  const res = await errors(() => claimPairing(str(body.code)));
  return { registrationToken: res.registrationToken, challenge: res.challenge, expiresAt: res.expiresAt.toISOString() };
}

export async function completePairingApi(body: Record<string, unknown>, clientKey: string) {
  limit("pair-complete", clientKey);
  const platform = str(body.platform);
  const res = await errors(() =>
    completePairing({
      registrationToken: str(body.registrationToken),
      publicKey: str(body.publicKey),
      signature: str(body.signature),
      installationId: str(body.installationId),
      platform: platform === "IOS" || platform === "ANDROID" ? platform : ("" as "IOS"),
      label: str(body.label),
    })
  );
  return { ok: true, deviceId: res.deviceId };
}
