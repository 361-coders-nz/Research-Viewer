import { Liveblocks } from "@liveblocks/node";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const secret = process.env.LIVEBLOCKS_SECRET_KEY;

export async function POST(request: Request) {
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "LIVEBLOCKS_SECRET_KEY is not set. Either add it to .env.local, or set NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY to use public-key auth.",
      },
      { status: 500 },
    );
  }

  const liveblocks = new Liveblocks({ secret });

  const body = (await request.json().catch(() => ({}))) as {
    user?: { id?: string; name?: string; color?: string };
    room?: string;
  };

  const userId = body.user?.id ?? crypto.randomUUID();
  const userInfo = {
    name: body.user?.name ?? "Anon",
    color: body.user?.color ?? "#10B981",
  };

  const session = liveblocks.prepareSession(userId, { userInfo });
  // Full access to any oxflow-studio:* room — no server-side ACLs in v1.
  session.allow(
    "oxflow-studio:*",
    session.FULL_ACCESS,
  );

  const { status, body: authBody } = await session.authorize();
  return new NextResponse(authBody, { status });
}
