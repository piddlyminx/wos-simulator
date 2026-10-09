-- Apply explicitly with `npm run runs:migrate`; HTTP requests never create schema.
CREATE TABLE IF NOT EXISTS saved_simulation_runs (
    id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{8,128}$'),
    kind text NOT NULL CHECK (kind IN ('simulate', 'optimize_ratio', 'bear_simulate', 'bear_optimize_ratio', 'ratio_explorer', 'tournament')),
    created_at timestamptz NOT NULL,
    created_at_text text NOT NULL,
    title text NOT NULL,
    kept boolean NOT NULL DEFAULT false,
    owner_hash text CHECK (owner_hash ~ '^[a-f0-9]{64}$'),
    payload bytea NOT NULL,
    payload_size bigint NOT NULL CHECK (payload_size = octet_length(payload))
);
CREATE INDEX IF NOT EXISTS saved_simulation_runs_created_idx ON saved_simulation_runs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS saved_simulation_runs_kind_created_idx ON saved_simulation_runs (kind, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS saved_simulation_runs_owner_created_idx ON saved_simulation_runs (owner_hash, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS saved_simulation_runs_owner_kept_created_idx ON saved_simulation_runs (owner_hash, kept, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS saved_simulation_runs_unkept_created_idx ON saved_simulation_runs (created_at, id) WHERE NOT kept;
