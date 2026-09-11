/**
 * Regression tests for Aadhaar Secure QR decoding, against rendered images
 * rather than a hopeful click.
 *
 * These exist because the first two attempts at the scanner did not work in the
 * field and there was no way to tell why. The failure mode is specific and
 * measurable: a single-pass decode fails once the QR occupies less than about
 * half the frame, which is exactly what a photo of a whole Aadhaar card looks
 * like.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { createCanvas, loadImage, type Canvas } from "canvas";
import jsQR from "jsqr";
import { decodeSecureQr, bytesToDigits, SECURE_QR, type CanvasFactory } from "./qr-decode.js";

/** A payload the size of a real Aadhaar Secure QR, which embeds a photo. */
function payload(digits: number): string {
  let s = "";
  let seed = 12345;
  while (s.length < digits) {
    // Deterministic, so a failure is reproducible.
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    s += String(seed).padStart(10, "0");
  }
  return s.slice(0, digits);
}

/** Renders the QR inside a larger frame, as a camera would photograph a card. */
async function photograph(
  data: string,
  frameW: number,
  frameH: number,
  fill: number,
  blurPx = 0,
): Promise<Canvas> {
  const url = await QRCode.toDataURL(data, { errorCorrectionLevel: "L", margin: 2, width: 1400 });
  const img = await loadImage(url);
  const canvas = createCanvas(frameW, frameH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cfcfcf"; // the card around the code
  ctx.fillRect(0, 0, frameW, frameH);
  const size = Math.round(Math.min(frameW, frameH) * fill);
  if (blurPx) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(img, (frameW - size) / 2, (frameH - size) / 2, size, size);
  return canvas;
}

const makeCanvas: CanvasFactory = () => createCanvas(10, 10) as unknown as ReturnType<CanvasFactory>;

/** What a naive single-pass scanner would do. */
function singlePass(canvas: Canvas, expected: string): boolean {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })?.data === expected;
}

describe("Secure QR decoding", () => {
  test("decodes a realistic Aadhaar-sized payload", async () => {
    const data = payload(3400);
    const photo = await photograph(data, 1920, 1080, 0.85);
    const result = await decodeSecureQr(photo, photo.width, photo.height, makeCanvas);
    assert.equal(result.value, data);
  });

  test("decodes the largest payload a Secure QR carries", async () => {
    const data = payload(4500);
    const photo = await photograph(data, 1920, 1080, 0.8);
    const result = await decodeSecureQr(photo, photo.width, photo.height, makeCanvas);
    assert.equal(result.value, data);
  });

  test("recovers a small QR in the frame, where a single pass fails", async () => {
    // The whole reason the crop ladder exists — a photo of the whole card.
    const data = payload(3400);
    const photo = await photograph(data, 1280, 720, 0.3);

    assert.equal(singlePass(photo, data), false, "single pass should fail here, or this test proves nothing");

    const result = await decodeSecureQr(photo, photo.width, photo.height, makeCanvas);
    assert.equal(result.value, data);
    assert.match(result.via, /crop/);
  });

  test("survives a slightly out-of-focus photo", async () => {
    const data = payload(3400);
    const photo = await photograph(data, 1920, 1080, 0.5, 2);
    const result = await decodeSecureQr(photo, photo.width, photo.height, makeCanvas);
    assert.equal(result.value, data);
  });

  test("reports that nothing was found rather than throwing", async () => {
    const blank = createCanvas(640, 480);
    const ctx = blank.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 640, 480);

    const result = await decodeSecureQr(blank, 640, 480, makeCanvas);
    assert.equal(result.value, null);
    assert.equal(result.via, "no QR detected");
  });

  test("a non-Aadhaar QR comes back labelled, not silently accepted", async () => {
    const url = await QRCode.toDataURL("https://example.com", { margin: 2, width: 600 });
    const img = await loadImage(url);
    const canvas = createCanvas(600, 600);
    canvas.getContext("2d").drawImage(img, 0, 0, 600, 600);

    const result = await decodeSecureQr(canvas, 600, 600, makeCanvas);
    assert.equal(result.value, "https://example.com");
    assert.match(result.via, /other QR/);
    assert.equal(SECURE_QR.test(result.value!), false);
  });

  test("prefers the native detector when one is available", async () => {
    const data = payload(2000);
    const photo = await photograph(data, 1280, 720, 0.8);

    // A stand-in for Chrome's BarcodeDetector.
    class FakeDetector {
      async detect() {
        return [{ rawValue: data }];
      }
    }

    const result = await decodeSecureQr(photo, photo.width, photo.height, makeCanvas, FakeDetector as never);
    assert.equal(result.value, data);
    assert.equal(result.via, "BarcodeDetector");
  });
});

describe("byte-mode payloads", () => {
  test("rebuilds the decimal string from raw bytes", () => {
    // 0x01 0x02 0x03 -> 66051, padded out past the length floor.
    const long = new Uint8ClampedArray(40).fill(0xab);
    const digits = bytesToDigits(long);
    assert.ok(digits && digits.length >= 64);
    assert.match(digits!, /^\d+$/);
  });

  test("rejects something too short to be a payload", () => {
    assert.equal(bytesToDigits([1, 2, 3]), null);
  });
});
