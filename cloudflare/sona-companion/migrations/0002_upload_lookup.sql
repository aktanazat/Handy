-- sona-migration-version: 0002_upload_lookup
-- sona-migration-checksum: sha256:9f05889f771b4486becc105c60505cdb3d361248922babf5b4b00887416814a5
CREATE INDEX upload_sessions_creator_state
ON upload_sessions(vault_id, creator_device_id, state, expires_at);

INSERT INTO schema_migrations (version, checksum, applied_at)
VALUES ('0002_upload_lookup', 'sha256:9f05889f771b4486becc105c60505cdb3d361248922babf5b4b00887416814a5', unixepoch() * 1000);
