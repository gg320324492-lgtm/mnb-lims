CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  phone VARCHAR(32) DEFAULT ''
);

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64) NOT NULL,
  category VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  lab_id BIGINT NULL,
  qr_token VARCHAR(128) DEFAULT '',
  qr_enabled TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS consumables (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  photo_data_url LONGTEXT,
  qr_token VARCHAR(128) DEFAULT '',
  qr_enabled TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS consumable_stocks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  warehouse_id BIGINT NOT NULL,
  consumable_id BIGINT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  safe_stock INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_stock_warehouse_consumable (warehouse_id, consumable_id)
);

CREATE TABLE IF NOT EXISTS borrows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  device_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  purpose VARCHAR(255) DEFAULT '',
  borrow_date DATE NOT NULL,
  expected_return_date DATE NOT NULL,
  expected_return_time VARCHAR(16) NOT NULL DEFAULT '18:00',
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS consumable_applications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  consumable_id BIGINT NOT NULL,
  warehouse_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  purpose VARCHAR(255) DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS approvals (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(64) NOT NULL,
  business_id BIGINT NOT NULL,
  applicant_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  remark VARCHAR(255) DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

INSERT INTO users (id, name, role, phone) VALUES
(1, '系统管理员', 'super_admin', '13800000000'),
(2, '李老师', 'teacher', '13800000001'),
(3, '王同学', 'student', '13800000002')
ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), phone = VALUES(phone);

INSERT INTO warehouses (id, name) VALUES
(1, '实验室仓库'),
(2, '厂房仓库')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO devices (id, name, code, category, status, lab_id, qr_token, qr_enabled) VALUES
(1, '示波器', 'DEV-001', '电子仪器', 'available', 2, 'dev_osc12345', 1),
(2, '恒温水浴锅', 'DEV-002', '化学仪器', 'available', 1, 'dev_bath6789', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);

INSERT INTO consumables (id, name, category, unit, qr_token, qr_enabled) VALUES
(1, '一次性手套', '防护用品', '盒', 'cons_glove123', 1),
(2, 'PH 试纸', '检测耗材', '包', 'cons_phtest456', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category);

INSERT INTO consumable_stocks (id, warehouse_id, consumable_id, stock, safe_stock) VALUES
(1, 1, 1, 20, 5),
(2, 1, 2, 8, 10),
(3, 2, 1, 2, 5),
(4, 2, 2, 12, 10)
ON DUPLICATE KEY UPDATE stock = VALUES(stock), safe_stock = VALUES(safe_stock);

INSERT INTO borrows (id, device_id, user_id, purpose, borrow_date, expected_return_date, expected_return_time, status) VALUES
(1, 1, 3, '电子课程实验', '2026-03-20', '2026-03-21', '18:00', 'pending')
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO consumable_applications (id, consumable_id, warehouse_id, user_id, quantity, purpose, status) VALUES
(1, 1, 1, 3, 2, '课堂实验使用', 'pending')
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO approvals (id, type, business_id, applicant_id, status, remark, created_at, updated_at) VALUES
(1, 'borrow', 1, 3, 'pending', '', '2026-03-19 00:10:00', NULL),
(2, 'consumable_application', 1, 3, 'pending', '', '2026-03-19 00:20:00', NULL)
ON DUPLICATE KEY UPDATE status = VALUES(status), remark = VALUES(remark), updated_at = VALUES(updated_at);
