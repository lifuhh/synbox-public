-- What a running generation is doing, as the backend reports it: the stage's name, how far through it (0..1),
-- and when it last reported, so a generation nobody reports on any more is let go instead of counting forever
alter table "generation" add column "stage" text;

alter table "generation" add column "fraction" real;

alter table "generation" add column "updatedAt" integer;
