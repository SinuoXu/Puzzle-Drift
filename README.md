# Puzzle Drift v0.3

拼图漂流管理网页。Next.js、Supabase PostgreSQL 与 Storage；Vercel 从 GitHub `main` 部署。

## 从 v0.2 升级

1. 先按 [备份与恢复说明](BACKUP_RECOVERY.md) 导出生产数据库和 `puzzle-images` 中的全部图片，并在独立项目验证可恢复。Supabase Free 没有自动备份；数据库备份不含图片文件。
2. 在生产 Supabase SQL Editor **仅执行** [`supabase/migration_v0_3.sql`](supabase/migration_v0_3.sql)。不要在现有项目运行 `schema.sql` 或 `schema_fresh.sql`。
3. 确认 Vercel 环境变量 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`，以及可选的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 仍指向该项目。v0.3 不需要新密钥。
4. 刷新网站，在原设备已登录的旧账号进入“个人中心”设置 6 位 PIN。丢失旧 session 的成员由 `nono` 管理员在个人中心核实身份并生成临时 PIN。PIN 只以 bcrypt 哈希存储。

GitHub push 只更新代码，不会自动执行数据库迁移、备份或恢复。新建空项目应先运行 `schema.sql`、`migration_v0_2.sql`，再运行 `migration_v0_3.sql`；`schema_fresh.sql` 仅包含 v0.2 结构，不能单独安装 v0.3。

## 功能

- 用户名 + 6 位 PIN；同设备一年有效 session；`nono` 为管理员。
- 个人资料可设置头像、收货地址和收款码。已登录成员点击其他人的头像可查看其主页、地址和收款码。
- 漂流中心桌面两列卡片；按名称、品牌、图主和状态筛选。公开状态为正在漂、没在漂、退役。
- 收货、发货留存可上传多张图和备注。每张上传前压缩并硬性限制小于 1 MB。留存仅在进入拼图详情后加载。
- “我的待办”显示收发货留存、填写邮费、支付邮费和回家邮费。发货方可复制收件地址；收件方可查看金额和收款码并标记已支付。
- 图主第一棒只填邮费，不需发货留存。最后一棒寄回图主时，已实际参与漂流的排队成员按整数分平摊回家邮费；最后一棒自己承担自己的份额。
- 可选择面交：不需要双方的收发货留存或邮费待办，数据库保留独立面交记录。最后一棒也可面交还给图主。
- 等待中的成员可向前或向后移动一位；已完成、运输中或已分配邮费的棒次不能移动。
- 关键流转和待办在 PostgreSQL RPC 事务中同步更新。Realtime 仅触发刷新，页面仍会定时校准。

## 开发

```bash
npm install
npm run build
```

Vercel 服务端使用 Supabase service role；不要把它放进 `NEXT_PUBLIC_` 变量或提交到 Git。现有 `puzzle-images` 是 public bucket，因此拥有图片 URL 的人可以访问图片；个人地址只通过需要登录的 API 返回。
