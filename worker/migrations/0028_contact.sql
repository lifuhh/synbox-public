-- Messages sent through the app's Contact form (src/contact.ts): what the sender wrote, an optional address to reply
-- to, and who sent it, for the daily limits. A sender is an account ('u:'), a guest's random browser id ('d:') or
-- neither; network is a hash of the sender's network, never the address itself. emailedAt is when it was emailed to
-- the owner; emailError says why it wasn't, and the message stays for /admin either way
create table "contactMessage" (
  "id" integer primary key,
  "createdAt" integer not null,
  "sender" text,
  "network" text not null,
  "subject" text not null,
  "message" text not null,
  "replyTo" text,
  "emailedAt" integer,
  "emailError" text
);
create index "contact_network_at_idx" on "contactMessage" ("network", "createdAt");
create index "contact_sender_at_idx" on "contactMessage" ("sender", "createdAt");
