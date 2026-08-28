-- Attribution Phase 3 (Android Install Referrer): Play's organic marker
-- ("utm_source=google-play&utm_medium=organic") is a store install, not an
-- unknown utm slug. Mirrored in client/src/lib/attributionRules.ts.
INSERT INTO public.attribution_channel_rules (kind, pattern, source, channel_group, medium, discard, priority) VALUES
  ('utm', '^(google-play|google_play|play)$', 'google_play', 'store', 'organic', false, 74)
ON CONFLICT (kind, pattern) DO UPDATE
  SET source = EXCLUDED.source, channel_group = EXCLUDED.channel_group,
      medium = EXCLUDED.medium, discard = EXCLUDED.discard, priority = EXCLUDED.priority;
