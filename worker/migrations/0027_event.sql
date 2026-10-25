-- Usage events the app sends (src/events.ts): which parts of the app get used. An actor is an account ('u:') or a
-- guest's random browser id ('d:'); props is a small JSON object of allowlisted values. The daily cron deletes
-- rows past 90 days
create table "event" (
  "id" integer primary key,
  "name" text not null,
  "actor" text not null,
  "at" integer not null,
  "videoId" text,
  "props" text
);
-- One index, for the per-actor daily cap: each index costs a row written per insert. The admin's reads and the
-- prune scan the table, which is small and read rarely
create index "event_actor_at_idx" on "event" ("actor", "at");
