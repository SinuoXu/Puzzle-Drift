# Puzzle Drift 数据备份与恢复

## 当前状态

代码提交与 Vercel 部署不会清空 Supabase 数据。`migration_v0_3.sql` 只添加列、表、索引、函数并回填旧留存图片数组；不删除现有用户、会话、拼图、队列、流转、活动或 List 数据，也不删除 Storage 对象。

**Supabase Free 没有自动数据库备份。** 仅有迁移文件不等于已经备份。数据库备份也不包含 Storage 中的图片对象。必须分别备份数据库与 `puzzle-images` bucket，并把备份副本保存在 Supabase 项目以外。参见 [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups) 和 [Download Objects](https://supabase.com/docs/guides/storage/management/download-objects)。

目前仓库没有生产数据库连接串或 Supabase 管理令牌，因此**没有替生产环境执行备份、验证恢复或执行迁移**。在完成以下步骤前，不应运行迁移。

## 迁移前

1. 暂停写入或安排短暂维护时段，记录当前 UTC 时间、数据库项目 ID、各表行数和 `puzzle-images` 对象数。
2. 从 Supabase Dashboard → Connect 取得生产数据库连接串。仅在本机环境变量中使用，绝不提交到 Git。
3. 使用匹配服务器主版本的 `pg_dump` 生成完整自定义格式备份：

   ```bash
   pg_dump --dbname="$PUZZLE_DRIFT_DATABASE_URL" --format=custom --no-owner --no-acl --file="puzzle-drift-before-v0.3.dump"
   pg_restore --list "puzzle-drift-before-v0.3.dump" > "puzzle-drift-before-v0.3.contents.txt"
   shasum -a 256 puzzle-drift-before-v0.3.dump > puzzle-drift-before-v0.3.sha256
   ```

4. 按 [Supabase Storage 下载指南](https://supabase.com/docs/guides/storage/management/download-objects) 将 `puzzle-images` 中**所有对象**下载到独立目录；保留完整对象路径、对象清单与每个文件校验和。检查下载数量和 bucket 对象数量一致，抽样打开封面、旧留存图片。
5. 将数据库备份、Storage 目录、清单和校验和加密复制到另一地点。不要放在本仓库、Vercel 或同一个 Supabase 项目里。
6. 在单独测试项目恢复数据库与图片，确认 `app_users`、`app_sessions`、`puzzles`、`puzzle_journey`、`puzzle_activity`、`list_items` 行数与图片数量，并实际打开几张图片。只有验证通过后，才在生产 SQL Editor 执行 `supabase/migration_v0_3.sql`。

## 恢复

1. 停止生产写入，保留事故现场，不在原库上盲目重复执行导入。
2. 在新 Supabase 项目中建立相同区域与配置，先用 `pg_restore` 恢复备份，再按 Supabase 的 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) 检查角色、扩展、Storage 元数据等项目差异。
3. 将对象按原 bucket 路径上传到新项目的 `puzzle-images`；核对对象清单与校验和。数据库备份不会恢复图片二进制文件。
4. 在测试域名验证登录、图片、排队、流转、List 数据及待办，再调整 Vercel 环境变量指向恢复项目。
5. 记录恢复点时间；恢复点后的写入需要从事故前日志或用户报告补录。

## 长期安排

至少每日自动导出数据库和 Storage 到项目外的加密位置，并定期做恢复演练。Supabase Pro 提供每日自动数据库备份，但仍需另行备份 Storage 对象；如需更小的数据丢失窗口，评估 PITR。未配置并验证自动化前，不能声称“数据绝不会丢”。
