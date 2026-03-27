# 实验室管理小程序 MVP

这是一个适合个人全栈开发的实验室管理小程序最小可用版本（MVP）。

## 当前范围
- 设备借用与归还
- 耗材申领与库存扣减
- 审批中心
- 后台与小程序目录预留

## 当前目录
- docs：需求范围与接口说明
- backend：Node.js API 原型服务
- admin：后台管理端预留
- miniapp：小程序端预留

## 建议开发顺序
1. 跑通后端接口
2. 做后台审批与基础台账页
3. 再做小程序借用/申领流程

## 部署与回滚（简版）
- 自动部署触发：
  - `push main` -> `production`
  - `push staging` -> `staging`
  - `workflow_dispatch` 可手动选择 `deploy_env` + `source_ref`
- 健康检查：`GET /api/health`
- PM2 进程名：`lab-miniapp-backend-staging`
- Nginx 站点：`/etc/nginx/conf.d/lab-miniapp-staging.conf`

### 分支与环境映射（已固化）
- 映射文件：`.github/workflows/deploy-backend.yml`
- 规则：
  - `main` 永远对应生产
  - `staging` 永远对应预发
  - 手动触发可绕过“必须存在 staging 分支”的限制（用 `source_ref=main` 部署到 staging 也可）

### 密钥与凭据治理（可立即执行）
1. 立刻重置曾暴露的微信/第三方密钥。
2. 更新以下变量（至少 staging + production 各一套）：
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - 各类平台 API Key / webhook token
3. 将旧密钥加入废弃清单，确认日志与脚本中不再引用。
4. 轮换建议：每 90 天例行轮换一次；泄露事件触发“立即轮换”。

### 可观测性与告警
- 日志采集模板：`scripts/loki-promtail-config.yaml.template`
- 告警脚本：`scripts/monitor-min-alerts.sh`
  - 支持：`ALERT_CHANNEL=generic|feishu|dingtalk|wecom`
  - 触发：健康检查失败、PM2 重启过多、5xx 激增
- 建议将脚本加入 crontab（例如每 1 分钟）：

```bash
* * * * * ALERT_CHANNEL=feishu ALERT_WEBHOOK='https://open.feishu.cn/open-apis/bot/v2/hook/xxx' PM2_APP_NAME='lab-miniapp-backend-production' HEALTH_URL='http://127.0.0.1:3000/api/health' bash /srv/lab-miniapp-mvp/scripts/monitor-min-alerts.sh >> /var/log/lab-miniapp-monitor.log 2>&1
```

### 后端鉴权与限流（正式版建议）
- 写接口已收口到服务端登录态（基于 `req.user.id`），不再信任 body 传入的 `userId`。
- 登录支持账号密码 / SSO；`userId` 登录可通过 `AUTH_ALLOW_USER_ID_LOGIN` 开关逐步下线。
- 新增失败封禁策略：
  - `AUTH_FAIL_WINDOW_MS`
  - `AUTH_FAIL_MAX`
  - `AUTH_FAIL_BLOCK_MS`
- refresh 接口短窗防刷：
  - `AUTH_REFRESH_RATE_LIMIT_WINDOW_MS`
  - `AUTH_REFRESH_RATE_LIMIT_MAX`

建议：`staging/production` 环境将 `AUTH_ALLOW_USER_ID_LOGIN=false`，仅保留账号密码或 SSO。

### 小程序端登录态体验优化
- token 临近过期时会提示“正在续期”。
- 切换用户时会清空登录态与扫描上下文，避免串号。

### 自动化回归（已扩展异常分支）
- 权限边界：学生访问管理员日志接口应返回 403。
- 库存边界：超库存申领审批通过应失败。
- refresh 边界：无效 refreshToken 应返回 401。


### 自动 release notes（发布治理）
- Workflow：`.github/workflows/release-governance.yml`
- 手动触发后会自动：
  - 生成 release notes（commit 范围 + migration 摘要 + 回滚命令）
  - 自动打 tag（可自定义 `release_tag`）
  - 自动创建 GitHub Release 并上传 `release-notes.md`
- 生成脚本：`scripts/generate-release-notes.sh`

### 回滚入口脚本化（统一入口）
- 入口脚本：`scripts/rollback-entry.sh`
- 行为：自动识别环境最近 `deploy-ok-<env>-*` 标签，交互确认后调用 `scripts/rollback-to-tag.sh`
- 非交互执行示例：

```bash
ROLLBACK_CONFIRM=true DEPLOY_ENV=staging APP_ROOT=/srv/lab-miniapp-mvp-staging PM2_APP_NAME=lab-miniapp-backend-staging bash scripts/rollback-entry.sh
```
### 一键回滚到稳定标签（指定标签）

```bash
bash /srv/lab-miniapp-mvp-staging/scripts/rollback-to-tag.sh deploy-ok-2026-03-26
```

> 若未传标签参数，默认回滚到 `deploy-ok-2026-03-26`。
>
> 建议每次版本发布后做一次“故障注入 + 自动回滚”演练（如临时让健康检查失败），验证回滚链路真实可用。
