import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  isoNow,
  mutateState,
  readState,
  uuid,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getReadyUser();

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "无效的拼图。" },
      { status: 400 },
    );
  }

  const state = await readState();

  if (!state.puzzles.some((row) => row.id === id)) {
    return NextResponse.json(
      { error: "拼图不存在。" },
      { status: 404 },
    );
  }

  const userMap = new Map(
    state.app_users.map((row) => [
      row.id,
      row,
    ]),
  );

  const likes = state.puzzle_likes
    .filter((row) => row.puzzle_id === id)
    .sort((a, b) =>
      String(a.created_at).localeCompare(
        String(b.created_at),
      ),
    )
    .map((row) => {
      const member = userMap.get(row.user_id);

      return {
        id: row.id,
        user_id: row.user_id,
        username: member?.username ?? "已删除成员",
        avatar_url: member?.avatar_url ?? null,
        created_at: row.created_at,
      };
    });

  return NextResponse.json(
    {
      liked_by_me: likes.some(
        (row) => row.user_id === user.id,
      ),
      likes,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getReadyUser();

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "无效的拼图。" },
      { status: 400 },
    );
  }

  const body = await request
    .json()
    .catch(() => null);

  if (!body || typeof body.liked !== "boolean") {
    return NextResponse.json(
      { error: "请求格式不正确。" },
      { status: 400 },
    );
  }

  const result = await mutateState((state) => {
    const puzzle = state.puzzles.find(
      (row) => row.id === id,
    );

    if (!puzzle) {
      throw new Error("Puzzle not found");
    }

    const existingIndex =
      state.puzzle_likes.findIndex(
        (row) =>
          row.puzzle_id === id &&
          row.user_id === user.id,
      );

    if (body.liked && existingIndex < 0) {
      state.puzzle_likes.push({
        id: uuid(),
        puzzle_id: id,
        user_id: user.id,
        created_at: isoNow(),
      });
    }

    if (!body.liked && existingIndex >= 0) {
      state.puzzle_likes.splice(existingIndex, 1);
    }

    return {
      liked: body.liked,
    };
  });

  return NextResponse.json(result);
}
