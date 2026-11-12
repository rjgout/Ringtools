#!/usr/bin/env node
// Origineel beeldmerk en schermvullende kleurenachtergrond exporteren.
import sharp from "sharp";
import { originalEmblem } from "./splash-art.mjs";
import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const icon = await readFile(join(root, "resources/icon.png"));
const emblem = await originalEmblem(icon);
const background = await readFile(join(root, "resources/splash-background.png"));
const exports = new Map([
  ["resources/splash.png", emblem],
  ["ios/App/App/Assets.xcassets/SplashBackground.imageset/blue.png", background],
  ["ios/App/App/Assets.xcassets/SplashBackground.imageset/Contents.json", Buffer.from(JSON.stringify({ images: [{ idiom: "universal", filename: "blue.png", scale: "1x" }], info: { version: 1, author: "xcode" } }, null, 2) + "\n")],
  ["android/app/src/main/res/drawable-nodpi/splash_background.png", background],
]);
const images = [];
for (const scale of [1, 2, 3]) {
  const filename = `ringtools-${scale}x.png`;
  exports.set(`ios/App/App/Assets.xcassets/Splash.imageset/${filename}`, await sharp(emblem).resize(192 * scale, 192 * scale).png().toBuffer());
  images.push({ idiom: "universal", filename, scale: `${scale}x` });
}
exports.set("ios/App/App/Assets.xcassets/Splash.imageset/Contents.json", Buffer.from(JSON.stringify({ images, info: { version: 1, author: "xcode" } }, null, 2) + "\n"));
// Android toont hetzelfde originele beeldmerk in de app-eigen native splash.
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  exports.set(`android/app/src/main/res/drawable-${density}/splash_mark.png`, await sharp(emblem).resize(192 * scale, 192 * scale).png().toBuffer());
}
const stale = [];
const ios = "ios/App/App/Assets.xcassets/Splash.imageset";
for (const name of await readdir(join(root, ios))) if (!exports.has(`${ios}/${name}`)) stale.push(`${ios}/${name}`);
const android = "android/app/src/main/res";
for (const dir of await readdir(join(root, android), { withFileTypes: true })) {
  if (!dir.isDirectory() || !dir.name.startsWith("drawable")) continue;
  for (const name of await readdir(join(root, android, dir.name))) {
    if ((name === "splash.png" || name === "splash_mark.png") && !exports.has(`${android}/${dir.name}/${name}`)) stale.push(`${android}/${dir.name}/${name}`);
  }
}
if (check) {
  for (const [path, expected] of exports) {
    const actual = await readFile(join(root, path)).catch(() => null);
    if (!actual?.equals(expected)) throw new Error(`Splash-export wijkt af: ${path}. Draai npm run assets:splash.`);
  }
  if (stale.length) throw new Error(`Oude splash-assets aanwezig: ${stale.join(", ")}`);
  console.log("Splash-assets komen overeen met het huidige Ringtools-appicoon; geen oude exports.");
} else {
  for (const path of stale) await rm(join(root, path));
  for (const [path, data] of exports) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), data); }
  console.log("Ringtools-splash geëxporteerd voor iOS en Android; oude splash-assets verwijderd.");
}
