// De kleurenachtergrond is apart; alle zichtbare embleempixels komen uit het originele icoon.
import sharp from "sharp";
export async function originalEmblem(icon) {
  const { data, info } = await sharp(icon).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h, bright = new Uint8Array(n), outside = new Uint8Array(n), queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    bright[i] = ((r > 160 && g > 160 && b > 160) || (r > 180 && g > 90 && b < 170)) ? 1 : 0;
  }
  // Alleen buiten de gesloten witte/gouden contouren transparant maken; de
  // oorspronkelijke blauwe binnenvlakken, personen, ringen en verbindingen blijven behouden.
  let head = 0, tail = 0;
  const visit = i => { if (!outside[i] && !bright[i]) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % w;
    if (x) visit(i - 1); if (x + 1 < w) visit(i + 1);
    if (i >= w) visit(i - w); if (i + w < n) visit(i + w);
  }
  // Twee bronpixels marge behouden ook de oorspronkelijke anti-aliasranden.
  const alpha = Buffer.alloc(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (outside[y * w + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) alpha[(y + dy) * w + x + dx] = 255;
    }
  }
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i];
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
