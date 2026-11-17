-- Editable About page copy (SV + EN). Singleton row id = 1.
-- Seeded from public/i18n about.* defaults so public page matches until admin edits.

CREATE TABLE IF NOT EXISTS about_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title_sv TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  lede_sv TEXT NOT NULL DEFAULT '',
  lede_en TEXT NOT NULL DEFAULT '',
  body_sv TEXT NOT NULL DEFAULT '',
  body_en TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT OR IGNORE INTO about_content (
  id, title_sv, title_en, lede_sv, lede_en, body_sv, body_en
) VALUES (
  1,
  'Om',
  'About',
  'Demo-butik för digitala nedladdningar med USDC på Base.',
  'Demo shop for digital downloads with USDC on Base.',
  'Archonia Verify Demo Shop är en offentlig mall. Byt ut den här texten, katalogen och varumärket mot ditt eget.',
  'Archonia Verify Demo Shop is a public template. Replace this copy, the catalog, and the branding with your own.'
);
