import crypto from "node:crypto";
import { env } from "../env";

/**
 * Versleuteling van declaratiegegevens (AES-256-GCM). Sleutel: HKDF-SHA256 over de bestaande SETTINGS_ENCRYPTION_KEY met een eigen
 * context ("declaraties"), zodat de declaratiesleutel afwijkt van de sleutel voor SMTP-/TOTP-geheimen. Iedere versleuteling gebruikt een
 * nieuwe willekeurige IV; de ciphertext is gebonden aan een context-ID (AAD, bv. het declaratie- of bijlage-ID): een ciphertext die naar
 * een andere rij is gekopieerd, kan niet worden ontsleuteld.
 * Formaat: [1 byte versie][12 bytes IV][16 bytes tag][ciphertext].
 */
const VERSION = 1;
const IV = 12;
const TAG = 16;

function masterKey(): Buffer {
  const raw = env.settingsEncryptionKey;
  return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest();
}

let cached: { master: string; key: Buffer } | null = null;
function key(): Buffer {
  const raw = env.settingsEncryptionKey;
  if (!cached || cached.master !== raw) cached = { master: raw, key: Buffer.from(crypto.hkdfSync("sha256", masterKey(), Buffer.alloc(0), "ringtools/declaraties/v1", 32)) };
  return cached.key;
}

export function seal(plain: Buffer, aad: string): Buffer {
  const iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function open(sealed: Uint8Array, aad: string): Buffer {
  const buf = Buffer.from(sealed);
  if (buf.length < 1 + IV + TAG || buf[0] !== VERSION) throw new Error("Ongeldige versleutelde gegevens.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(1, 1 + IV));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(buf.subarray(1 + IV, 1 + IV + TAG));
  return Buffer.concat([decipher.update(buf.subarray(1 + IV + TAG)), decipher.final()]);
}

export const sealJson = (value: unknown, aad: string): Buffer => seal(Buffer.from(JSON.stringify(value), "utf8"), aad);
export const openJson = <T>(sealed: Uint8Array, aad: string): T => JSON.parse(open(sealed, aad).toString("utf8")) as T;
