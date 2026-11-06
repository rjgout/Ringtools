import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "onbekend";
  } catch {
    return "onbekend";
  }
}

// Gebundelde productie-assets in dist/ (webDir van Capacitor). De dev-server proxyt de API
// naar de echte backend, zodat je de client ook in een gewone browser kunt ontwikkelen.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { __RINGTOOLS_BUILD_ID__: JSON.stringify(buildId()) },
  resolve: { alias: { "@shared": path.resolve(__dirname, "../shared") } },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  server: { proxy: { "/api": { target: process.env.VITE_API_URL || "http://localhost:2809", changeOrigin: true } } },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"] },
});
