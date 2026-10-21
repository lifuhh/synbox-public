-- A signed-in user's limit is per rolling hour, not per day (guests keep a daily one)
alter table "quotaOverride" rename column "dailyLimit" to "hourlyLimit";
