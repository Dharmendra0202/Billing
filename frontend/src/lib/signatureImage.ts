/**
 * Clean up an uploaded signature so it looks like a professional e-signature:
 * the paper becomes fully transparent and only the ink remains.
 *
 *  1. Draw the image on white (existing transparency counts as paper) and
 *     downscale very large photos.
 *  2. Estimate the paper colour and how the lighting varies across the photo
 *     (shadows, uneven light), so paper becomes pure white everywhere.
 *  3. "Colour to alpha" against white: the further a pixel is from white, the
 *     more opaque it becomes, and its true ink colour is recovered by
 *     un-blending it from the white paper. Strokes come out crisp, edges smooth.
 *  4. Crop to the ink, cap the size, and export as PNG (always readable by the
 *     PDF exporter, whatever format was uploaded).
 *
 * Resolves with a PNG data URL, or with the original data URL if anything fails.
 */
export async function makeSignatureTransparent(dataUrl: string): Promise<string> {
  // Rejects if the browser can't open the image at all (e.g. an iPhone HEIC file).
  const img = await loadImage(dataUrl);
  try {
    return processSignature(img) ?? dataUrl;
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load signature image"));
    img.src = src;
  });
}

const MAX_WORK_SIDE = 1600;      // processing resolution cap (px)
const MAX_OUT_W = 900;           // final size cap — plenty for print
const MAX_OUT_H = 360;
const ALPHA_LOW = 0.12;          // less "ink" than this → transparent (paper noise)
const ALPHA_HIGH = 0.40;         // more than this → fully opaque ink

function processSignature(img: HTMLImageElement): string | null {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return null;
  const k = Math.min(1, MAX_WORK_SIDE / Math.max(srcW, srcH));
  const W = Math.max(1, Math.round(srcW * k));
  const H = Math.max(1, Math.round(srcH * k));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const imageData = ctx.getImageData(0, 0, W, H);
  const px = imageData.data;
  const N = W * H;

  // Luminance of every pixel + a global histogram.
  const lum = new Uint8Array(N);
  const hist = new Uint32Array(256);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const l = ((px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000) | 0;
    lum[p] = l;
    hist[l]++;
  }
  const percentile = (h: Uint32Array, total: number, q: number): number => {
    const target = total * q;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= target) return v; }
    return 255;
  };

  // Paper colour = average colour of the brightest 10% of pixels.
  const p90 = percentile(hist, N, 0.9);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (lum[p] >= p90) { sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; sn++; }
  }
  const paperR = Math.max(1, sn ? sr / sn : 255);
  const paperG = Math.max(1, sn ? sg / sn : 255);
  const paperB = Math.max(1, sn ? sb / sn : 255);
  const paperL = Math.max(1, (paperR * 299 + paperG * 587 + paperB * 114) / 1000);

  // Lighting map: bright-percentile luminance per block, relative to the paper.
  // Clamped so a block crowded with ink is never mistaken for dark paper.
  const BS = Math.max(16, Math.round(Math.max(W, H) / 12));
  const bx = Math.ceil(W / BS);
  const by = Math.ceil(H / BS);
  const light = new Float32Array(bx * by);
  const bh = new Uint32Array(256);
  for (let j = 0; j < by; j++) {
    for (let q = 0; q < bx; q++) {
      bh.fill(0);
      const x0 = q * BS, y0 = j * BS;
      const x1 = Math.min(W, x0 + BS), y1 = Math.min(H, y0 + BS);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) bh[lum[y * W + x]]++;
      const v = percentile(bh, (x1 - x0) * (y1 - y0), 0.9);
      light[j * bx + q] = Math.min(1.25, Math.max(0.6, v / paperL));
    }
  }

  // Bilinear-interpolation weights for columns (rows are computed per row).
  const colQ0 = new Int32Array(W), colQ1 = new Int32Array(W), colT = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f = Math.min(Math.max((x + 0.5) / BS - 0.5, 0), bx - 1);
    const q0 = Math.floor(f);
    colQ0[x] = q0; colQ1[x] = Math.min(bx - 1, q0 + 1); colT[x] = f - q0;
  }

  // Per pixel: normalise by the local paper colour, then colour-to-alpha.
  const range = ALPHA_HIGH - ALPHA_LOW;
  const colMass = new Float64Array(W);
  const rowMass = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(Math.max((y + 0.5) / BS - 0.5, 0), by - 1);
    const j0 = Math.floor(fy), j1 = Math.min(by - 1, j0 + 1), ty = fy - j0;
    for (let x = 0; x < W; x++) {
      const q0 = colQ0[x], q1 = colQ1[x], tx = colT[x];
      const s =
        (light[j0 * bx + q0] * (1 - tx) + light[j0 * bx + q1] * tx) * (1 - ty) +
        (light[j1 * bx + q0] * (1 - tx) + light[j1 * bx + q1] * tx) * ty;
      const i = (y * W + x) * 4;
      const r = Math.min(255, (px[i] * 255) / (paperR * s));
      const g = Math.min(255, (px[i + 1] * 255) / (paperG * s));
      const b = Math.min(255, (px[i + 2] * 255) / (paperB * s));
      const a = Math.max(255 - r, 255 - g, 255 - b) / 255; // distance from white
      const alpha = (a - ALPHA_LOW) / range;
      if (alpha <= 0) { px[i + 3] = 0; continue; }
      const A = alpha >= 1 ? 1 : alpha;
      // Un-blend from white to get the real ink colour (crisp, not washed out).
      px[i] = 255 - (255 - r) / a;
      px[i + 1] = 255 - (255 - g) / a;
      px[i + 2] = 255 - (255 - b) / a;
      px[i + 3] = Math.round(A * 255);
      colMass[x] += A;
      rowMass[y] += A;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Crop to the ink. A tiny share of "ink mass" at each edge is ignored so a
  // stray speck in a corner doesn't stretch the crop.
  const span = (mass: Float64Array): [number, number] | null => {
    let total = 0;
    for (let v = 0; v < mass.length; v++) total += mass[v];
    if (total < 1) return null;
    const cut = total * 0.002;
    let lo = 0, acc = 0;
    while (lo < mass.length - 1 && acc + mass[lo] < cut) acc += mass[lo++];
    let hi = mass.length - 1;
    acc = 0;
    while (hi > lo && acc + mass[hi] < cut) acc += mass[hi--];
    return [lo, hi];
  };
  const sx = span(colMass);
  const sy = span(rowMass);
  if (!sx || !sy) return canvas.toDataURL("image/png"); // nothing that looks like ink

  const pad = Math.round(Math.max(sx[1] - sx[0], sy[1] - sy[0]) * 0.03) + 2;
  const cx0 = Math.max(0, sx[0] - pad), cy0 = Math.max(0, sy[0] - pad);
  const cx1 = Math.min(W - 1, sx[1] + pad), cy1 = Math.min(H - 1, sy[1] + pad);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const scale = Math.min(1, MAX_OUT_W / cw, MAX_OUT_H / ch);

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw * scale));
  out.height = Math.max(1, Math.round(ch * scale));
  const octx = out.getContext("2d");
  if (!octx) return canvas.toDataURL("image/png");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(canvas, cx0, cy0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
