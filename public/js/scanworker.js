// Scan pipeline off the main thread: warp → upscale → enhance → sharpen → JPEG blobs.
// imageproc.js only needs a `document.createElement('canvas')`; in a worker that becomes an OffscreenCanvas.
globalThis.document = { createElement: () => new OffscreenCanvas(1, 1) };
import { warp, enhance, sharpen, upscaleTo, thumbnail, blurScore, scaleCanvas } from './imageproc.js';

const SHARPEN_AMOUNT = [0, 0.7, 1.4];
self.onmessage = async ({ data }) => {
  const { id, bitmap, corners, filter, boost } = data;
  try {
    const src = new OffscreenCanvas(bitmap.width, bitmap.height);
    src.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
    const score = blurScore(src); const blurry = score < 120;
    const boostLevel = boost === 0 ? 0 : boost === 2 ? 2 : (blurry ? 2 : 1);
    let warped = warp(src, corners, 2400);
    if (boostLevel) warped = upscaleTo(warped, boostLevel === 2 ? 2000 : 1600, 2400);
    let enhanced = enhance(warped, filter);
    if (boostLevel) enhanced = sharpen(enhanced, SHARPEN_AMOUNT[boostLevel]);
    const [enh, orig, thumb] = await Promise.all([
      enhanced.convertToBlob({ type: 'image/jpeg', quality: 0.9 }),
      scaleCanvas(src, 1600).convertToBlob({ type: 'image/jpeg', quality: 0.8 }),
      thumbnail(enhanced, 420).convertToBlob({ type: 'image/jpeg', quality: 0.8 }),
    ]);
    self.postMessage({ id, enhanced: enh, original: orig, thumb, blurry });
  } catch (e) { self.postMessage({ id, error: e.message || String(e) }); }
};
