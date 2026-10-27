-- Feedback about the app (src/feedback.ts): a subject and a message, from an account or sent anonymously. An anonymous
-- row has a null userId and nothing else about its sender: no name, email, network or client. resolvedAt and
-- droppedAt close it (resolving one with a userId notifies its sender in the app); seenAt and dismissedAt are the
-- sender's side of that notification, as on "report" (0016). Reopening clears all four
create table "feedback" (
  "id" integer primary key,
  "createdAt" integer not null,
  "userId" text,
  "subject" text not null,
  "message" text not null,
  "resolvedAt" integer,
  "droppedAt" integer,
  "seenAt" integer,
  "dismissedAt" integer
);
create index "feedback_userId_resolvedAt_idx" on "feedback" ("userId", "resolvedAt");

-- The daily send limits, kept apart from the messages so a count can't be joined to one: a key is a hash of the UTC
-- day and the sender (an account or a network), n how many it sent that day, anonymous or not. No message id, no
-- time but the day, and no rowid (without rowid: rows sit in key order, not in the order they were first written).
-- Rows of past days are deleted by the daily cron
create table "feedbackCount" (
  "key" text primary key,
  "day" integer not null,
  "n" integer not null
) without rowid;
