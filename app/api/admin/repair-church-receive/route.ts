import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getDataStore, isoNow, mutateState, readState, uuid } from "@/lib/edgeone-store";
import { applyChurchRepair, CHURCH_REPAIR, digest, inspectChurchRepair } from "@/lib/repair-church-receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function page(content: string, status = 200) {
  return new NextResponse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>教会拼图收货修复</title><style>body{max-width:720px;margin:48px auto;padding:24px;font:17px/1.8 system-ui;color:#223}button{padding:14px 22px;font:inherit}code{overflow-wrap:anywhere}</style><h1>教会拼图收货修复</h1>${content}</html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" },
  });
}

async function authorized() {
  const user = await getReadyUser();
  return user?.is_admin && user.id === CHURCH_REPAIR.recipientId;
}

export async function GET() {
  if (!await authorized()) return page("<p>仅 nono 管理员可以核对这次修复。</p>", 403);
  try {
    const plan = inspectChurchRepair(await readState());
    if (plan.alreadyRepaired) return page(`<h2>修复已完成</h2><p>已恢复 nono 的收货入口。请回到拼图详情补传真实收货照片和日期。</p><p>备份：<code>${escape(String(plan.audit.backup_key))}</code></p><p><a href="/">回到 Puzzle Drift</a></p>`);
    return page(`<h2>核对结果</h2><p>拼图：圣伊格内修斯教会（504 片），图主：唐女士。</p><p>系统现为唐女士持有、nono 第 1 棒排队。将按 nono 已确认的实物交接，改为 nono 当前持有，并恢复“收货留存”待办。</p><p>执行前完整备份并校验；不代填收货/发货日期、图片或邮费；其他拼图与排队顺序不变。</p><form method="post"><input type="hidden" name="fingerprint" value="${plan.fingerprint}"><button type="submit" name="action" value="restore_receive">备份并恢复 nono 收货入口</button></form>`);
  } catch (error) {
    return page(`<p>${escape(error instanceof Error ? error.message : "核对失败，请稍后重试。")}</p>`, 409);
  }
}

export async function POST(request: NextRequest) {
  if (!await authorized()) return page("<p>仅 nono 管理员可以执行这次修复。</p>", 403);
  const origin = request.headers.get("origin");
  if (origin !== "https://puzzle.thebookpuzzle.com") return page("<p>请从网站的修复页面提交。</p>", 403);
  try {
    const form = await request.formData();
    const fingerprint = form.get("fingerprint");
    if (form.get("action") !== "restore_receive" || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      return page("<p>请求无效，请重新核对。</p>", 400);
    }
    const audit = await mutateState(async (state) => {
      const plan = inspectChurchRepair(state);
      if (plan.alreadyRepaired) return plan.audit;
      if (plan.fingerprint !== fingerprint) throw new Error("核对后数据有变化，请重新打开修复页。");
      const now = isoNow();
      const backupKey = `backups/${now.replace(/[:.]/g, "-")}-before-church-receive-${uuid()}.json`;
      const store = getDataStore();
      await store.setJSON(backupKey, state, { onlyIfNew: true });
      const backup = await store.get(backupKey, { type: "json", consistency: "strong" });
      if (!backup || digest(backup) !== digest(state)) throw new Error("备份校验未通过，未修改流转数据。");
      return applyChurchRepair(state, fingerprint, backupKey, now, uuid());
    });
    const verified = inspectChurchRepair(await readState());
    if (!verified.alreadyRepaired) throw new Error("修复后读取未确认，请先核对，不要重复提交。");
    return page(`<h2>修复成功</h2><p>nono 已成为《圣伊格内修斯教会》的当前持有人，收货留存待办已恢复。</p><p>收货照片和日期仍待你上传。</p><p>备份已校验保存：<code>${escape(String(audit.backup_key))}</code></p><p><a href="/">回到 Puzzle Drift 上传收货留存</a></p>`);
  } catch (error) {
    console.error("Church receive repair failed", error);
    return page(`<p>${escape(error instanceof Error ? error.message : "修复失败，请先核对状态。")}</p><p><a href="/api/admin/repair-church-receive">重新核对</a></p>`, 409);
  }
}
