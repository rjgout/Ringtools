import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ notifications: [], unreadCount: 0 }, { status: 401 });

  // Server-side afgedwongen: uitsluitend meldingen van de ingelogde
  // gebruiker zelf, nooit van iemand anders.
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return Response.json({ notifications, unreadCount });
}
