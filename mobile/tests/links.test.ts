import { describe, expect, it } from "vitest";
import { parseTarget, routeFor } from "@/lib/links";

describe("parseTarget (links en pushmeldingen)", () => {
  it("herkent een voorstel, ook als volledige https-URL of app-schema", () => {
    expect(parseTarget("/roepingen/cmvf57i8y008j7dc5")).toEqual({ kind: "calling", id: "cmvf57i8y008j7dc5" });
    expect(parseTarget("https://ringtools.example.nl/roepingen/cmvf57i8y008j7dc5?x=1#y")).toEqual({ kind: "calling", id: "cmvf57i8y008j7dc5" });
    expect(parseTarget("ringtools://roepingen/cmvf57i8y008j7dc5")).toEqual({ kind: "calling", id: "cmvf57i8y008j7dc5" });
  });

  it("herkent een e-maillink", () => {
    expect(parseTarget("https://ringtools.example.nl/open/AbC_123-xyzAbC_123-xyz")).toEqual({ kind: "open", token: "AbC_123-xyzAbC_123-xyz" });
    expect(routeFor({ kind: "open", token: "abcdefghijkl" })).toBe("/open/abcdefghijkl");
    expect(routeFor({ kind: "calling", id: "abcdefghijkl" })).toBe("/roepingen/abcdefghijkl");
  });

  it("negeert onbekende, externe en onveilige doelen", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "/dashboard",
      "/roepingen/",
      "/roepingen/a/b",
      "/roepingen/kort",
      "//evil.example/roepingen/abcdefghij",
      "/\\evil.example",
      "javascript:alert(1)",
      "http://insecure.example/roepingen/abcdefghij",
      "ftp://x/open/abcdefghij",
      "/open/../../etc",
    ]) {
      expect(parseTarget(bad as string | null | undefined)).toBeNull();
    }
  });
});
