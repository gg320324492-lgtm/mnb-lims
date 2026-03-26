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
- 自动部署：`main` 推送后触发 `.github/workflows/deploy-backend.yml`
- 健康检查：`GET /api/health`
- PM2 进程名：`lab-miniapp-backend-staging`
- Nginx 站点：`/etc/nginx/conf.d/lab-miniapp-staging.conf`

### 一键回滚到稳定标签
在服务器执行：

```bash
bash /srv/lab-miniapp-mvp-staging/scripts/rollback-to-tag.sh deploy-ok-2026-03-26
```

> 若未传标签参数，默认回滚到 `deploy-ok-2026-03-26`。
