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

  if (
    !state.puzzles.some(
      (puzzle) => puzzle.id === id,
    )
  ) {
    return NextResponse.json(
      { error: "拼图不存在。" },
      { status: 404 },
    );
  }

  const userMap = new Map(
    state.app_users.map((row) => [
      row.id,
      row.username,
    ]),
  );

  const comments = state.puzzle_comments
    .filter(
      (comment) =>
        comment.puzzle_id === id,
    )
    .sort(
      (a, b) =>
        String(a.created_at).localeCompare(
          String(b.created_at),
        ),
    )
    .map((comment) => ({
      id: comment.id,
      user_id: comment.user_id,
      username:
        userMap.get(comment.user_id) ??
        "已删除成员",
      content: comment.content,
      created_at: comment.created_at,
    }));

  return NextResponse.json(
    { comments },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(
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

  const content =
    typeof body?.content === "string"
      ? body.content
          .normalize("NFKC")
          .trim()
      : "";

  if (
    !content ||
    Array.from(content).length > 300
  ) {
    return NextResponse.json(
      {
        error:
          "留言需要是 1–300 个字符。",
      },
      { status: 400 },
    );
  }

  const comment = await mutateState(
    (state) => {
      const puzzle = state.puzzles.find(
        (row) => row.id === id,
      );

      if (!puzzle) {
        throw new Error(
          "Puzzle not found",
        );
      }

      const created = {
        id: uuid(),
        puzzle_id: id,
        user_id: user.id,
        content,
        created_at: isoNow(),
      };

      state.puzzle_comments.push(created);

      // Allows existing snapshot polling to notice
      // that this puzzle has new detail data.
      puzzle.updated_at = isoNow();

      return created;
    },
  );

  return NextResponse.json(
    {
      comment: {
        ...comment,
        username: user.username,
      },
    },
    { status: 201 },
  );
}
