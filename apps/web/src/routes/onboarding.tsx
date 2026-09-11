/**
 * The registration gates.
 *
 * Registration is a continuation of signing up, not a section of the dashboard,
 * so this layout composes like the sign-in pages — centred, no panel nav. It
 * keeps a way out, because with the gate mandatory that is the only escape for
 * someone who cannot finish right now.
 */

import { lazy, Suspense, useState } from "react";
import { Link, Navigate, Outlet } from "react-router";
import { LOCALES, type Locale } from "@mandi/shared";
import { useMe, homeFor } from "../auth/session.js";
import { Card } from "../components/page.js";
import { Button } from "../components/ui.js";
import { useOnboard, useVerifyAadhaar } from "../lib/hooks.js";
import { LOCALE_NAMES } from "../lib/i18n.js";
/**
 * The scanner pulls in a QR decoder, and is used exactly once in a farmer's
 * life. Loading it on demand keeps it out of the bundle every other screen
 * pays for — which matters on the connection this app is designed for.
 */
const QrScanner = lazy(() =>
  import("../components/qr-scanner.js").then((m) => ({ default: m.QrScanner })),
);

export function OnboardingLayout() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[620px] content-center gap-6 px-6 py-16">
      <Link to="/" className="text-heading-sm font-semibold tracking-[-0.011em]">
        Mandi<span className="text-notion-blue">Queue</span>
      </Link>
      <Outlet />
    </main>
  );
}

function Field({
  label, value, onChange, placeholder, hint, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-body-sm font-medium">{label}</span>
      {hint && <span className="block text-caption text-stone">{hint}</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-button border border-hairline bg-pure-white px-3 py-2 text-body"
      />
    </label>
  );
}

/* ------------------------------------------------------- step 1 · profile */

export function OnboardingProfile() {
  const me = useMe();
  const onboard = useOnboard();

  const [form, setForm] = useState({
    name: "", village: "", district: "", state: "Punjab", email: "", landAcres: "",
  });
  const [locale, setLocale] = useState<Locale>("pa");

  // Already past this gate: do not make them fill it again.
  if (me.gates.hasProfile) {
    return <Navigate to={me.gates.aadhaarVerified ? homeFor(me.role) : "/onboarding/verify"} replace />;
  }

  const acres = Number(form.landAcres);
  const ready = form.name.trim().length >= 2 && form.village.trim() && form.district.trim() && form.state.trim();

  function submit() {
    if (!ready) return;
    onboard.mutate({
      name: form.name.trim(),
      village: form.village.trim(),
      district: form.district.trim(),
      state: form.state.trim(),
      preferredLocale: locale,
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(Number.isFinite(acres) && acres > 0 ? { landAcres: acres } : {}),
    });
  }

  return (
    <Card>
      <p className="text-caption font-medium uppercase tracking-[0.01em] text-stone">Step 1 of 2</p>
      <h1 className="mt-2 text-heading-sm font-semibold">Tell us where you farm</h1>
      <p className="mt-2 text-body text-graphite">
        Your phone number comes from the account you just verified — we never ask you to type it again.
      </p>

      <div className="mt-5 space-y-3">
        <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Balwinder Singh" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Village" value={form.village} onChange={(v) => setForm({ ...form, village: v })} placeholder="Longowal" />
          <Field label="District" value={form.district} onChange={(v) => setForm({ ...form, district: v })} placeholder="Sangrur" />
        </div>
        <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />

        <Field
          label="Land held (acres)"
          hint="Optional. Verified acreage is what caps how much you may sell at MSP."
          value={form.landAcres}
          onChange={(v) => setForm({ ...form, landAcres: v })}
          placeholder="4.5"
          type="number"
        />

        {/* Prototype channel. Declared as such rather than presented as the
            real one — production notifications go by SMS to the phone above. */}
        <Field
          label="Email for notifications"
          hint="Prototype only. In production these messages are sent by SMS to your phone."
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          placeholder="you@example.com"
          type="email"
        />

        <fieldset>
          <legend className="text-body-sm font-medium">Language</legend>
          <span className="block text-caption text-stone">
            Used for this app and for every message we send you.
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={`transition-notion rounded-button border px-4 py-2 text-body-sm ${
                  locale === l ? "border-notion-blue bg-sky-tint text-notion-blue" : "border-hairline hover:bg-paper-warmth"
                }`}
              >
                {LOCALE_NAMES[l]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-5">
        <Button onClick={submit} disabled={!ready || onboard.isPending} full>
          {onboard.isPending ? "Saving…" : "Continue"}
        </Button>
      </div>

      {onboard.isError && (
        <p className="mt-3 rounded-small bg-coral/10 px-3 py-2 text-body-sm">
          {onboard.error.message}
          {onboard.error.fields &&
            Object.entries(onboard.error.fields).map(([k, v]) => (
              <span key={k} className="mt-1 block text-caption">{k}: {v}</span>
            ))}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------- step 2 · Aadhaar */

export function OnboardingVerify() {
  const me = useMe();
  const verify = useVerifyAadhaar();
  const [payload, setPayload] = useState("");

  if (!me.gates.hasProfile) return <Navigate to="/onboarding" replace />;
  if (me.gates.aadhaarVerified) return <Navigate to={homeFor(me.role)} replace />;

  const result = verify.data;

  return (
    <Card>
      <p className="text-caption font-medium uppercase tracking-[0.01em] text-stone">Step 2 of 2</p>
      <h1 className="mt-2 text-heading-sm font-semibold">Scan the QR on your Aadhaar card</h1>
      <p className="mt-2 text-body text-graphite">
        The scan is checked on our server against UIDAI's public certificate.{" "}
        <strong>Nothing is sent to any government system</strong>, and your Aadhaar number is never
        stored — the QR does not contain one.
      </p>

      {/* Camera first — pointing a phone at the card is what a farmer will
          actually do. Pasting stays as the fallback for a desktop, a refused
          permission, or a device with no camera. */}
      <div className="mt-5">
        <Suspense fallback={<p className="text-body-sm text-stone">Loading the scanner…</p>}>
        <QrScanner
          onResult={(scanned) => {
            setPayload(scanned);
            // Verify immediately: the farmer has already done the work of
            // holding the card steady, and making them press a second button
            // is the kind of step that loses people.
            verify.mutate({ qrPayload: scanned });
          }}
        />
        </Suspense>
      </div>

      <label className="mt-5 block">
        <span className="block text-body-sm font-medium">Or paste the QR contents</span>
        <span className="block text-caption text-stone">
          If the camera cannot be used, scan with any QR reader and paste the long number here.
        </span>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={4}
          placeholder="6376293610495882736…"
          className="mt-1 w-full rounded-button border border-hairline bg-pure-white px-3 py-2 font-mono text-body-sm"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => verify.mutate({ qrPayload: payload.trim() })}
          disabled={payload.trim().length < 64 || verify.isPending}
        >
          {verify.isPending ? "Checking…" : "Verify"}
        </Button>
      </div>

      {/* 422: the payload could not be read at all. */}
      {verify.isError && (
        <p className="mt-4 rounded-small bg-coral/10 px-3 py-2 text-body-sm">{verify.error.message}</p>
      )}

      {result && (
        <div
          className={`mt-4 rounded-card p-4 ${result.signatureVerified ? "bg-sky-tint" : "bg-marigold"}`}
        >
          <p className="text-body font-medium">
            {result.signatureVerified ? "Signature verified" : "Not verified"}
          </p>
          <p className="mt-1 text-body-sm">{result.message}</p>

          {/* The identity is shown even when unverified, so an officer can see
              what was read — but the gate stays shut. */}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-body-sm">
            <div><dt className="text-caption text-stone">Name</dt><dd>{result.identity.name || "—"}</dd></div>
            <div><dt className="text-caption text-stone">Date of birth</dt><dd>{result.identity.dateOfBirth || "—"}</dd></div>
            <div><dt className="text-caption text-stone">District</dt><dd>{result.identity.district || "—"}</dd></div>
            <div><dt className="text-caption text-stone">Aadhaar ending</dt><dd>{result.identity.aadhaarLast4}</dd></div>
          </dl>

          {result.signatureVerified ? (
            <p className="mt-3 text-body-sm">
              Verified against <code>{result.certificateFile}</code>. Your panel is now open.
            </p>
          ) : (
            <p className="mt-3 text-body-sm">
              A sample or unsigned payload cannot open the gate — only a genuine UIDAI-signed QR can.
            </p>
          )}
        </div>
      )}

      <p className="mt-5 border-t border-hairline pt-4 text-caption text-stone">
        We keep the last four digits, your name, date of birth and district, and which certificate
        matched. The photo in the QR is never read back.
      </p>
    </Card>
  );
}
