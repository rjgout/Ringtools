#!/usr/bin/env node
// Controle van echte simulatorpixels, zodat een zwart scherm geen geslaagde capture is.
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const screenshot = process.argv[2];
if (!screenshot) throw new Error("Geef een echte simulatoropname op.");
const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
let left = width, right = -1, top = height, bottom = -1, background = 0, total = 0;
// Statusbalk, afgeronde schermhoeken en home-indicator buiten de vergelijking houden.
for (let y = Math.floor(height * 0.2); y < height * 0.8; y++) {
  for (let x = Math.floor(width * 0.1); x < width * 0.9; x++) {
    const i = (y * width + x) * channels;
    const isBackground = Math.abs(data[i] - 11) < 9 && Math.abs(data[i + 1] - 18) < 9 && Math.abs(data[i + 2] - 32) < 9;
    total++;
    if (isBackground) background++;
    else { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
}
if (background / total < 0.65 || right < left) throw new Error("De donkere Ringtools-splash is niet zichtbaar (zwart scherm/ander scherm).");
const w = right - left + 1, h = bottom - top + 1;
if (Math.abs(w / h - 1) > 0.03 || Math.abs((left + right) / 2 - width / 2) > width * 0.02 || Math.abs((top + bottom) / 2 - height / 2) > height * 0.02) throw new Error("Splashbeeld is niet vierkant/gecentreerd of wordt bijgesneden.");
if (w / width < 0.12 || w / width > 0.6) throw new Error("Splashbeeld heeft een onjuiste schaal.");
const actual = await sharp(screenshot).extract({ left, top, width: w, height: h }).resize(64, 64).removeAlpha().raw().toBuffer();
const expected = await sharp(join(root, "resources/icon.png")).resize(64, 64).removeAlpha().raw().toBuffer();
let difference = 0;
for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - expected[i]);
if (difference / actual.length > 12) throw new Error("De simulator toont niet het huidige Ringtools-beeldmerk.");
console.log(`Native splash gecontroleerd: ${width}×${height}, beeld ${w}×${h}, geen crop/placeholder.`);
