import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  isRegistrationOpen,
  setRegistrationOpen,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getReadyUser();
  return user?.is_admin ? user : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "只有管理员可以查看注册设置。" }, { status: 403 });
  }

  return NextResponse.json(
    { registration_open: await isRegistrationOpen() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "只有管理员可以修改注册设置。" }, { status: 403 });
  }

  const input = await request.json().catch(() => null);
  if (!input || typeof input.open !== "boolean") {
    return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
  }

  await setRegistrationOpen(input.open);

  return NextResponse.json({
    ok: true,
    registration_open: input.open,
  });
}
