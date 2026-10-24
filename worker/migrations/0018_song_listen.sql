-- When each listener (an account, or a guest's device) last had a listen counted for a song, so a song counts
-- one listen per listener an hour however often its page is opened (src/songs.ts › addListen). Rows past the
-- hour no longer matter; the daily cron deletes them
create table "songListen" (
  "videoId" text not null,
  "listener" text not null,
  "at" integer not null,
  primary key ("videoId", "listener")
);
