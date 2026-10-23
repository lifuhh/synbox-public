-- Where a generation came from, for the per-network cap and the admin page's signals: the backend's keyed hash of
-- the caller's network (the same hash guestKey holds for guests, never the address), the caller's user agent, and
-- whether the owner was under the default limit then (a guest, or an account with no override and no admin role),
-- which is what the network cap counts
alter table "generation" add column "networkKey" text;

alter table "generation" add column "client" text;

alter table "generation" add column "capped" integer not null default 0;

create index "generation_networkKey_createdAt_idx" on "generation" ("networkKey", "createdAt");

-- Each reservation turned away at a limit: someone pushing past one, for the admin page's signals
create table "refusal" (
  "id" integer primary key,
  "code" text not null,
  "userId" text references "user" ("id") on delete cascade,
  "guestKey" text,
  "networkKey" text,
  "client" text,
  "createdAt" integer not null
);

create index "refusal_createdAt_idx" on "refusal" ("createdAt");
