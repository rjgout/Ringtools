/**
 * Een web-push-abonnement wijst naar de push-service van de browserleverancier.
 * Het endpoint komt van de client en wordt later door de server aangeroepen;
 * accepteer daarom alleen https-adressen van bekende push-services (geen IP's,
 * geen poorten, geen inloggegevens), anders is het een SSRF-route.
 */
const ALLOWED_HOST_SUFFIXES = [
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];
const ALLOWED_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function isValidPushKey(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && BASE64URL.test(value);
}
