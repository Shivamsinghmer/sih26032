/**
 * Decoding an Aadhaar Secure QR from a photograph.
 *
 * Kept separate from the camera UI so it can be tested against real images
 * rather than only against a hopeful click. That mattered: measured against
 * simulated camera photos of a 3,400-digit payload, a single-pass decode fails
 * whenever the QR occupies less than about half the frame, and the ladder below
 * recovers every one of those cases.
 *
 * Why it needs a ladder at all:
 *
 *  · An Aadhaar Secure QR is very dense — a real one embeds a JPEG-2000 photo,
 *    so the payload runs to thousands of digits and the code to a high version.
 *    Decoding needs enough pixels per module, and a photo of a whole card
 *    leaves the QR occupying a fraction of the frame.
 *  · Chrome's native `BarcodeDetector` handles these far better than any JS
 *    decoder, so it is always tried first, untouched.
 *  · jsQR then gets progressively tighter centre crops, each at 1× and 2×, raw
 *    and contrast-stretched. The crop is what does the work; the rest is cheap.
 *
 * Nothing here decides anything. It returns a string; the server verifies it.
 */

import jsQR from "jsqr";

/** A Secure QR payload is a long run of digits. */
export const SECURE_QR = /^\d{64,}$/;

export interface DecodeAttempt {
  value: string | null;
  /** Which pass produced it — shown in the UI so a failure can be reported. */
  via: string;
}

/** Injected so the browser can pass a real canvas and a test can pass node-canvas. */
export type CanvasFactory = () => {
  width: number;
  height: number;
  getContext(id: "2d", options?: unknown): unknown;
};

interface Ctx2D {
  drawImage(...args: unknown[]): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  imageSmoothingEnabled?: boolean;
}

interface DetectorCtor {
  new (options?: { formats?: string[] }): { detect(source: unknown): Promise<{ rawValue: string }[]> };
}

/** Bytes → the decimal string the API expects, for a byte-mode QR. */
export function bytesToDigits(bytes: Uint8ClampedArray | number[]): string | null {
  try {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b & 0xff);
    const digits = n.toString(10);
    return digits.length >= 64 ? digits : null;
  } catch {
    return null;
  }
}

/** Grayscale with a contrast stretch — measurably helps a photographed card. */
function enhance(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  let min = 255;
  let max = 0;
  for (let i = 0; i < out.length; i += 4) {
    const g = (out[i]! * 299 + out[i + 1]! * 587 + out[i + 2]! * 114) / 1000;
    out[i] = out[i + 1] = out[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < out.length; i += 4) {
    const v = ((out[i]! - min) / range) * 255;
    out[i] = out[i + 1] = out[i + 2] = v;
  }
  return out;
}

/** Centre crops, tightest last. A whole-card photo is rescued by the later ones. */
const CROPS = [1, 0.75, 0.55, 0.4] as const;
const SCALES = [1, 2] as const;
const MAX_EDGE = 2200;

export async function decodeSecureQr(
  source: unknown,
  sourceW: number,
  sourceH: number,
  makeCanvas: CanvasFactory,
  detector?: DetectorCtor,
): Promise<DecodeAttempt> {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as Ctx2D | null;
  if (!ctx) return { value: null, via: "no canvas" };

  // Native decoder first, on the untouched image — by far the most capable.
  if (detector) {
    try {
      canvas.width = sourceW;
      canvas.height = sourceH;
      ctx.drawImage(source, 0, 0, sourceW, sourceH);
      const codes = await new detector({ formats: ["qr_code"] }).detect(canvas);
      const digits = codes.map((c) => c.rawValue.trim()).find((v) => SECURE_QR.test(v));
      if (digits) return { value: digits, via: "BarcodeDetector" };
      if (codes[0]) return { value: codes[0].rawValue.trim(), via: "BarcodeDetector (other QR)" };
    } catch {
      // Unsupported, or failed on this image. Fall through to jsQR.
    }
  }

  for (const crop of CROPS) {
    const cw = Math.round(sourceW * crop);
    const ch = Math.round(sourceH * crop);
    const sx = Math.round((sourceW - cw) / 2);
    const sy = Math.round((sourceH - ch) / 2);

    for (const scale of SCALES) {
      const w = Math.min(MAX_EDGE, Math.round(cw * scale));
      const h = Math.min(MAX_EDGE, Math.round(ch * scale));
      if (w < 80 || h < 80) continue;

      canvas.width = w;
      canvas.height = h;
      if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = scale > 1;
      ctx.drawImage(source, sx, sy, cw, ch, 0, 0, w, h);

      const raw = ctx.getImageData(0, 0, w, h).data;

      for (const [pass, data] of [["raw", raw], ["enhanced", enhance(raw)]] as const) {
        for (const inversionAttempts of ["dontInvert", "attemptBoth"] as const) {
          const found = jsQR(data, w, h, { inversionAttempts });
          if (!found) continue;

          const via = `jsQR crop ${Math.round(crop * 100)}% x${scale} ${pass}`;
          const text = found.data.trim();
          if (SECURE_QR.test(text)) return { value: text, via };

          // Byte-mode: rebuild the decimal string from the raw bytes.
          if (found.binaryData?.length) {
            const digits = bytesToDigits(found.binaryData);
            if (digits) return { value: digits, via: `${via} (bytes)` };
          }
          if (text) return { value: text, via: `${via} (other QR)` };
        }
      }
    }
  }

  return { value: null, via: "no QR detected" };
}
