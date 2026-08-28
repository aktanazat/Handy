-- sona-migration-version: 0001_initial
-- sona-migration-checksum: sha256:36c221b4ebea5ec3fb6f663e124db0c05c2cb94b3aa926793977c7d34dad59a3
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE vaults (
  vault_id TEXT PRIMARY KEY CHECK(length(vault_id) BETWEEN 16 AND 128),
  byte_cap INTEGER NOT NULL DEFAULT 8589934592 CHECK(byte_cap > 0),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes >= 0),
  next_change_sequence INTEGER NOT NULL DEFAULT 0 CHECK(next_change_sequence >= 0),
  min_change_sequence INTEGER NOT NULL DEFAULT 1 CHECK(min_change_sequence >= 1),
  bootstrap_consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE devices (
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 16 AND 128),
  signing_public_key BLOB NOT NULL CHECK(length(signing_public_key) = 32),
  pairing_public_key BLOB NOT NULL CHECK(length(pairing_public_key) = 32),
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revocation_signature BLOB,
  PRIMARY KEY (vault_id, device_id),
  UNIQUE (vault_id, signing_public_key),
  UNIQUE (vault_id, pairing_public_key),
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
);

CREATE TABLE device_envelopes (
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  envelope BLOB NOT NULL,
  pairing_nonce BLOB NOT NULL UNIQUE,
  protocol_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, device_id),
  FOREIGN KEY (vault_id, device_id) REFERENCES devices(vault_id, device_id)
);

CREATE TABLE mutation_nonces (
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce BLOB NOT NULL CHECK(length(nonce) = 16),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, device_id, nonce),
  FOREIGN KEY (vault_id, device_id) REFERENCES devices(vault_id, device_id)
);
CREATE INDEX mutation_nonces_expiry ON mutation_nonces(expires_at);

CREATE TABLE idempotency_results (
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  operation TEXT NOT NULL,
  target TEXT NOT NULL,
  body_digest TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, device_id, idempotency_key),
  FOREIGN KEY (vault_id, device_id) REFERENCES devices(vault_id, device_id)
);

CREATE TABLE upload_sessions (
  upload_id TEXT PRIMARY KEY CHECK(length(upload_id) BETWEEN 16 AND 128),
  vault_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('object', 'share')),
  object_id TEXT,
  revision_id TEXT,
  base_revision_id TEXT,
  share_id TEXT,
  manifest BLOB NOT NULL,
  manifest_digest TEXT NOT NULL,
  chunk_plan TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 0 AND 4096),
  total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 0 AND 17179869184),
  crypto_version INTEGER NOT NULL,
  writer_signature BLOB NOT NULL CHECK(length(writer_signature) = 64),
  creator_device_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active', 'committed', 'cancelled', 'expired', 'purged')),
  reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes >= 0),
  cleanup_accounted INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_accounted IN (0, 1)),
  expires_at INTEGER NOT NULL,
  committed_sequence INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(
    (kind = 'object' AND object_id IS NOT NULL AND revision_id IS NOT NULL AND share_id IS NULL)
    OR (kind = 'share' AND object_id IS NULL AND revision_id IS NULL AND share_id IS NOT NULL)
  ),
  UNIQUE (vault_id, object_id, revision_id),
  UNIQUE (vault_id, share_id),
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id),
  FOREIGN KEY (vault_id, creator_device_id) REFERENCES devices(vault_id, device_id)
);
CREATE INDEX upload_sessions_active ON upload_sessions(vault_id, state, expires_at);

CREATE TABLE upload_chunks (
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 4095),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 0 AND 4194304),
  digest TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (upload_id, chunk_index),
  FOREIGN KEY (upload_id) REFERENCES upload_sessions(upload_id)
);

CREATE TABLE revisions (
  vault_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  parent_revision_id TEXT,
  manifest BLOB NOT NULL,
  manifest_digest TEXT NOT NULL,
  manifest_size INTEGER NOT NULL CHECK(manifest_size >= 0),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 0 AND 4096),
  total_bytes INTEGER NOT NULL CHECK(total_bytes >= 0),
  crypto_version INTEGER NOT NULL,
  writer_signature BLOB NOT NULL CHECK(length(writer_signature) = 64),
  writer_device_id TEXT NOT NULL,
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0, 1)),
  tombstone_reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, object_id, revision_id),
  FOREIGN KEY (vault_id, writer_device_id) REFERENCES devices(vault_id, device_id),
  CHECK((tombstone = 0 AND tombstone_reason IS NULL) OR (tombstone = 1 AND tombstone_reason IS NOT NULL))
);

CREATE TABLE object_heads (
  vault_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  head_revision_id TEXT NOT NULL,
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0, 1)),
  head_sequence INTEGER NOT NULL DEFAULT 0 CHECK(head_sequence >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, object_id),
  FOREIGN KEY (vault_id, object_id, head_revision_id) REFERENCES revisions(vault_id, object_id, revision_id)
);
CREATE INDEX object_heads_snapshot ON object_heads(vault_id, head_sequence, object_id);

CREATE TABLE revision_chunks (
  vault_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 4095),
  r2_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 0 AND 4194304),
  digest TEXT NOT NULL,
  purged_at INTEGER,
  PRIMARY KEY (vault_id, object_id, revision_id, chunk_index),
  FOREIGN KEY (vault_id, object_id, revision_id) REFERENCES revisions(vault_id, object_id, revision_id)
);

CREATE TABLE changes (
  vault_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  object_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, sequence),
  FOREIGN KEY (vault_id, object_id, revision_id) REFERENCES revisions(vault_id, object_id, revision_id)
);
CREATE INDEX changes_cursor ON changes(vault_id, sequence);

CREATE TABLE shares (
  vault_id TEXT NOT NULL,
  share_id TEXT NOT NULL,
  upload_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending', 'active', 'revoked', 'expired', 'purged')),
  manifest_digest TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 0 AND 4096),
  total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 0 AND 268435456),
  crypto_version INTEGER NOT NULL,
  writer_signature BLOB NOT NULL CHECK(length(writer_signature) = 64),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, share_id),
  UNIQUE (share_id),
  FOREIGN KEY (upload_id) REFERENCES upload_sessions(upload_id),
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
);
CREATE INDEX shares_state_expiry ON shares(vault_id, state, expires_at);

CREATE TABLE maintenance_jobs (
  job_id TEXT PRIMARY KEY CHECK(length(job_id) BETWEEN 16 AND 128),
  vault_id TEXT NOT NULL,
  job_class TEXT NOT NULL CHECK(job_class IN ('reconcile_upload', 'cleanup_upload', 'cleanup_object', 'cleanup_share', 'compact_changes')),
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'done')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
);
CREATE INDEX maintenance_jobs_due ON maintenance_jobs(state, next_attempt_at, lease_until);
CREATE INDEX maintenance_jobs_target ON maintenance_jobs(vault_id, job_class, target_id, state);

CREATE TRIGGER object_heads_insert_change
AFTER INSERT ON object_heads
BEGIN
  UPDATE vaults
  SET next_change_sequence = next_change_sequence + 1
  WHERE vault_id = NEW.vault_id;

  INSERT INTO changes (vault_id, sequence, object_id, revision_id, tombstone, created_at)
  SELECT vault_id, next_change_sequence, NEW.object_id, NEW.head_revision_id, NEW.tombstone,
         unixepoch() * 1000
  FROM vaults
  WHERE vault_id = NEW.vault_id;

  UPDATE object_heads
  SET head_sequence = (SELECT next_change_sequence FROM vaults WHERE vault_id = NEW.vault_id)
  WHERE vault_id = NEW.vault_id AND object_id = NEW.object_id;
END;

CREATE TRIGGER object_heads_advance_change
AFTER UPDATE OF head_revision_id, tombstone ON object_heads
WHEN NEW.head_revision_id <> OLD.head_revision_id OR NEW.tombstone <> OLD.tombstone
BEGIN
  UPDATE vaults
  SET next_change_sequence = next_change_sequence + 1
  WHERE vault_id = NEW.vault_id;

  INSERT INTO changes (vault_id, sequence, object_id, revision_id, tombstone, created_at)
  SELECT vault_id, next_change_sequence, NEW.object_id, NEW.head_revision_id, NEW.tombstone,
         unixepoch() * 1000
  FROM vaults
  WHERE vault_id = NEW.vault_id;

  UPDATE object_heads
  SET head_sequence = (SELECT next_change_sequence FROM vaults WHERE vault_id = NEW.vault_id)
  WHERE vault_id = NEW.vault_id AND object_id = NEW.object_id;
END;

INSERT INTO schema_migrations (version, checksum, applied_at)
VALUES ('0001_initial', 'sha256:36c221b4ebea5ec3fb6f663e124db0c05c2cb94b3aa926793977c7d34dad59a3', unixepoch() * 1000);
