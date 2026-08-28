-- sona-migration-version: 0004_bootstrap_registry
-- sona-migration-checksum: sha256:ae6e9b051ea617b15b02614b352dcc65ce08a93cee0e70f214893b9af0c224e8
CREATE TABLE bootstrap_registry (
  registry_id INTEGER PRIMARY KEY CHECK(registry_id = 1),
  vault_id TEXT NOT NULL UNIQUE,
  consumed_at INTEGER NOT NULL,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
);

INSERT INTO schema_migrations (version, checksum, applied_at)
VALUES ('0004_bootstrap_registry', 'sha256:ae6e9b051ea617b15b02614b352dcc65ce08a93cee0e70f214893b9af0c224e8', unixepoch() * 1000);
