-- Sign-in model (2026-10-27): a signed-in account's songs count per calendar day in its own time zone, and an
-- account can ask the owner for more songs a day.
--
-- userTimeZone: the IANA zone the app last reported for the account (Intl), so a day ends at the listener's
-- midnight, not UTC's. Missing means UTC.
create table "userTimeZone" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "timeZone" text not null,
  "updatedAt" integer not null
);

-- quotaRequest: "can I add more songs a day", with a short note about the asker. One open request per account at a
-- time; approving sets the account's quotaOverride (granted = the daily songs given) in the same batch.
create table "quotaRequest" (
  "id" integer primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "note" text not null,
  "status" text not null default 'open',
  "createdAt" integer not null,
  "decidedAt" integer,
  "decidedBy" text,
  "granted" integer
);
create unique index "quota_request_open_idx" on "quotaRequest" ("userId") where "status" = 'open';
create index "quota_request_created_idx" on "quotaRequest" ("createdAt");

-- adminNoticeSeen: when each admin last opened their notices, so new contact messages, reports and quota requests
-- after it count as unread
create table "adminNoticeSeen" (
  "adminId" text not null primary key references "user" ("id") on delete cascade,
  "seenAt" integer not null
);
