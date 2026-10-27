-- adminNoticeRead: when each admin first had the bell open on a notice, so a read notice leaves the bell 3 days after
-- it was read. A notice read before this table existed has no row and counts as read when it arrived
create table "adminNoticeRead" (
  "adminId" text not null references "user" ("id") on delete cascade,
  "kind" text not null,
  "noticeId" text not null,
  "readAt" integer not null,
  primary key ("adminId", "kind", "noticeId")
);

-- Clear Read: read notices that arrived up to this moment leave the bell
alter table "adminNoticeSeen" add column "clearedAt" integer not null default 0;
