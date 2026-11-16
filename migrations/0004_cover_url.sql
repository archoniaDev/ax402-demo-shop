-- Spotify (or other) cover image URL cached on catalog rows.
-- Albums may also keep cover_r2_key when art is uploaded or mirrored to R2.

ALTER TABLE albums ADD COLUMN cover_url TEXT;
ALTER TABLE tracks ADD COLUMN cover_url TEXT;
