-- When each song was last played by anyone, for the watch page's site-wide Recently Played row. Songs played
-- before this column existed have none until their next listen
alter table "songStat" add column "lastListenedAt" integer;

create index "songStat_lastListenedAt_idx" on "songStat" ("lastListenedAt");
