import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isUploadedImageUrl } from "@/lib/image-url";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { id } = await context.params;
  const input = await request.json().catch(() => null);
  if (!input || !Number.isSafeInteger(input.amount_cents) || input.amount_cents <= 0) {
    return NextResponse.json({ error: "请填写正确的邮费金额。" }, { status: 400 });
  }
  if (input.receipt_url && !isUploadedImageUrl(input.receipt_url, "receipt", user.id)) {
    return NextResponse.json({ error: "运费截图地址不正确。" }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin().rpc("v03_fee", {
    p_puzzle_id: id, p_user_id: user.id, p_amount_cents: input.amount_cents,
    p_tracking: typeof input.tracking_number === "string" ? input.tracking_number : "",
    p_receipt: typeof input.receipt_url === "string" ? input.receipt_url : null,
    p_return: input.return_home === true,
  });
  if (error) return NextResponse.json({ error: "填写邮费失败，请检查当前流转状态。" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
