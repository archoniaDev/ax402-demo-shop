-- Ax402 Demo Shop D1 schema (catalog, orders, downloads, admin).
-- Catalog: albums + tracks. Commerce: orders + download_tokens. Admin: owners + sessions.

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title_sv TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_sv TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  price_usdc TEXT NOT NULL DEFAULT '10.00',
  cover_r2_key TEXT,
  spotify_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_albums_active_sort ON albums (active, sort_order, slug);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums (id) ON DELETE SET NULL,
  slug TEXT UNIQUE NOT NULL,
  title_sv TEXT NOT NULL,
  title_en TEXT NOT NULL,
  price_usdc TEXT NOT NULL DEFAULT '0.90',
  format TEXT NOT NULL DEFAULT 'flac' CHECK (format IN ('flac', 'wav')),
  r2_key TEXT,
  spotify_url TEXT,
  duration_sec INTEGER,
  track_number INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tracks_album_sort ON tracks (album_id, sort_order, track_number);
CREATE INDEX IF NOT EXISTS idx_tracks_active ON tracks (active, sort_order);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL DEFAULT 'sv' CHECK (locale IN ('sv', 'en')),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (
    status IN ('pending_payment', 'paid', 'fulfilled', 'canceled')
  ),
  buyer_email TEXT NOT NULL,
  items_json TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  quote_id TEXT,
  payment_tx_hash TEXT,
  ax402_order_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_email ON orders (buyer_email);

CREATE TABLE IF NOT EXISTS download_tokens (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks (id) ON DELETE SET NULL,
  album_id TEXT REFERENCES albums (id) ON DELETE SET NULL,
  token_hash TEXT UNIQUE NOT NULL,
  r2_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 5,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_order ON download_tokens (order_id);
CREATE INDEX IF NOT EXISTS idx_download_tokens_hash ON download_tokens (token_hash);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  magic_token_hash TEXT UNIQUE,
  session_token_hash TEXT UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_owner_id ON sessions (owner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions (session_token_hash);
