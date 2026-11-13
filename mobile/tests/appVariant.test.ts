import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("App-variant (Ringtools Dev)", () => {
  it("is standaard leeg (productie) en 'dev' alleen via de build-variabele", async () => {
    vi.resetModules();
    expect((await import("../src/config")).APP_VARIANT).toBe("");
    vi.stubEnv("VITE_APP_VARIANT", " dev ");
    vi.resetModules();
    expect((await import("../src/config")).APP_VARIANT).toBe("dev");
  });

  it("de dev-variant praat uitsluitend met de dev-backend", async () => {
    vi.stubEnv("VITE_API_URL", "https://dev.ringapeldoorn.nl");
    vi.resetModules();
    const c = await import("../src/config");
    expect(c.API_URL).toBe("https://dev.ringapeldoorn.nl");
    expect(c.API_HOST).toBe("dev.ringapeldoorn.nl");
  });
});
