import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (err) {
    console.error("[health] Database niet bereikbaar:", err);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
