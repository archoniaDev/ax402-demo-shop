# Deploy Ax402 Demo Shop

English, Dashboard-friendly steps. Secrets are listed by **name only** — never commit values.

Suggested public home (archonia.org org; exact repo name TBD by maintainers):
`https://github.com/<ARCHONIA_ORG>/<PUBLIC_TEMPLATE_REPO>`

Until that URL is final, the Deploy button in the README uses the same placeholders.

## 1. Prerequisites

- Cloudflare account (free tier is enough)
- GitHub account
- A Base wallet address for your USDC payout
- [Resend](https://resend.com) account (download + magic-link + contact email)
- Ax402 merchant key from [archonia.org](https://archonia.org) (`yogm_…` format)

## 2. Deploy to Cloudflare (button)

1. Open the public template repo README.
2. Click **Deploy to Cloudflare**.
3. Connect GitHub/GitLab and let Cloudflare clone into **your** account.
4. Confirm Worker name / D1 `shop-db` / R2 `shop-audio` are created on **your** account (not someone else’s resource IDs).
5. When prompted, set the secrets from the table below (or set them after with Wrangler).

## 3. Clone + Wrangler path

```bash
git clone https://github.com/<ARCHONIA_ORG>/<PUBLIC_TEMPLATE_REPO>.git
cd <PUBLIC_TEMPLATE_REPO>
npm install
npx wrangler login   # or CLOUDFLARE_API_TOKEN
```

Create resources if the button did not:

```bash
npx wrangler d1 create shop-db
# paste database_id into wrangler.toml (replace the placeholder UUID)

npx wrangler r2 bucket create shop-audio
```

Apply migrations and deploy:

```bash
npm run migrate      # remote D1
npm run deploy
```

## 4. Required secrets (`npx wrangler secret put NAME`)

| Secret | Purpose |
|--------|---------|
| `AX402_MERCHANT_KEY` | Merchant API key (`yogm_…`) for quotes |
| `PAYOUT_ADDRESS` | Your USDC recipient on Base (`0x…`) — must match Ax402 merchant payout |
| `SESSION_SECRET` | Long random salt for sessions / magic links / download tokens |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | Verified from-address, e.g. `Shop <noreply@example.com>` |
| `OWNER_BOOTSTRAP_EMAIL` | First admin inbox (auto-created on magic link) |
| `PUBLIC_BASE_URL` | Canonical site URL for email / magic links |
| `SPOTIFY_CLIENT_ID` | Optional — cover fetch |
| `SPOTIFY_CLIENT_SECRET` | Optional — cover fetch |
| `TURNSTILE_SECRET_KEY` | Turnstile widget secret (contact Siteverify) |
| `CONTACT_TO_EMAIL` | Optional contact inbox (else `OWNER_BOOTSTRAP_EMAIL`) |

Non-secret vars in `wrangler.toml`: `AX402_API_URL`, `DEFAULT_LOCALE`, `TURNSTILE_SITE_KEY`, `TURNSTILE_HOSTNAMES`.

**Never** set `AX402_ALLOW_MOCK` / mock verify on a public store.

## 5. Ax402 merchant

1. Register a merchant with **your** `payout_address` against `https://api.archonia.org` (`POST /v1/merchant/register`).
2. Complete any register fee if required.
3. Store `yogm_…` as `AX402_MERCHANT_KEY`.
4. Ensure `PAYOUT_ADDRESS` matches that merchant payout.
5. Redeploy after `wrangler secret put` (it publishes a new Worker version).

Ax402 verifies payment — it does **not** sell the sample catalog SKUs. You own catalog and fulfillment.

## 6. Custom domain (optional)

1. Cloudflare → Workers & Pages → your Worker → Domains & Routes → **Add** custom domain.
2. Set `PUBLIC_BASE_URL` to `https://your-domain`.
3. Update `TURNSTILE_HOSTNAMES` and `public/sitemap.xml` / `robots.txt` to match.

## 7. Resend

1. Resend → Domains → add your sending domain.
2. Add the SPF/DKIM records Resend shows.
3. Set `RESEND_FROM_EMAIL` to a verified address.

Used for: download delivery, admin magic-link, contact form.

## 8. Turnstile (contact form)

1. Cloudflare Dashboard → **Turnstile** → Add widget for **your** domains.
2. Put the **site key** in `wrangler.toml` `[vars]` `TURNSTILE_SITE_KEY` (replace the dummy testing key).
3. Set `TURNSTILE_HOSTNAMES` to your hostnames (comma-separated).
4. `npx wrangler secret put TURNSTILE_SECRET_KEY` with the widget **secret**.
5. Redeploy.

Dummy always-pass keys are for local/UI smoke only:
https://developers.cloudflare.com/turnstile/troubleshooting/testing/

## 9. Admin + sample catalog

1. Open `https://YOUR_HOST/admin/`.
2. Request a magic link to `OWNER_BOOTSTRAP_EMAIL`.
3. Replace sample album/tracks, upload audio/covers to private R2, edit About copy.
4. Smoke buy with a **different** wallet than `PAYOUT_ADDRESS` (UI blocks same-account pays).

## 10. Health check

```bash
curl -s https://YOUR_HOST/health
curl -s 'https://YOUR_HOST/api/catalog?locale=en' | head
```

See also [redesign.md](./redesign.md) and optional [spotify-covers.md](./spotify-covers.md).
