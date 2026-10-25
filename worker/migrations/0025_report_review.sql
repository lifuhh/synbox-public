-- The backend's fixer hands a report it can't fix to a human: the report stays open for its reporter (one open per
-- song still holds), but the fixer's later runs and the daily expiry skip it, and /admin lists it as Needs Review.
-- The note says why the fixer gave up
alter table "report" add column "reviewAt" integer;
alter table "report" add column "reviewNote" text;
