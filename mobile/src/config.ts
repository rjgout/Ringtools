/** Build-time configuratie. Alles hier is publiek; geheimen horen nooit in de app. */
const raw = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://ringapeldoorn.nl";

export const API_URL = raw.replace(/\/+$/, "");
export const API_HOST = new URL(API_URL).host;
/** In de browser-dev-server proxyt Vite /api naar de backend; native gebruikt de volledige URL. */
export const IS_DEV_BROWSER = import.meta.env.DEV;
export const API_BASE = IS_DEV_BROWSER && typeof window !== "undefined" ? `${window.location.origin}/api/mobile/v1` : `${API_URL}/api/mobile/v1`;
export const APP_VERSION = "1.0.0";
/** Korte build-ID (git-commit) uit de build; toont op het inlogscherm welke bundel er draait. Niet geheim. */
declare const __RINGTOOLS_BUILD_ID__: string;
export const BUILD_ID = typeof __RINGTOOLS_BUILD_ID__ === "string" ? __RINGTOOLS_BUILD_ID__ : "dev";
/** API-versie waarvoor deze client is gebouwd (server: API_VERSION in src/lib/api/router.ts). */
export const SUPPORTED_API_VERSION = 1;

if (!API_URL.startsWith("https://") && !IS_DEV_BROWSER) {
  throw new Error("VITE_API_URL moet een https-URL zijn.");
}
