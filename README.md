# Puzzle Drift v0.2

这一版把 V0.1 的共享 List 升级成了一个真正的「拼图漂流库」。

## 已实现

- 用户名进入 + 同设备长期 Session
- `nono` 自动标记为管理员
- 发布拼图：名称、品牌、封面、介绍、图主自动绑定当前用户
- 漂流中心：全部图库、图名/品牌搜索、品牌筛选、状态筛选
- 个人中心：我的拼图 / 我正在持有 / 我的排队
- 消息中心：新图、排队、收货留存、发货留存、持有人变化会自动产生动态
- 共用 `PuzzleCard`，不同模块展示的是同一份 Puzzle 数据
- 每张图独立详情页（Modal）：图主、当前持有人、排队队列、留存记录
- 排队按时间顺序进入
- 当前持有人绿色高亮
- 收货留存：日期 + 图片 + 备注
- 发货留存：日期 + 图片 + 备注
- 提交发货留存后，下一棒在**同一个数据库事务**里立即变成当前持有人
- 图主 / 管理员可编辑拼图和暂停/结束漂流
- 图主 / 管理员可删除拼图
- 图片上传前会在浏览器端尝试压缩，服务端限制 6 MB
- Supabase Storage 保存图片；PostgreSQL 只保存 URL 和结构化数据
- 在线设备优先通过 Supabase Realtime Broadcast 立即刷新；即使 Realtime 不可用，也会每 10 秒重新校准

## 重要说明

当前依然是「无密码用户名」模式。任何知道用户名的人，都可以在另一台设备输入这个用户名。因此 `nono` 的管理员身份也**不是真正安全的管理员认证**。这适合熟人内部 V0.2，不适合公开网站。后续加正式登录时，数据库结构不需要推倒重来。

---

# 从当前 V0.1 升级

## 1. Supabase：运行迁移 SQL

打开：

`Supabase Dashboard -> Puzzle Drift -> SQL Editor -> New query`

复制并运行：

`supabase/migration_v0_2.sql`

它会：

- 保留你原来的 `app_users` / `app_sessions`
- 保留旧 `list_items`（但 V0.2 不再使用）
- 新建 `puzzles`
- 新建 `puzzle_journey`
- 新建 `puzzle_activity`
- 新建 `puzzle-images` Storage bucket
- 创建原子化的排队 / 收货 / 发货 RPC
- 如果已经存在用户名 `nono`，自动设为管理员

不要在现有项目运行 `schema_fresh.sql`。它是以后从空 Supabase 项目安装时用的。

## 2. Vercel：保留原来的两个服务端变量

已有：

```env
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxx
```

## 3. Vercel：推荐再加两个公开变量，实现近实时同步

在 Supabase：

`Settings -> API Keys`

找到 Publishable key（`sb_publishable_...`；旧项目也可能显示 anon/public key）。

在 Vercel Environment Variables 新增：

```env
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的 publishable key
```

注意：这里必须是 **Publishable / anon key**，绝对不能把 `SUPABASE_SECRET_KEY` 写成 `NEXT_PUBLIC_...`。

如果暂时不加这两个变量，网站仍能工作，只是其他人的更新最多约 10 秒后显示，而不是近实时显示。

## 4. GitHub：用这一版覆盖仓库代码

把本压缩包里的文件复制到你本地 `puzzle-drift` 仓库根目录，覆盖同名文件，然后：

```bash
git add .
git commit -m "Upgrade Puzzle Drift to v0.2 library and drift flow"
git push origin main
```

Vercel 已连接 GitHub 的话会自动重新部署。

## 5. 部署后测试顺序

建议用普通窗口 + 无痕窗口模拟两个用户：

1. `nono` 登录，确认右上角显示「管理员」
2. nono 发布一张新拼图
3. 另一用户进入「消息中心」，应看到新图动态
4. 「漂流中心」应同时出现新图
5. 第二位用户打开拼图并点击「加入排队」
6. nono 打开拼图，应看到队列里第二位用户
7. nono 上传「发货留存」
8. 第二位用户应立即变成绿色「当前持有」
9. 第二位用户上传「收货留存」
10. 消息中心和拼图详情应同步出现留存状态

---

# 数据一致性设计

这一版特意没有把“拼图卡片、个人中心、消息中心”做成三套数据。

所有页面都来自同一份数据库状态：

```text
puzzles
   ├── 消息中心
   ├── 漂流中心
   └── 个人中心
```

一次发货涉及的多步修改：

```text
当前用户 -> completed
下一位 -> current
puzzles.current_holder_id -> 下一位
活动消息 -> 自动产生
```

不是由前端一条一条执行，而是在 PostgreSQL RPC 事务中一起完成。这样不会出现“列表说在 A 手里，但详情页说在 B 手里”的半更新状态。

---

# 图片

当前图片使用 Supabase Storage 的 `puzzle-images` public bucket。

这是为了匹配当前“无密码内部项目”的安全级别，并让 V0.2 足够简单。后续如果加入正式认证，可以把 bucket 改成 private + signed URL；以后迁到 EdgeOne Blob / 腾讯 COS 时，也只需要迁文件并更新 URL，不需要重做 Puzzle / Queue / Activity 数据。
