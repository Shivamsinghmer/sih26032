# UIDAI document-signer certificates

Aadhaar Secure QR payloads are signed by UIDAI. Verifying that signature needs
UIDAI's **public** document-signer certificate, and nothing else — no UIDAI API,
no AUA/KUA licence, no network call to any government server.

"Offline" here means *UIDAI is never contacted*. It does not mean the farmer's
phone works without a network: verification happens on the API and must stay
there. A client that decides its own Aadhaar is valid is not a check, and the
bundle is editable by the person being checked.

## What is installed

| File | Subject | Issuer | Valid |
|---|---|---|---|
| `uidai_offline_publickey_2026.cer` | `CN=DS Unique Identification Authority of India 06`, O=Unique Identification Authority of India, C=IN | `(n)Code Solutions Sub-CA for DSC 2022` (CCA-licensed) | 2026-02-03 → 2029-02-03 |

RSA 2048. SHA-256 fingerprint:

```
E0:30:4B:9E:61:EE:36:40:EC:DD:AE:2D:B4:B6:17:F2:E2:67:8F:57:DB:C2:82:6C:2F:86:AC:5C:04:F2:77:DF
```

Check any certificate in this directory before trusting it:

```bash
node -e "const{X509Certificate}=require('node:crypto'),fs=require('node:fs');
const c=new X509Certificate(fs.readFileSync(process.argv[1]));
console.log(c.subject,'\n',c.issuer,'\n',c.validFrom,'->',c.validTo,'\n',c.fingerprint256);
" uidai_offline_publickey_2026.cer
```

## Why these are committed

They are public certificates, published by UIDAI so that anyone can verify a
Secure QR offline. There is no secret here, and committing them is deliberate:
with no certificate on disk the pipeline **fails closed** — a scan still parses,
but `signatureVerified` stays `false` and the farmer stays unverified. That is
the correct failure, but it is also indistinguishable from "verification is
broken", and a deploy that silently degrades to *nothing verifies* is exactly
the outcome to avoid.

**Never put a private key in this directory.** Nothing in this flow signs
anything; it only verifies.

## Adding or rotating a certificate

UIDAI rotates the signer periodically, and a QR signed under the previous
certificate must keep verifying. So this is a directory, not a single file:
every certificate here is tried, and the one that matched is reported back as
`certificateFile` in the `POST /verify/aadhaar` response — which is what makes
a verification auditable a year later.

1. Drop the new `.cer` in beside the existing ones. Do not delete the old one
   until no QR in circulation was signed under it.
2. Confirm subject and issuer with the command above before committing.
3. Note the fingerprint in the table.

## What is stored after a scan

The last four digits, the reference ID, name, date of birth, district, whether
the signature verified, and which certificate matched.

**Never an Aadhaar number** — the QR does not contain one, so the UIDAI Data
Vault requirement never applies. The photo embedded in the QR is deliberately
never returned either; nothing in this flow needs it.

## Testing

```bash
npm run test:qr            # exercises the pipeline, prints which certs are installed
npm run test:qr -- --emit  # prints a sample payload for the scanner's paste box
```

The emitted sample always reports **NOT VERIFIED**, by design: it is not signed
by UIDAI. Only a genuine UIDAI-signed QR sets `Farmer.aadhaarVerified`, which
means a demo needs a real Aadhaar card — or demo mode (`CLERK_SECRET_KEY` blank),
which skips the gate along with all auth.
