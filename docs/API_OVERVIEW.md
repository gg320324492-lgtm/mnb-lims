# API 概览

## 健康检查
- GET /api/health

## 设备
- GET /api/devices
- POST /api/devices

## 借用
- GET /api/borrows
- POST /api/borrows
- PATCH /api/borrows/:id/status

## 耗材
- GET /api/consumables
- POST /api/consumables
- GET /api/warehouses
- GET /api/consumables/stock-alerts

## 出入库（进货/出货）
- GET /api/stock-movements
- POST /api/stock-movements

## 耗材申领
- GET /api/consumable-applications
- POST /api/consumable-applications
- PATCH /api/consumable-applications/:id/status

## 审批中心
- GET /api/approvals
- POST /api/approvals/:id/action

## AI 助手（MVP 规则引擎）
- POST /api/ai/ask
