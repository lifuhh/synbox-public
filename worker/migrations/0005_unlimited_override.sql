-- An admin can lift a user's limit: an override with a null hourlyLimit means no limit (no row: the default).
-- SQLite can't drop a not-null constraint in place, so the table is rebuilt
create table "quotaOverride_new" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "hourlyLimit" integer check ("hourlyLimit" >= 0),
  "note" text,
  "setBy" text not null,
  "setAt" integer not null
);

insert into "quotaOverride_new" select "userId", "hourlyLimit", "note", "setBy", "setAt" from "quotaOverride";

drop table "quotaOverride";

alter table "quotaOverride_new" rename to "quotaOverride";
