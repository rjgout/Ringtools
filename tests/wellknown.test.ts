import { afterEach, describe, expect, it } from "vitest";
import { GET as aasa } from "@/app/.well-known/apple-app-site-association/route";
import { GET as assetlinks } from "@/app/.well-known/assetlinks.json/route";

afterEach(() => {
  delete process.env.APPLE_APP_ID;
  delete process.env.ANDROID_SHA256_FINGERPRINTS;
  delete process.env.ANDROID_PACKAGE;
});

describe("Universal Links / App Links (.well-known)", () => {
  it("zonder configuratie zijn de bestanden leeg: er wordt geen team-ID of vingerafdruk verzonnen", async () => {
    expect(await aasa().json()).toEqual({ applinks: { details: [] } }); // ook geen webcredentials
    expect(await assetlinks().json()).toEqual([]);
  });
  it("met configuratie verwijzen ze alleen naar /open/*, /roepingen/* en /uitnodiging/*", async () => {
    process.env.APPLE_APP_ID = "ABCDE12345.nl.ringapeldoorn.ringtools";
    process.env.ANDROID_SHA256_FINGERPRINTS = "AA:BB, CC:DD";
    const apple = await aasa().json();
    expect(apple.applinks.details[0].appIDs).toEqual(["ABCDE12345.nl.ringapeldoorn.ringtools"]);
    expect(apple.applinks.details[0].components).toEqual([{ "/": "/open/*" }, { "/": "/roepingen/*" }, { "/": "/uitnodiging/*" }]);
    const android = await assetlinks().json();
    expect(android[0].target).toEqual({ namespace: "android_app", package_name: "nl.ringapeldoorn.ringtools", sha256_cert_fingerprints: ["AA:BB", "CC:DD"] });
    expect(android[0].relation).toEqual(["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"]);
    expect(apple.webcredentials).toEqual({ apps: ["ABCDE12345.nl.ringapeldoorn.ringtools"] });
  });
  it("beide antwoorden zijn JSON", () => {
    expect(aasa().headers.get("Content-Type")).toBe("application/json");
    expect(assetlinks().headers.get("Content-Type")).toBe("application/json");
  });
});
