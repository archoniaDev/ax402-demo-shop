# Redesign guide (brand / layout)

Safe to change without touching the pay rail:

| Area | Files |
|------|--------|
| Layout + copy | `public/**/*.html` |
| Look | `public/assets/site.css` |
| Hero / brand imagery | `public/assets/hero-canvas.jpg` (and related CSS) |
| Strings (EN/SV) | `public/i18n/en.json`, `public/i18n/sv.json` |
| Nav brand mark | `.brand-mark` text in HTML pages |
| About marketing | Admin → About, or defaults in `src/about.ts` |
| Sample catalog titles | Prefer **admin UI** after deploy (not hand-editing SQL) |

## Frontend helpers (template globals)

After rebrand, the browser helpers are named:

- `window.AxShop` — i18n / lang
- `window.AxShopCart` — cart localStorage
- `window.AxShopPay` — USDC wallet helpers
- `window.AxShopShop` — catalog UI

Do **not** hardcode a payout address in JS. Checkout uses Ax402’s `recipient_address` from the payment payload.

## Touch carefully

- `src/ax402.ts`, `src/orders.ts`, `src/downloads.ts`, `src/auth.ts` — payment / security
- `public/assets/usdc-pay.js` — keep the public Base USDC contract; never hardcode merchant payout
- Email subjects / bodies in `src/email.ts`, `src/contact.ts`, `src/routes.ts`

## Rule of thumb

- **Redesign** = `public/` + admin catalog + About copy  
- **Go-live** = secrets + Ax402 merchant + Resend + domain + R2 uploads + real Turnstile keys

## Consultation (GitHub only)

Do **not** add a Consultation section to shop home / nav / i18n. Any consultation or build-help offer belongs in the repo **README** (GitHub), not in the deployed template UI.
