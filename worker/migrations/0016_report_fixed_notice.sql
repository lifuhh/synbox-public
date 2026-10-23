-- The reporter's side of a resolved report whose song got new lyrics: when the fix showed in their notifications,
-- and when they dismissed it. Null until then; reopening the report clears both
alter table "report" add column "seenAt" integer;

alter table "report" add column "dismissedAt" integer;

create index "report_userId_resolvedAt_idx" on "report" ("userId", "resolvedAt");
