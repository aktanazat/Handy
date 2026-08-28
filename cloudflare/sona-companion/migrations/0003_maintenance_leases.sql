-- sona-migration-version: 0003_maintenance_leases
-- sona-migration-checksum: sha256:ee4a245b4d2e42220fea50d09ff72c96cf12c501810d2dc1c6162906e217838d
ALTER TABLE maintenance_jobs ADD COLUMN lease_token TEXT;

CREATE INDEX changes_retention ON changes(created_at, vault_id, sequence);
CREATE UNIQUE INDEX maintenance_jobs_active_compaction
ON maintenance_jobs(vault_id)
WHERE job_class = 'compact_changes' AND state IN ('queued', 'running');

INSERT INTO schema_migrations (version, checksum, applied_at)
VALUES ('0003_maintenance_leases', 'sha256:ee4a245b4d2e42220fea50d09ff72c96cf12c501810d2dc1c6162906e217838d', unixepoch() * 1000);
