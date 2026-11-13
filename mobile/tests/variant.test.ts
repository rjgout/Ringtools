// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

// De dev-variant (Ringtools Dev) past de native projecten alleen in een werkkopie aan; de productiebestanden blijven ongewijzigd en blijven op de productie-identiteit staan.
const mobile = join(__dirname, "..");
const FILES = [
  "ios/App/App.xcodeproj/project.pbxproj",
  "ios/App/App/Info.plist",
  "ios/App/App/App.entitlements",
  "android/app/build.gradle",
  "android/app/src/main/res/values/strings.xml",
  "android/app/src/main/AndroidManifest.xml",
];
const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
const run = (args: string[], root?: string) =>
  spawnSync("node", [join(mobile, "scripts/configure-variant.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...(root ? { RINGTOOLS_NATIVE_ROOT: root } : {}) } });

function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "ringtools-variant-"));
  for (const f of FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(mobile, f), join(dir, f));
  }
  return dir;
}

describe("Variant dev (Ringtools Dev)", () => {
  it("zet bundle-ID, application-ID, naam en link-host om, in een kopie", () => {
    const dir = copyTree();
    const r = run(["dev"], dir);
    expect(r.status, r.stderr).toBe(0);
    const pbx = read(dir, FILES[0]);
    expect([...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1])).toEqual(["nl.ringapeldoorn.ringtools.dev", "nl.ringapeldoorn.ringtools.dev"]);
    expect(read(dir, FILES[1])).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Ringtools Dev<\/string>/);
    const ent = read(dir, FILES[2]);
    expect(ent).toContain("applinks:dev.ringapeldoorn.nl");
    expect(ent).toContain("webcredentials:dev.ringapeldoorn.nl");
    expect(ent).not.toContain("applinks:ringapeldoorn.nl<");
    expect(read(dir, FILES[3])).toMatch(/applicationId "nl\.ringapeldoorn\.ringtools\.dev"/);
    expect(read(dir, FILES[3])).toMatch(/namespace = "nl\.ringapeldoorn\.ringtools"/); // R-klasse/namespace blijft gelijk
    expect(read(dir, FILES[4])).toContain('<string name="app_name">Ringtools Dev</string>');
    const manifest = read(dir, FILES[5]);
    expect([...new Set([...manifest.matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]))]).toEqual(["dev.ringapeldoorn.nl"]);
  });

  it("is idempotent", () => {
    const dir = copyTree();
    run(["dev"], dir);
    const first = FILES.map((f) => read(dir, f));
    expect(run(["dev"], dir).status).toBe(0);
    expect(FILES.map((f) => read(dir, f))).toEqual(first);
  });

  it("laat de productieconfiguratie in Git ongemoeid", () => {
    expect(read(mobile, FILES[0])).not.toContain(".ringtools.dev");
    expect(read(mobile, FILES[3])).toMatch(/applicationId "nl\.ringapeldoorn\.ringtools"/);
    expect(read(mobile, FILES[2])).toContain("applinks:ringapeldoorn.nl");
  });

  it("de variant gebruikt een eigen backend, een eigen ID en de productie-prefix; productiewaarden worden geweigerd", () => {
    const v = JSON.parse(read(mobile, "variants/dev.json"));
    expect(v.appId).toBe("nl.ringapeldoorn.ringtools.dev");
    expect(v.appId).not.toBe("nl.ringapeldoorn.ringtools");
    expect(v.apiUrl).toBe("https://dev.ringapeldoorn.nl");
    expect(v.host).not.toBe("ringapeldoorn.nl");
    expect(run(["onbekend"]).status).not.toBe(0);
  });

  it("--print-env geeft de omgevingswaarden voor de build, nooit de productie-API", () => {
    const r = run(["dev", "--print-env"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("VITE_API_URL=https://dev.ringapeldoorn.nl");
    expect(r.stdout).toContain("RINGTOOLS_APP_ID=nl.ringapeldoorn.ringtools.dev");
    expect(r.stdout).not.toMatch(/https:\/\/ringapeldoorn\.nl/);
  });
});
