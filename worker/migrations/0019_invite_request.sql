-- A signed-in user's ask for more new songs a day than the default, with an optional note, for the admin page's
-- Invites tab. One per account. Allowing it gives the account a quotaOverride; a dismissal is never shown to them
create table "inviteRequest" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "note" text not null default '',
  "status" text not null default 'pending' check ("status" in ('pending', 'allowed', 'dismissed')),
  "createdAt" integer not null,
  "decidedBy" text,
  "decidedAt" integer
);

create index "inviteRequest_status_createdAt_idx" on "inviteRequest" ("status", "createdAt");
