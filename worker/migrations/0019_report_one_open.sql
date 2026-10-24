-- One open report per account per song: what is wrong with a song goes in one report, and another can be sent once
-- that one is resolved or dropped. Open duplicates sent before this rule keep the oldest open and are dropped as
-- duplicates, so the index can be made
update "report" set "droppedAt" = "createdAt", "dropReason" = 'duplicate', "resolution" = 'one open report per song'
where "userId" is not null and "resolvedAt" is null and "droppedAt" is null
  and exists (
    select 1 from "report" as "older"
    where "older"."userId" = "report"."userId" and "older"."videoId" = "report"."videoId"
      and "older"."resolvedAt" is null and "older"."droppedAt" is null
      and ("older"."createdAt" < "report"."createdAt"
        or ("older"."createdAt" = "report"."createdAt" and "older"."id" < "report"."id"))
  );

create unique index "report_one_open_idx" on "report" ("userId", "videoId")
where "userId" is not null and "resolvedAt" is null and "droppedAt" is null;
