ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account VARCHAR(64) NOT NULL DEFAULT '' AFTER name,
  ADD COLUMN IF NOT EXISTS password VARCHAR(255) NOT NULL DEFAULT '' AFTER account,
  ADD COLUMN IF NOT EXISTS sso_provider VARCHAR(64) NOT NULL DEFAULT '' AFTER password,
  ADD COLUMN IF NOT EXISTS sso_subject VARCHAR(128) NOT NULL DEFAULT '' AFTER sso_provider,
  ADD COLUMN IF NOT EXISTS enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER role,
  ADD COLUMN IF NOT EXISTS role_updated_at DATETIME NULL AFTER enabled;

CREATE UNIQUE INDEX IF NOT EXISTS uk_users_account ON users (account);
CREATE INDEX IF NOT EXISTS idx_users_sso ON users (sso_provider, sso_subject);

CREATE TABLE IF NOT EXISTS operation_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(64) NOT NULL,
  target_user_id BIGINT NULL,
  target_user_name VARCHAR(128) NOT NULL DEFAULT '',
  before_role VARCHAR(32) NULL,
  after_role VARCHAR(32) NULL,
  before_enabled TINYINT(1) NULL,
  after_enabled TINYINT(1) NULL,
  message VARCHAR(255) NOT NULL DEFAULT '',
  operator_id BIGINT NULL,
  operator_name VARCHAR(128) NOT NULL DEFAULT '',
  operator_role VARCHAR(32) NOT NULL DEFAULT '',
  request_id VARCHAR(64) NOT NULL DEFAULT '',
  trace_id VARCHAR(64) NOT NULL DEFAULT '',
  source VARCHAR(255) NOT NULL DEFAULT '',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_operation_logs_target_user (target_user_id),
  INDEX idx_operation_logs_operator (operator_id),
  INDEX idx_operation_logs_type (type),
  INDEX idx_operation_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE users SET
  account = CASE id
    WHEN 1 THEN 'admin'
    WHEN 2 THEN 'teacher.li'
    WHEN 3 THEN 'student.wang'
    ELSE CONCAT('user.', id)
  END,
  password = CASE id
    WHEN 1 THEN 'admin123'
    WHEN 2 THEN 'teacher123'
    WHEN 3 THEN 'student123'
    ELSE CONCAT('pass', id)
  END,
  sso_provider = 'feishu',
  sso_subject = CASE id
    WHEN 1 THEN 'admin@lab.local'
    WHEN 2 THEN 'teacher.li@lab.local'
    WHEN 3 THEN 'student.wang@lab.local'
    ELSE CONCAT('user', id, '@lab.local')
  END,
  enabled = 1,
  role_updated_at = COALESCE(role_updated_at, NOW())
WHERE account = '' OR password = '' OR sso_provider = '' OR sso_subject = '' OR role_updated_at IS NULL;

INSERT INTO operation_logs (
  type, target_user_id, target_user_name,
  before_role, after_role, before_enabled, after_enabled,
  message, operator_id, operator_name, operator_role,
  request_id, trace_id, source, ip, created_at
)
SELECT
  'ROLE_CHANGED',
  u.id,
  u.name,
  u.role,
  u.role,
  u.enabled,
  u.enabled,
  '初始化角色与账号认证信息',
  1,
  '系统管理员',
  'super_admin',
  'migration-002',
  'migration-002',
  'migration',
  '127.0.0.1',
  NOW()
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM operation_logs l WHERE l.request_id = 'migration-002' LIMIT 1
);
