-- An admin's own note on an account (who they are), shown on the admin page's Accounts and Invites tabs only
create table "adminNote" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "note" text not null,
  "setBy" text not null,
  "setAt" integer not null
);
