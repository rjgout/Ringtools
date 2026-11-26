/** Bereidt een gekozen foto of PDF voor op uploaden: foto's worden verkleind (max. 2400 px, JPEG) zodat ze ruim binnen de serverlimiet blijven. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type PreparedFile = { fileName: string; dataBase64: string; sizeBytes: number; previewUrl: string | null };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("conversie mislukt"))), "image/jpeg", 0.85));
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const isImage = /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || /\.(jpe?g|png|heic|heif)$/i.test(file.name);
  if (!isImage && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("Alleen foto's (JPEG/PNG) en PDF-bestanden zijn toegestaan.");
  let blob: Blob = file;
  let name = file.name || "bon";
  if (isImage && file.type !== "image/png") {
    try { blob = await downscale(file); name = name.replace(/\.[^.]+$/, "") + ".jpg"; } catch { /* onverkleind doorgaan; de server controleert het type */ }
  }
  if (blob.size > MAX_FILE_BYTES) throw new Error("Dit bestand is te groot (maximaal 10 MB).");
  const previewUrl = blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
  return { fileName: name, dataBase64: toBase64(await blob.arrayBuffer()), sizeBytes: blob.size, previewUrl };
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100);
}
