-- A signed-in listener's settings that should follow them to every device (lyrics style, the lyrics toggles,
-- the reader, autoplay), one row per setting under the key the app stores it by on a device. Each row is
-- last-write-wins on the time the change was made, so two devices changing different settings never undo each
-- other. A cleared setting keeps its row with a null value, so an older copy from another device can't bring
-- it back.
create table "preference" (
  "userId" text not null references "user" ("id") on delete cascade,
  "key" text not null,
  "value" text,
  "changedAt" integer not null,
  primary key ("userId", "key")
);
