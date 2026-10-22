-- A signed-in listener's history, bookmarks and playlists, so they follow the account to every device and
-- survive reinstalling the app. Each row is last-write-wins on the time the change was made on the device,
-- so a retried or late sync converges on the same rows.
create table "historyEntry" (
  "userId" text not null references "user" ("id") on delete cascade,
  "videoId" text not null,
  "title" text not null,
  "author" text not null,
  "thumbnailUrl" text not null,
  "playedAt" integer not null,
  primary key ("userId", "videoId")
);

create index "historyEntry_userId_playedAt_idx" on "historyEntry" ("userId", "playedAt");

-- A removed bookmark keeps its row (saved = 0), so an older save from another device can't bring it back
create table "bookmark" (
  "userId" text not null references "user" ("id") on delete cascade,
  "videoId" text not null,
  "title" text not null,
  "author" text not null,
  "thumbnailUrl" text not null,
  "saved" integer not null,
  "changedAt" integer not null,
  primary key ("userId", "videoId")
);

-- songs is the ordered list as JSON; a deleted playlist keeps its row (deletedAt) for the same reason
create table "playlist" (
  "userId" text not null references "user" ("id") on delete cascade,
  "id" text not null,
  "name" text not null,
  "songs" text not null,
  "createdAt" integer not null,
  "updatedAt" integer not null,
  "deletedAt" integer,
  primary key ("userId", "id")
);

-- Plays from before the last Clear History stay cleared
create table "libraryState" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "historyClearedAt" integer not null
);
