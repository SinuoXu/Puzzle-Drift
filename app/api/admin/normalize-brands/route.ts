import { NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  createStateBackup,
  mutateState,
  readState,
} from "@/lib/edgeone-store";
import { canonicalizeKnownBrand } from "@/lib/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getReadyUser();
  return user?.is_admin ? user : null;
}

function previewChanges(
  puzzles: Record<string, any>[],
) {
  return puzzles
    .map((puzzle) => {
      const before =
        typeof puzzle.brand === "string"
          ? puzzle.brand
          : "";

      const after =
        canonicalizeKnownBrand(before);

      if (before === after) return null;

      return {
        puzzle_id: puzzle.id,
        puzzle_name: puzzle.name,
        before,
        after,
      };
    })
    .filter(Boolean);
}

export async function GET() {
  const admin = await requireAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "只有管理员可以整理品牌。" },
      { status: 403 },
    );
  }

  const state = await readState();
  const changes = previewChanges(state.puzzles);

  return NextResponse.json(
    {
      changed: changes.length,
      changes,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST() {
  const admin = await requireAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "只有管理员可以整理品牌。" },
      { status: 403 },
    );
  }

  /*
   * Full snapshot backup first.
   * The following mutateState only assigns puzzle.brand.
   */
  const backupKey =
    await createStateBackup(
      "before-brand-normalization",
    );

  const result = await mutateState((state) => {
    const changes: {
      puzzle_id: string;
      puzzle_name: string;
      before: string;
      after: string;
    }[] = [];

    for (const puzzle of state.puzzles) {
      const before =
        typeof puzzle.brand === "string"
          ? puzzle.brand
          : "";

      const after =
        canonicalizeKnownBrand(before);

      if (before === after) continue;

      changes.push({
        puzzle_id: puzzle.id,
        puzzle_name:
          puzzle.name ?? "未命名拼图",
        before,
        after,
      });

      // Intentionally ONLY modify brand.
      puzzle.brand = after;
    }

    return {
      changed: changes.length,
      changes,
    };
  });

  return NextResponse.json({
    ok: true,
    backup_key: backupKey,
    ...result,
  });
}
