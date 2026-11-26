import crypto from "node:crypto";

/** Beperkingen voor bijlagen bij een declaratie. Het type wordt server-side aan de hand van de bestandsinhoud (magic bytes) vastgesteld. */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export type AttachmentMime = "image/jpeg" | "image/png" | "application/pdf";
export const ALLOWED_MIME: AttachmentMime[] = ["image/jpeg", "image/png", "application/pdf"];

export class FileValidationError extends Error {}

export function sniffMime(b: Buffer): AttachmentMime | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

/** Een PDF met actieve inhoud (JavaScript, automatisch uitvoeren, ingebedde bestanden) wordt geweigerd. */
const ACTIVE_PDF = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/;
export function pdfHasActiveContent(b: Buffer): boolean {
  return ACTIVE_PDF.test(b.toString("latin1"));
}

export function safeFileName(name: unknown, mime: AttachmentMime): string {
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const base = typeof name === "string" ? name.normalize("NFKD").replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) : "";
  return `${base || "bon"}.${ext}`;
}

export type ValidatedFile = { fileName: string; mime: AttachmentMime; bytes: Buffer; sha256: string };

/** Valideert en saneert één aangeleverd bestand (base64 uit de API). Gooit FileValidationError met een Nederlandse melding. */
export function validateFile(input: { fileName?: unknown; dataBase64?: unknown }): ValidatedFile {
  const raw = typeof input.dataBase64 === "string" ? input.dataBase64.replace(/^data:[^;]*;base64,/, "").replace(/\s+/g, "") : "";
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) throw new FileValidationError("Een bijlage is niet leesbaar.");
  if (raw.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8) throw new FileValidationError("Een bijlage is te groot (maximaal 10 MB per bestand).");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length) throw new FileValidationError("Een bijlage is leeg.");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new FileValidationError("Een bijlage is te groot (maximaal 10 MB per bestand).");
  const mime = sniffMime(bytes);
  if (!mime) throw new FileValidationError("Alleen foto's (JPEG of PNG) en PDF-bestanden zijn toegestaan.");
  if (mime === "application/pdf" && pdfHasActiveContent(bytes)) throw new FileValidationError("Dit PDF-bestand bevat actieve inhoud en is niet toegestaan.");
  return { fileName: safeFileName(input.fileName, mime), mime, bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

export function validateFiles(inputs: unknown): ValidatedFile[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new FileValidationError("Voeg minstens één foto of PDF van de bon toe.");
  if (inputs.length > MAX_ATTACHMENTS) throw new FileValidationError(`Maximaal ${MAX_ATTACHMENTS} bijlagen per declaratie.`);
  const files = inputs.map((i) => validateFile((i ?? {}) as Record<string, unknown>));
  if (files.reduce((n, f) => n + f.bytes.length, 0) > MAX_TOTAL_BYTES) throw new FileValidationError("De bijlagen zijn samen te groot (maximaal 25 MB).");
  return files;
}
