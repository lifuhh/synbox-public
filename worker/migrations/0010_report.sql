-- What listeners report about a song: the song, where in it, which lyrics version was on screen, what was wrong.
-- From an account or a guest (a hash of their network address), for whoever fixes the lyrics pipeline
create table "report" (
  "id" text not null primary key,
  "videoId" text not null,
  "atSeconds" real,
  "version" integer,
  "message" text not null,
  "userId" text references "user" ("id") on delete set null,
  "guestKey" text,
  "client" text,
  "build" text,
  "createdAt" integer not null
);

create index "report_createdAt_idx" on "report" ("createdAt");

create index "report_userId_createdAt_idx" on "report" ("userId", "createdAt");

create index "report_guestKey_createdAt_idx" on "report" ("guestKey", "createdAt");
