-- Sample album shell for catalog UI (no audio yet — upload via admin after deploy).
-- Example prices: track 0.90 USDC, album 10.00 USDC (edit in admin).

INSERT OR IGNORE INTO albums (
  id, slug, title_sv, title_en, description_sv, description_en, price_usdc, sort_order, active
) VALUES (
  'alb-demo-01',
  'demo-album-01',
  'Demoalbum (kommer snart)',
  'Demo Album (coming soon)',
  'Exempelalbum — spår laddas upp via admin när ljudfiler finns i R2.',
  'Sample album — tracks are added via admin once audio lands in R2.',
  '10.00',
  0,
  1
);
