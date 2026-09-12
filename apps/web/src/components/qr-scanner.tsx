/**
 * Camera capture for the Aadhaar Secure QR.
 *
 * Reading an Aadhaar Secure QR is genuinely hard, and this file is shaped by
 * the ways it fails rather than by the happy path:
 *
 *  · It is a very high-version, very dense QR. jsQR — a pure-JS decoder — often
 *    cannot read one at all, while Chrome's native `BarcodeDetector` usually
 *    can. So the native detector is always tried first.
 *  · A live video frame is lower resolution than the sensor can produce and
 *    usually slightly motion-blurred, which is why this captures a still and
 *    decodes that rather than scanning continuously.
 *  · A photo of a whole card leaves the QR occupying a small part of the frame,
 *    so there are too few pixels per module. Each capture is therefore retried
 *    against several crops and scales, not just the raw image.
 *  · The payload is a decimal digit string, but a decoder can hand it back as
 *    bytes instead. Both are handled.
 *
 * When it still fails, it says exactly what it saw. A scanner that only says
 * "not found" cannot be diagnosed from a field report.
 *
 * Nothing is decided here: this reads a string and hands it up. Verification
 * happens on the server, because a client that verifies its own Aadhaar is not
 * a check.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui.js";
import { decodeSecureQr, SECURE_QR, type DecodeAttempt } from "../lib/qr-decode.js";

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): { detect(source: unknown): Promise<{ rawValue: string }[]> };
    };
  }
}

type Mode = "idle" | "starting" | "live" | "blocked";

export function QrScanner({ onResult }: { onResult: (payload: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** What the last decode actually saw. Shown so a failure can be reported. */
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [nativeAvailable] = useState(() => Boolean(window.BarcodeDetector));

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMode("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const handle = useCallback(
    (attempt: DecodeAttempt, captured: { w: number; h: number }) => {
      setDiagnostic(
        `${captured.w}×${captured.h} · ${attempt.via}` +
          (attempt.value ? ` · ${attempt.value.length} chars, starts "${attempt.value.slice(0, 12)}"` : ""),
      );

      if (attempt.value && SECURE_QR.test(attempt.value)) {
        stop();
        onResult(attempt.value);
        return;
      }
      if (attempt.value) {
        // Very often the SMALL qr on an older Aadhaar letter, which is plain
        // text and unsigned — not the Secure QR at all.
        setNote(
          "A QR was read, but it is not the Aadhaar Secure QR. Many Aadhaar cards and letters carry " +
            "two codes: a small one holding plain text, and the large Secure QR. Use the LARGE one.",
        );
        return;
      }
      setNote(
        "No QR found in that image. Move so the QR alone fills most of the frame, make sure it is sharp and evenly lit, " +
          "and capture again.",
      );
    },
    [onResult, stop],
  );

  const openCamera = useCallback(async () => {
    setNote(null);
    setDiagnostic(null);

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
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setMode("live");
      setNote("Fill the frame with the QR square alone — not the whole card — then press Capture.");
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      setMode("blocked");
      setNote(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera permission was refused. Use “Take a photo”, or paste the digits below."
          : name === "NotFoundError"
            ? "No camera found on this device. Use “Take a photo”, or paste the digits below."
            : "The camera could not be started. Use “Take a photo”, or paste the digits below.",
      );
    }
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const scratch = scratchRef.current;
    if (!video || !scratch || video.readyState < video.HAVE_CURRENT_DATA) return;

    setBusy(true);
    setNote(null);
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;

      // Keep the still visible, so it is obvious whether the photo was sharp.
      const preview = previewRef.current;
      if (preview) {
        preview.width = w;
        preview.height = h;
        preview.getContext("2d")?.drawImage(video, 0, 0, w, h);
      }

      handle(
        await decodeSecureQr(video, w, h, () => scratch, window.BarcodeDetector),
        { w, h },
      );
    } finally {
      setBusy(false);
    }
  }, [handle]);

  const fromFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setNote(null);
      try {
        const bitmap = await createImageBitmap(file);
        const scratch = scratchRef.current;
        if (!scratch) return;

        const preview = previewRef.current;
        if (preview) {
          preview.width = bitmap.width;
          preview.height = bitmap.height;
          preview.getContext("2d")?.drawImage(bitmap, 0, 0);
        }

        handle(
          await decodeSecureQr(bitmap, bitmap.width, bitmap.height, () => scratch, window.BarcodeDetector),
          { w: bitmap.width, h: bitmap.height },
        );
        bitmap.close();
      } catch {
        setNote("That image could not be opened. Try another photo, or paste the digits below.");
      } finally {
        setBusy(false);
      }
    },
    [handle],
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

        {/* The native camera app, or an existing photo. Highest resolution and
            real autofocus, which is usually what decides a dense QR. */}
        <label className="transition-notion cursor-pointer rounded-button bg-sky-tint px-[15px] py-2 text-body-sm font-medium text-notion-blue hover:opacity-90">
          Take a photo / choose image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void fromFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {(mode === "live" || mode === "starting") && (
        <div className="relative mt-3 overflow-hidden rounded-card border border-hairline bg-ink-black">
          <video ref={videoRef} playsInline muted className="block max-h-[60vh] w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 grid place-content-center">
            <div className="size-56 rounded-card border-2 border-pure-white/80" />
          </div>
        </div>
      )}

      {/* The captured still. Seeing it is how you tell a blurred photo from a
          decoder that simply could not read a sharp one. */}
      <canvas
        ref={previewRef}
        className={`mt-3 max-h-64 w-full rounded-card border border-hairline object-contain ${diagnostic ? "" : "hidden"}`}
      />
      <canvas ref={scratchRef} className="hidden" />

      {note && <p className="mt-3 rounded-small bg-paper-warmth px-3 py-2 text-body-sm">{note}</p>}

      {diagnostic && (
        <p className="mt-2 font-mono text-caption text-stone">
          {diagnostic}
          {!nativeAvailable && " · no native QR decoder in this browser (Chrome reads dense codes best)"}
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-body-sm text-notion-blue">It still will not read</summary>
        <div className="mt-2 space-y-3 text-body-sm text-graphite">
          <p>
            The Aadhaar Secure QR <strong>is</strong> an ordinary QR code, but a very dense one — it
            carries a few thousand characters including a photo. Everyday QR apps often fail on it, or
            read it and then show nothing because the contents are a long number rather than a link.
            That is why UIDAI publishes its own scanner. It is not that the code is special; it is that
            it is big.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Use the <strong>large</strong> QR. Older cards and letters also carry a small one that
              holds plain text and is not signed — that one cannot verify anything.
            </li>
            <li>Photograph the <strong>QR square alone</strong>, close up — not the whole card.</li>
            <li>Prefer “Take a photo”: the phone camera app focuses properly, the in-page one often does not.</li>
            <li>Avoid glare on laminated cards — angle away from the light rather than using flash.</li>
            <li>On a desktop, use Chrome: it has a native QR decoder that handles dense codes far better.</li>
            <li>
              A cleaner source beats a better camera: open your e-Aadhaar PDF, zoom the QR on screen,
              and photograph or screenshot that.
            </li>
          </ul>
          <p>
            <strong>If any QR app shows you a very long number, that is the payload.</strong> Copy it
            and paste it below — that path always works, and the verification happens on our server
            either way.
          </p>
        </div>
      </details>
    </div>
  );
}
