-- One row per song check (the backend's /validate, which downloads the song's audio), so checks have a cap like
-- songs do. Numbered 0024: 0020 is unused and 0022-0023 are taken by a held branch (feat/invite-requests-held).
-- `capped` is the generation table's: a guest, or an account under the default limit, held to the per-owner and
-- per-network caps. The daily cron deletes rows past their 24 hours
create table "validation" (
  "id" text not null primary key,
  "userId" text references "user" ("id") on delete cascade,
  "guestKey" text,
  "networkKey" text,
  "capped" integer not null default 0,
  "videoId" text not null,
  "createdAt" integer not null,
  check (("userId" is null) <> ("guestKey" is null))
);

create index "validation_userId_createdAt_idx" on "validation" ("userId", "createdAt");

create index "validation_guestKey_createdAt_idx" on "validation" ("guestKey", "createdAt");

create index "validation_networkKey_createdAt_idx" on "validation" ("networkKey", "createdAt");

create index "validation_createdAt_idx" on "validation" ("createdAt");
