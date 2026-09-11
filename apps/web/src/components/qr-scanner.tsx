/**
 * Camera capture for the Aadhaar Secure QR.
 *
 * **Capture-then-decode, not continuous scanning.** The first version decoded
 * every animation frame and did not work: an Aadhaar Secure QR is a very dense
 * code, and a live `<video>` frame is both lower resolution than the sensor can
 * produce and usually slightly motion-blurred. Decoding a still the farmer
 * chose, at full capture resolution, succeeds where a stream of frames does not
 * — and it also stops the camera running hot while someone lines up the card.
 *
 * Three ways in, in the order most likely to work:
 *   1. **Take a photo** with the device's own camera app (`capture="environment"`).
 *      Highest resolution by far, and the native app handles focus, which is the
 *      thing that actually decides whether a dense QR decodes.
 *   2. **In-page camera**, then an explicit Capture button.
 *   3. **Paste** the digits, for a desktop or a refused permission.
 *
 * Nothing is decided here. This reads the digit string and hands it up;
 * verification happens on the server, because a client that verifies its own
 * Aadhaar is not a check.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "./ui.js";

/** Chrome's BarcodeDetector, which TypeScript's DOM lib does not know about. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

/** A Secure QR payload is a long run of digits and nothing else. */
const SECURE_QR = /^\d{64,}$/;

type Mode = "idle" | "starting" | "live" | "blocked";

/**
 * Decodes one still image.
 *
 * BarcodeDetector first where it exists — it is far better at dense codes than
 * a JS decoder. jsQR then gets two passes, because a photographed card is
 * sometimes light-on-dark depending on the surface and the flash.
 */
async function decode(canvas: HTMLCanvasElement): Promise<string | null> {
  if (window.BarcodeDetector) {
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const codes = await detector.detect(canvas);
      const hit = codes.map((c) => c.rawValue.trim()).find((v) => SECURE_QR.test(v));
      if (hit) return hit;
      if (codes.length > 0) return codes[0]!.rawValue.trim();
    } catch {
      // Detector unavailable or failed on this image; fall through to jsQR.
    }
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  for (const inversionAttempts of ["dontInvert", "attemptBoth"] as const) {
    const found = jsQR(image.data, canvas.width, canvas.height, { inversionAttempts });
    if (found?.data) return found.data.trim();
  }
  return null;
}

export function QrScanner({ onResult }: { onResult: (payload: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMode("idle");
  }, []);

  // Never leave the camera running if the farmer navigates away. On a shared
  // phone an unreleased camera is alarming as well as a battery drain.
  useEffect(() => stop, [stop]);

  const openCamera = useCallback(async () => {
    setNote(null);
    setAttempts(0);

    if (!navigator.mediaDevices?.getUserMedia) {
      setMode("blocked");
      setNote("This browser cannot open the camera. Use “Take a photo” or paste the digits below.");
      return;
    }

    setMode("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // Ask for as much as the sensor will give: resolution is what decides
          // whether a dense QR decodes at all.
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setMode("live");
      setNote("Fill the frame with the QR, hold steady until it looks sharp, then press Capture.");
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      setMode("blocked");
      if (name === "NotAllowedError" || name === "SecurityError") {
        setNote("Camera permission was refused. Use “Take a photo”, or paste the digits below.");
      } else if (name === "NotFoundError") {
        setNote("No camera found on this device. Paste the digits below.");
      } else {
        setNote("The camera could not be started. Use “Take a photo”, or paste the digits below.");
      }
    }
  }, []);

  /** Grabs one still from the live preview and decodes it. */
  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_CURRENT_DATA) return;

    setBusy(true);
    setNote(null);
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

      const found = await decode(canvas);
      setAttempts((a) => a + 1);

      if (found && SECURE_QR.test(found)) {
        stop();
        onResult(found);
        return;
      }
      if (found) {
        setNote("That is a QR code, but not an Aadhaar Secure QR. Use the QR on the BACK of the card.");
        return;
      }
      setNote(
        "No QR found in that photo. Move closer so the code fills the frame, hold still, and make sure it is in focus — then capture again.",
      );
    } finally {
      setBusy(false);
    }
  }, [onResult, stop]);

  /** Decodes a photo taken with the device's own camera app, or picked from the gallery. */
  const fromFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setNote(null);
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();

        const found = await decode(canvas);
        setAttempts((a) => a + 1);

        if (found && SECURE_QR.test(found)) {
          stop();
          onResult(found);
          return;
        }
        setNote(
          found
            ? "That is a QR code, but not an Aadhaar Secure QR. Use the QR on the BACK of the card."
            : "No QR found in that photo. Take it closer and in focus, with the whole code visible.",
        );
      } catch {
        setNote("That image could not be read. Try another photo, or paste the digits below.");
      } finally {
        setBusy(false);
      }
    },
    [onResult, stop],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {mode === "live" ? (
          <>
            <Button onClick={() => void capture()} disabled={busy}>
              {busy ? "Reading…" : "Capture"}
            </Button>
            <Button variant="ghost" onClick={stop}>Close camera</Button>
          </>
        ) : (
          <Button onClick={() => void openCamera()} disabled={mode === "starting"}>
            {mode === "starting" ? "Opening camera…" : "Open camera"}
          </Button>
        )}

        {/* The native camera app: highest resolution and real autofocus, which
            is usually what makes a dense Aadhaar QR decode. */}
        <label className="transition-notion cursor-pointer rounded-button bg-sky-tint px-[15px] py-2 text-body-sm font-medium text-notion-blue hover:opacity-90">
          Take a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void fromFile(file);
              // Reset, so picking the same file twice still fires a change.
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {(mode === "live" || mode === "starting") && (
        <div className="mt-3">
          <div className="relative overflow-hidden rounded-card border border-hairline bg-ink-black">
            <video ref={videoRef} playsInline muted className="block max-h-[60vh] w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 grid place-content-center">
              <div className="size-56 rounded-card border-2 border-pure-white/80" />
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {note && (
        <p className="mt-3 rounded-small bg-paper-warmth px-3 py-2 text-body-sm">
          {note}
          {attempts >= 2 && (
            <span className="mt-1 block text-caption text-stone">
              Still not reading? The Aadhaar QR is dense — “Take a photo” usually works better than
              the in-page camera, or paste the digits below.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
