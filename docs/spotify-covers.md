# Spotify cover art (optional)

Free Spotify Developer app. Used only to fetch album/track cover images when you paste a Spotify URL in admin. No user login, no streaming.

## What the shop does

1. In `/admin/`, set **Spotify URL** on an album or track (`https://open.spotify.com/album/…` or `/track/…`).
2. On save, the Worker calls Spotify Web API with **Client Credentials**.
3. Cover URL is stored in D1 (`cover_url`).
4. For albums with no manual cover yet, the image is also copied into private R2 (`cover_r2_key`) and served at `/api/covers/:albumId`.
5. Shop shows the cover next to the album / track.

Manual cover upload still wins for albums (R2 key takes precedence over the Spotify CDN URL).

## Create a free Spotify app

1. Open [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and sign in with a Spotify account.
2. Accept the developer terms if prompted.
3. Click **Create app**.
4. Fill in:
   - **App name:** e.g. `My shop covers`
   - **App description:** e.g. `Fetch cover art for my Ax402 shop`
   - **Redirect URI:** `http://127.0.0.1:8787/callback` (required by the form; Client Credentials does not use it)
   - **APIs used:** Web API
5. Save. Open the app → **Settings**.
6. Copy **Client ID**.
7. Click **View client secret** and copy **Client Secret**.

No paid Spotify plan is required for this app type.

## Put secrets on the Worker

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
# paste Client ID

npx wrangler secret put SPOTIFY_CLIENT_SECRET
# paste Client Secret
```

`wrangler secret put` deploys a new Worker version. After that, re-save a Spotify URL in admin (or clear and set it again) so covers refresh.

### Local `.dev.vars`

```bash
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

## Apply the D1 migration

```bash
npm run migrate        # remote: includes 0004_cover_url
npm run migrate:local  # local SQLite
```

## Check it worked

1. Admin → album or track → paste Spotify URL → Save.
2. List row shows a **cover** badge when `cover_url` (or album `cover_r2_key`) is set.
3. Open `/shop/` — album art / track thumbs appear.
4. If secrets are missing, save still works; covers are skipped (Worker logs `spotify_cover_skipped`).

## Notes

- Client Credentials only reads public catalog metadata (covers). It cannot access private user data.
- Keep Client Secret out of git; never put it in `wrangler.toml` `[vars]`.
- Free Cloudflare tier only — cover files are small JPEGs in R2.
