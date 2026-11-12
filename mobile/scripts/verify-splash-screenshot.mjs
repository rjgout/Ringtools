#!/usr/bin/env node
// Echte native pixels moeten zowel het originele beeldmerk als de doorlopende achtergrond tonen.
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const screenshot = process.argv[2];
if (!screenshot) throw new Error("Geef een echte simulatoropname op.");
const bright = (r, g, b) => (r > 160 && g > 160 && b > 160) || (r > 180 && g > 90 && b < 170);
async function bounds(input, central = false) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  let left = w, top = h, right = -1, bottom = -1;
  for (let y = Math.floor(h * (central ? 0.2 : 0)); y < h * (central ? 0.8 : 1); y++) {
    for (let x = Math.floor(w * (central ? 0.1 : 0)); x < w * (central ? 0.9 : 1); x++) {
      const i = (y * w + x) * c;
      if (bright(data[i], data[i + 1], data[i + 2])) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  if (right < left) throw new Error("Het Ringtools-beeldmerk ontbreekt (zwart/leeg scherm).");
  return { width: w, height: h, left, top, w: right - left + 1, h: bottom - top + 1 };
}
const source = await bounds(join(root, "resources/icon.png"));
const actual = await bounds(screenshot, true);
const sx = actual.w / source.w, sy = actual.h / source.h;
if (Math.abs(sx / sy - 1) > 0.03) throw new Error("Ring en units zijn vervormd of bijgesneden.");
const markSize = Math.round(source.width * (sx + sy) / 2);
if (markSize / actual.width < 0.12 || markSize / actual.width > 0.65) throw new Error("Onjuiste schaal van het beeldmerk.");
const left = Math.round((actual.width - markSize) / 2), top = Math.round((actual.height - markSize) / 2);
const fg = await sharp(join(root, "resources/splash.png")).resize(markSize, markSize).toBuffer();
const expected = await sharp(join(root, "resources/splash-background.png")).resize(actual.width, actual.height, { fit: "cover" }).composite([{ input: fg, left, top }]).png().toBuffer();
async function difference(region) {
  const a = await sharp(screenshot).extract(region).resize(128, 128).removeAlpha().raw().toBuffer();
  const b = await sharp(expected).extract(region).resize(128, 128).removeAlpha().raw().toBuffer();
  let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
// Buiten de statusbalk/home-indicator: ook de schermranden moeten de kleurenafbeelding tonen.
const body = { left: 0, top: Math.round(actual.height * 0.12), width: actual.width, height: Math.floor(actual.height * 0.76) };
if (await difference(body) > 12) throw new Error("De blauwe achtergrond is niet schermvullend of heeft een verkeerde uitsnede.");
if (await difference({ left, top, width: markSize, height: markSize }) > 10) throw new Error("Het originele beeldmerk is gewijzigd, verkeerd geplaatst of heeft nog een vierkant icoonvlak.");
console.log(`Native schermvullende splash gecontroleerd: ${actual.width}×${actual.height}, origineel beeldmerk ${markSize}×${markSize}.`);
