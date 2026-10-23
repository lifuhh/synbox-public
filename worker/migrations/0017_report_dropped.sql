-- A report closed without a fix: when, and why (uninformative, no_lyrics, duplicate, nothing_found, expired). Its
-- note goes in "resolution", the closing note of either kind. Null while open or resolved; resolving, reopening
-- and dropping keep the two states apart. A dropped report never notifies its reporter
alter table "report" add column "droppedAt" integer;

alter table "report" add column "dropReason" text;
