import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { existsSync, renameSync } from "fs";

function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "onbekend";
  } catch {
    return "onbekend";
  }
}

const outDir = path.resolve(__dirname, "../public/app");

// Web-build van dezelfde client (web/PWA): komt in public/app van de Next.js-server en wordt geserveerd onder /app.
// De native bundel (vite.config.ts → dist/) blijft hiervan volledig gescheiden.
export default defineConfig({
  mode: "web",
  plugins: [
    react(),
    {
      name: "ringtools-web-index",
      // Alleen hernoemen als de bundel er werkelijk staat: bij een bouwfout moet de echte foutmelding zichtbaar blijven.
      closeBundle: () => {
        if (existsSync(path.join(outDir, "web.html"))) renameSync(path.join(outDir, "web.html"), path.join(outDir, "index.html"));
      },
    },
  ],
  base: "/app/",
  define: { __RINGTOOLS_BUILD_ID__: JSON.stringify(buildId()) },
  resolve: { alias: { "@shared": path.resolve(__dirname, "../shared") } },
  build: { outDir, emptyOutDir: true, sourcemap: false, target: "es2022", rollupOptions: { input: path.resolve(__dirname, "web.html") } },
});
