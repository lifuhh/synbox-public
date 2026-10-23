-- A signed-in user's limit is per rolling 24 hours again, not per hour (guests keep their UTC-day one)
alter table "quotaOverride" rename column "hourlyLimit" to "dailyLimit";
