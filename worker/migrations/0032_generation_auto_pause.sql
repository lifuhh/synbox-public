-- The site-wide daily ceiling on new songs (SITE_DAILY_LIMIT, src/quota.ts › tripIfFull). The request that would go
-- past it sets generationEnabled to '0' and records here that the pause was automatic: when (ms) and the count that
-- tripped it; both are '' while generation is on or paused by hand. generationCountSince is when the owner last
-- pressed Resume Generation (ms; '0' before the first): the count runs from the later of it and UTC midnight
insert into "appSetting" ("key", "value") values
  ('generationAutoPausedAt', ''),
  ('generationAutoPausedCount', ''),
  ('generationCountSince', '0')
on conflict ("key") do nothing;
