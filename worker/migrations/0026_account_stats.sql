-- Per account, for /admin › Accounts: counted plays (songs.ts › addListen's rule: one per song an hour) and when
-- the account last played a song, and when it last used the app (activity.ts › touchActive, at most every ten
-- minutes). Counts start at this migration; nothing earlier was kept per account
create table "accountStats" (
  "userId" text not null primary key,
  "plays" integer not null default 0,
  "lastPlayAt" integer,
  "lastActiveAt" integer
);
