-- A report an admin has dealt with: when, the lyrics version that fixed it (when there is one), and a short note.
-- All null while the report is open; reopening clears them
alter table "report" add column "resolvedAt" integer;

alter table "report" add column "resolvedVersion" integer;

alter table "report" add column "resolution" text;
