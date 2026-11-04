import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuildProfile, nativeCapabilities } from "../src/lib/buildProfile";

describe("buildprofiel", () => {
  it("standaard (ook zonder script, onbekende of rare waarden) is 'standard' met alle native functies", () => {
    for (const win of [{}, { __RINGTOOLS_BUILD__: {} }, { __RINGTOOLS_BUILD__: { profile: "standard" } }, { __RINGTOOLS_BUILD__: { profile: 42 } }, { __RINGTOOLS_BUILD__: { profile: "PERSONAL-TEAM" } }]) {
      expect(getBuildProfile(win)).toBe("standard");
    }
    expect(nativeCapabilities("standard")).toEqual({ nativePush: true, universalLinks: true, limited: false });
  });
  it("'personal-team' schakelt native push en universele links uit", () => {
    expect(getBuildProfile({ __RINGTOOLS_BUILD__: { profile: "personal-team" } })).toBe("personal-team");
    expect(nativeCapabilities("personal-team")).toEqual({ nativePush: false, universalLinks: false, limited: true });
  });
});
