import type { ExpoConfig } from "expo/config";

/**
 * Ringtools (native iOS/Android). De server waarmee de app praat komt uit
 * EXPO_PUBLIC_API_URL (de publieke https-URL van je Ringtools, hetzelfde als APP_BASE_URL op de server).
 * Dezelfde host wordt gebruikt voor universele links, zodat e-maillinks de app direct openen.
 */
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "https://ringtools.example.nl").replace(/\/+$/, "");
const host = new URL(apiUrl).host;

const config: ExpoConfig = {
  name: "Ringtools",
  slug: "ringtools",
  scheme: "ringtools",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "nl.ringapeldoorn.ringtools",
    supportsTablet: true,
    associatedDomains: [`applinks:${host}`],
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: "nl.ringapeldoorn.ringtools",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0b1220" },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host, pathPrefix: "/open" },
          { scheme: "https", host, pathPrefix: "/roepingen" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#0b1220" }],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#4f46e5" }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
