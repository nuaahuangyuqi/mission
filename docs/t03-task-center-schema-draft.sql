PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT 'planning',
  mission_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'in_review', 'approved', 'archived', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  owner_user_id INTEGER NOT NULL,
  owner_role TEXT NOT NULL DEFAULT 'user',
  current_template_id TEXT,
  current_version_id TEXT,
  latest_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'custom' CHECK (template_type IN ('builtin', 'custom', 'imported')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  version_no INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  checksum TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE (task_id, version_no)
);

CREATE TABLE IF NOT EXISTS task_versions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  change_summary TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL,
  baseline_hash TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  approved_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES task_templates(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  UNIQUE (task_id, version_no)
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  run_no INTEGER NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'schedule', 'api', 'replay')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  binding_json TEXT NOT NULL DEFAULT '{}',
  input_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  triggered_by INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES task_versions(id),
  FOREIGN KEY (triggered_by) REFERENCES users(id),
  UNIQUE (task_id, run_no)
);

CREATE TABLE IF NOT EXISTS task_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  result_type TEXT NOT NULL CHECK (
    result_type IN (
      'storage_snapshot',
      'report_html',
      'spatial_geojson',
      'comparison_csv',
      'capability_result',
      'action_result',
      'consumption_result'
    )
  ),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'expired', 'deleted', 'failed')),
  score REAL,
  summary TEXT NOT NULL DEFAULT '',
  content_json TEXT,
  content_blob BLOB,
  mime_type TEXT NOT NULL DEFAULT 'application/json',
  checksum TEXT NOT NULL DEFAULT '',
  storage_uri TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE (run_id, result_type)
);

CREATE TABLE IF NOT EXISTS task_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  approval_stage TEXT NOT NULL DEFAULT 'review' CHECK (approval_stage IN ('review', 'security', 'command', 'archive')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'returned')),
  is_blocking INTEGER NOT NULL DEFAULT 1 CHECK (is_blocking IN (0, 1)),
  requested_by INTEGER NOT NULL,
  approver_user_id INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES task_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approver_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  version_id TEXT,
  run_id TEXT,
  approval_id TEXT,
  attachment_role TEXT NOT NULL DEFAULT 'input_file' CHECK (
    attachment_role IN ('input_file', 'output_file', 'evidence', 'approval_doc', 'report')
  ),
  source_type TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload', 'resource_library', 'generated', 'imported')),
  file_name TEXT NOT NULL,
  file_ext TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  storage_uri TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES task_versions(id),
  FOREIGN KEY (run_id) REFERENCES task_runs(id),
  FOREIGN KEY (approval_id) REFERENCES task_approvals(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  actor_user_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'user',
  request_id TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_versions_current
  ON task_versions(task_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS idx_tasks_owner_status_updated
  ON tasks(owner_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_templates_task_status
  ON task_templates(task_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_versions_task_status
  ON task_versions(task_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_status
  ON task_runs(task_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_results_task_created
  ON task_results(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_approvals_task_status
  ON task_approvals(task_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task_created
  ON task_attachments(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_task_created
  ON audit_logs(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
  ON audit_logs(entity_type, entity_id, created_at DESC);

