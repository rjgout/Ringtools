import { defineConfig } from "vitest/config";
import path from "path";
import { assertSafeTestDatabaseUrl } from "./tests/dbGuard";

// De suite wist data: alleen op een afzonderlijke testdatabase (TEST_DATABASE_URL, of DATABASE_URL als die al een testdatabase is, zoals in CI).
const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);

export default defineConfig({
  test: {
    env: { DATABASE_URL: testDatabaseUrl },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
