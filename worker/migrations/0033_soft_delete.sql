-- An admin's Delete on /admin: a closed report, a feedback or a contact message leaves every admin list, count and
-- notice, and a deleted report or feedback stops notifying its sender. Kept, with when, so Undo can bring it back.
-- Nothing else reads or changes a deleted row (worker/src/reports.ts › LIVE, feedback.ts, contact.ts)
alter table "report" add column "deletedAt" integer;
alter table "feedback" add column "deletedAt" integer;
alter table "contactMessage" add column "deletedAt" integer;
