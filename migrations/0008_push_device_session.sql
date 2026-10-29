-- The session a device subscribed under. A device stays with that session, not with the person:
-- signing out on the device releases it even while the same person is still signed in elsewhere.
-- NULL on rows from before this migration; those keep the per-person check until they resubscribe.
ALTER TABLE push_subscriptions ADD COLUMN sid TEXT;
