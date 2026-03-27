# 管理后台

当前已补充一个无需构建的静态管理后台页面，由后端直接托管。

## 当前页面
- 数据概览
- 审批中心
- 设备台账
- 耗材台账
- 借用记录
- 申领记录
- 用户与权限（账号禁用、角色变更、操作日志）

## 登录方式（已升级）
- 账号密码登录（`account + password`）
- SSO 登录（`ssoProvider + ssoSubject`）

默认测试账号（mock 数据）：
- 管理员：`admin / admin123`
- 教师：`teacher.li / teacher123`

## 打开方式
1. 进入 backend 目录执行 npm start
2. 浏览器访问 http://localhost:3000/admin/

## 下一步建议
- 补新增/编辑弹窗
- 增加登录鉴权
- 接入正式数据库 MySQL
- 将后台改造为 Vue3 项目
