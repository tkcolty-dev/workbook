// Client-side scanner engine: load photo, perspective-correct with 4 corners, apply scan filters.

export async function fileToCanvas(file, maxDim = 2200) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const c = bitmapToCanvas(bmp, maxDim);
  bmp.close && bmp.close();
  return c;
}
export function bitmapToCanvas(src, maxDim = 2200) {
  const w = src.width || src.videoWidth, h = src.height || src.videoHeight;
  const s = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export function scaleCanvas(src, maxDim) {
  return bitmapToCanvas(src, maxDim);
}
export function toDataURL(canvas, quality = 0.9) { return canvas.toDataURL('image/jpeg', quality); }

export function rotateCanvas(src, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (!d) return src;
  const c = document.createElement('canvas');
  if (d === 90 || d === 270) { c.width = src.height; c.height = src.width; } else { c.width = src.width; c.height = src.height; }
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(d * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// Rotate corner fractions along with the image (clockwise degrees).
export function rotateCorners(corners, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (!d) return corners;
  const rot = (p) => ({ x: 1 - p.y, y: p.x }); // 90° clockwise in fraction space
  let c = { ...corners };
  for (let i = 0; i < d / 90; i++) {
    c = { tl: rot(c.bl), tr: rot(c.tl), br: rot(c.tr), bl: rot(c.br) };
  }
  return c;
}

export const FULL_CORNERS = () => ({ tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } });

// Perspective warp: corners as fractions {tl,tr,br,bl} of the source canvas.
export function warp(src, corners, maxDim = 2000) {
  const W = src.width, H = src.height;
  const P = [corners.tl, corners.tr, corners.br, corners.bl].map(p => ({ x: p.x * W, y: p.y * H }));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let outW = Math.round((dist(P[0], P[1]) + dist(P[3], P[2])) / 2);
  let outH = Math.round((dist(P[0], P[3]) + dist(P[1], P[2])) / 2);
  const s = Math.min(1, maxDim / Math.max(outW, outH));
  outW = Math.max(8, Math.round(outW * s)); outH = Math.max(8, Math.round(outH * s));

  // Full-frame fast path
  const isFull = P[0].x === 0 && P[0].y === 0 && P[1].x === W && P[1].y === 0 && P[2].x === W && P[2].y === H && P[3].x === 0 && P[3].y === H;
  if (isFull) return scaleCanvas(src, maxDim);

  // Square -> quad projective mapping (Heckbert)
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [P[0].x, P[0].y, P[1].x, P[1].y, P[2].x, P[2].y, P[3].x, P[3].y];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const sdata = sctx.getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(outW, outH);
  const od = oimg.data;
  for (let j = 0; j < outH; j++) {
    const v = (j + 0.5) / outH;
    for (let i = 0; i < outW; i++) {
      const u = (i + 0.5) / outW;
      const den = g * u + h * v + 1;
      const sx = (a * u + b * v + c) / den - 0.5;
      const sy = (d * u + e * v + f) / den - 0.5;
      const xi = Math.floor(sx), yi = Math.floor(sy);
      const fx = sx - xi, fy = sy - yi;
      const x0c = Math.min(W - 1, Math.max(0, xi)), x1c = Math.min(W - 1, Math.max(0, xi + 1));
      const y0c = Math.min(H - 1, Math.max(0, yi)), y1c = Math.min(H - 1, Math.max(0, yi + 1));
      const i00 = (y0c * W + x0c) * 4, i10 = (y0c * W + x1c) * 4, i01 = (y1c * W + x0c) * 4, i11 = (y1c * W + x1c) * 4;
      const o = (j * outW + i) * 4;
      for (let k = 0; k < 3; k++) {
        const top = sdata[i00 + k] * (1 - fx) + sdata[i10 + k] * fx;
        const bot = sdata[i01 + k] * (1 - fx) + sdata[i11 + k] * fx;
        od[o + k] = top * (1 - fy) + bot * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

// Estimate paper background per channel using block max-pool + blur, then normalize.
function backgroundMap(data, W, H) {
  const factor = Math.max(4, Math.ceil(Math.max(W, H) / 110));
  const bw = Math.ceil(W / factor), bh = Math.ceil(H / factor);
  const bg = new Float32Array(bw * bh * 3);
  // max-pool per block (paper is the brightest thing in a block)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let mr = 0, mg = 0, mb = 0;
    const x0 = bx * factor, y0 = by * factor, x1 = Math.min(W, x0 + factor), y1 = Math.min(H, y0 + factor);
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4;
      // use luminance to pick the brightest sample, then keep its rgb
      const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (l > mr * 0.299 + mg * 0.587 + mb * 0.114) { mr = data[i]; mg = data[i + 1]; mb = data[i + 2]; }
    }
    const o = (by * bw + bx) * 3; bg[o] = mr; bg[o + 1] = mg; bg[o + 2] = mb;
  }
  // 2 passes of 3x3 median-ish smoothing (use mean of neighbours but ignore very dark blocks)
  let cur = bg;
  for (let pass = 0; pass < 3; pass++) {
    const nxt = new Float32Array(cur.length);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = by + dy, xx = bx + dx;
        if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
        const o = (yy * bw + xx) * 3; sr += cur[o]; sg += cur[o + 1]; sb += cur[o + 2]; n++;
      }
      const o = (by * bw + bx) * 3;
      // bias toward brighter neighbours (paper), avoids dark text/lines pulling background down
      nxt[o] = Math.max(cur[o] * 0.5 + (sr / n) * 0.5, sr / n);
      nxt[o + 1] = Math.max(cur[o + 1] * 0.5 + (sg / n) * 0.5, sg / n);
      nxt[o + 2] = Math.max(cur[o + 2] * 0.5 + (sb / n) * 0.5, sb / n);
    }
    cur = nxt;
  }
  return { bg: cur, bw, bh, factor };
}

/**
 * mode: 'enhanced' (whitened color), 'color' (light touch), 'gray', 'bw', 'original'
 */
export function enhance(src, mode = 'enhanced') {
  if (mode === 'original') return src;
  const W = src.width, H = src.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const { bg, bw, bh, factor } = backgroundMap(d, W, H);
  const target = 250;
  const strength = mode === 'color' ? 0.7 : 1.0;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), wx = fx - x0;
      const i = (y * W + x) * 4;
      let lum = 0;
      for (let k = 0; k < 3; k++) {
        const b00 = bg[(y0 * bw + x0) * 3 + k], b10 = bg[(y0 * bw + x1) * 3 + k], b01 = bg[(y1 * bw + x0) * 3 + k], b11 = bg[(y1 * bw + x1) * 3 + k];
        const b = Math.max(40, (b00 * (1 - wx) + b10 * wx) * (1 - wy) + (b01 * (1 - wx) + b11 * wx) * wy);
        let v = d[i + k] * (target / b);
        v = d[i + k] + (v - d[i + k]) * strength;
        if (mode === 'enhanced' || mode === 'gray' || mode === 'bw') {
          // gentle contrast: push near-white to white, deepen ink
          v = v > 236 ? 255 : v < 60 ? v * 0.75 : v;
        }
        d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
        lum += d[i + k] * (k === 0 ? 0.299 : k === 1 ? 0.587 : 0.114);
      }
      if (mode === 'gray') { d[i] = d[i + 1] = d[i + 2] = lum; }
      else if (mode === 'bw') {
        // soft threshold for smooth edges
        const t = (lum - 140) / (215 - 140);
        const v = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function thumbnail(src, maxDim = 400) { return scaleCanvas(src, maxDim); }

// ---------- readability boost: blur detection, upscaling, sharpening ----------
// Blur score = variance of the Laplacian on a downscaled grayscale (higher = sharper).
export function blurScore(src) {
  const small = scaleCanvas(src, 700);
  const W = small.width, H = small.height;
  const d = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
    sum += lap; sum2 += lap * lap; n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}
// Upscale small images with high-quality resampling so text has enough pixels for the AI.
export function upscaleTo(src, minLong = 1800, maxLong = 2400) {
  const long = Math.max(src.width, src.height);
  if (long >= minLong) return src;
  const s = Math.min(maxLong / long, 3);
  const c = document.createElement('canvas'); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  // two-step upscale gives smoother edges than one big jump
  if (s > 2) { const mid = document.createElement('canvas'); mid.width = Math.round(src.width * 2); mid.height = Math.round(src.height * 2); const mctx = mid.getContext('2d'); mctx.imageSmoothingQuality = 'high'; mctx.drawImage(src, 0, 0, mid.width, mid.height); ctx.drawImage(mid, 0, 0, c.width, c.height); }
  else ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
// Unsharp mask: out = src + amount * (src - gaussianBlur(src)). radius ≈ 1.5px (5-tap), amount 0.6–1.6.
export function sharpen(src, amount = 1.0) {
  if (!amount) return src;
  const W = src.width, H = src.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, W, H); const d = img.data;
  const k = [1, 4, 6, 4, 1], ks = 16;
  const tmp = new Float32Array(W * H * 3), blur = new Float32Array(W * H * 3);
  // horizontal
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let t = -2; t <= 2; t++) { const xx = Math.min(W - 1, Math.max(0, x + t)); const i = (y * W + xx) * 4; const w = k[t + 2]; r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; }
    const o = (y * W + x) * 3; tmp[o] = r / ks; tmp[o + 1] = g / ks; tmp[o + 2] = b / ks;
  }
  // vertical
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let t = -2; t <= 2; t++) { const yy = Math.min(H - 1, Math.max(0, y + t)); const i = (yy * W + x) * 3; const w = k[t + 2]; r += tmp[i] * w; g += tmp[i + 1] * w; b += tmp[i + 2] * w; }
    const o = (y * W + x) * 3; blur[o] = r / ks; blur[o + 1] = g / ks; blur[o + 2] = b / ks;
  }
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const v = d[p + ch] + amount * (d[p + ch] - blur[o + ch]);
      d[p + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
