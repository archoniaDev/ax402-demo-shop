-- Sample track shells for shop UI (no R2 audio yet — r2_key stays NULL).
-- Default track price 0.90 USDC (edit in admin).

INSERT OR IGNORE INTO tracks (
  id, album_id, slug, title_sv, title_en, price_usdc, format, track_number, sort_order, active
) VALUES
  ('trk-demo-01', 'alb-demo-01', 'track-01', 'Spår 01 (kommer snart)', 'Track 01 (coming soon)', '0.90', 'flac', 1, 10, 1),
  ('trk-demo-02', 'alb-demo-01', 'track-02', 'Spår 02 (kommer snart)', 'Track 02 (coming soon)', '0.90', 'flac', 2, 20, 1),
  ('trk-demo-03', 'alb-demo-01', 'track-03', 'Spår 03 (kommer snart)', 'Track 03 (coming soon)', '0.90', 'flac', 3, 30, 1);

UPDATE albums SET
  title_sv = 'Archonia Verify Demo — Album 01',
  title_en = 'Archonia Verify Demo — Album 01',
  description_sv = 'Exempelkatalog. Spår visas i shopen; FLAC/WAV laddas upp via admin när filerna finns.',
  description_en = 'Sample catalog. Tracks appear in the shop; FLAC/WAV are uploaded via admin when files are ready.',
  updated_at = strftime('%s', 'now')
WHERE id = 'alb-demo-01';
