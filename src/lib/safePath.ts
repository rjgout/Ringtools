/**
 * Valideert dat een doel-pad veilig intern is (voorkomt open redirects):
 * alleen een pad op dezelfde site, nooit een andere host, protocol-relatieve
 * URL ("//host"), backslash-variant ("/\\host") of pad met stuurtekens.
 */
export function safeInternalPath(path: string | undefined | null): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}
