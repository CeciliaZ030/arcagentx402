-- Preserve the verified method and example body for body-bound x402 routes.
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'GET';
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS body jsonb;

INSERT INTO schema_migrations (version) VALUES (18) ON CONFLICT DO NOTHING;
