#!/usr/bin/env node
// Technische exports van het ongewijzigde appicoon; geen tweede logo of schermvullende bitmap.
import sharp from "sharp";
import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const icon = await readFile(join(root, "resources/icon.png"));
const exports = new Map([["resources/splash.png", icon]]);
const images = [];
for (const scale of [1, 2, 3]) {
  const filename = `ringtools-${scale}x.png`;
  exports.set(`ios/App/App/Assets.xcassets/Splash.imageset/${filename}`, await sharp(icon).resize(192 * scale, 192 * scale).png().toBuffer());
  images.push({ idiom: "universal", filename, scale: `${scale}x` });
}
exports.set("ios/App/App/Assets.xcassets/Splash.imageset/Contents.json", Buffer.from(JSON.stringify({ images, info: { version: 1, author: "xcode" } }, null, 2) + "\n"));
// Android 12+: 288dp zonder icoonachtergrond, 192dp veilige cirkel. De volledige
// vierkante huisstijl is 128dp (diagonaal 181dp), zodat alle zeven units ook
// binnen het ronde 192dp-systeemmasker passen.
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const padding = 80 * scale;
  const png = await sharp(icon).resize(128 * scale, 128 * scale).extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  exports.set(`android/app/src/main/res/drawable-${density}/splash_mark.png`, png);
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
