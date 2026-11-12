import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { originalEmblem } from "./splash-art.mjs";
const icon = await readFile(new URL("../resources/icon.png", import.meta.url));
const { data: source, info } = await sharp(icon).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const image = await originalEmblem(icon);
const result = await sharp(image).raw().toBuffer();
test("het vierkante icoonvlak verdwijnt; alle behouden pixels blijven exact origineel", () => {
  assert.equal(result[3], 0); assert.equal(result[(info.width * info.height - 1) * 4 + 3], 0);
  let opaque = 0;
  for (let i = 0; i < info.width * info.height; i++) if (result[i * 4 + 3]) {
    opaque++;
    assert.deepEqual(result.subarray(i * 4, i * 4 + 3), source.subarray(i * 3, i * 3 + 3));
  }
  assert(opaque > info.width * info.height * 0.3 && opaque < info.width * info.height * 0.8);
});
test("de donkere binnenvlakken van de ring en alle zeven units blijven behouden", () => {
  for (const [x,y] of [[512,70],[234,206],[786,206],[166,500],[860,500],[326,750],[694,750],[512,385]]) assert.equal(result[(y * info.width + x) * 4 + 3], 255);
});
