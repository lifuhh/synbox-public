-- Guests get a daily song too, keyed by a hash of their network address (the backend's HMAC of the client IP,
-- grouped per IPv6 /64), so a generation belongs to exactly one of a user or a guest.
drop table "generation";

create table "generation" (
  "id" text not null primary key,
  "userId" text references "user" ("id") on delete cascade,
  "guestKey" text,
  "videoId" text not null,
  "kind" text not null check ("kind" in ('new', 'regenerate', 'retime')),
  "status" text not null check ("status" in ('reserved', 'running', 'succeeded', 'failed')),
  "utcDay" text not null,
  "createdAt" integer not null,
  "finishedAt" integer,
  "resultVersion" integer,
  "errorCode" text,
  check (("userId" is null) <> ("guestKey" is null))
);

create index "generation_userId_utcDay_idx" on "generation" ("userId", "utcDay");

create index "generation_guestKey_utcDay_idx" on "generation" ("guestKey", "utcDay");

create index "generation_utcDay_idx" on "generation" ("utcDay");
