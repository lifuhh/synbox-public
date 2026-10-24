-- One row per song a requester opened in an hour (src/lyrics.ts › takeSong): the hourly count of songs per
-- account or guest network, and, kept 30 days, which requesters a traced copy of a translation can come from
create table "lyrics_hit" (
  "requester" text not null,
  "hour" integer not null,
  "videoId" text not null,
  primary key ("requester", "hour", "videoId")
);
create index "lyrics_hit_hour_idx" on "lyrics_hit" ("hour");
