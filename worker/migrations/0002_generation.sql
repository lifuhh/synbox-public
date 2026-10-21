-- One row per paid generation: the user's generation history and the daily quota count.
-- The id is the frontend's request_id, so a reconnect or retry reserves nothing twice.
create table "generation" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "videoId" text not null,
  "kind" text not null check ("kind" in ('new', 'regenerate', 'retime')),
  "status" text not null check ("status" in ('reserved', 'running', 'succeeded', 'failed')),
  "utcDay" text not null,
  "createdAt" integer not null,
  "finishedAt" integer,
  "resultVersion" integer,
  "errorCode" text
);

create index "generation_userId_utcDay_idx" on "generation" ("userId", "utcDay");

create index "generation_createdAt_idx" on "generation" ("createdAt");

-- Set by an admin; a user without a row gets DEFAULT_DAILY_LIMIT
create table "quotaOverride" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "dailyLimit" integer not null check ("dailyLimit" >= 0),
  "note" text,
  "setBy" text not null,
  "setAt" integer not null
);

create table "appSetting" ("key" text not null primary key, "value" text not null);

insert into "appSetting" ("key", "value") values ('generationEnabled', '1');
