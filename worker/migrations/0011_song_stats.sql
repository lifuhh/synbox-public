-- How often each song is played (every visit to its player page) and who likes it: an account, or a device for
-- a guest (a random id the browser keeps), one like each
create table "songStat" (
  "videoId" text not null primary key,
  "listens" integer not null default 0
);

create table "songLike" (
  "videoId" text not null,
  "liker" text not null,
  "createdAt" integer not null,
  primary key ("videoId", "liker")
);

create index "songLike_videoId_idx" on "songLike" ("videoId");
