import { getCurrentUser } from "@/lib/session";
import { getRingContext } from "@/lib/ringContext";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ notifications: [], unreadCount: 0 }, { status: 401 });

  const ctx = await getRingContext();
  if (!ctx) return Response.json({ notifications: [], unreadCount: 0 });

  // Server-side afgedwongen: uitsluitend meldingen van de ingelogde
  // gebruiker zelf én van de actieve ring, nooit van iemand anders of van
  // een andere ring.
  const where = { userId: user.id, ringId: ctx.ring.id };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  return Response.json({ notifications, unreadCount });
}
