import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Lichtgewicht endpoint, bedoeld om met een korte interval gepolld te
// worden voor de badge op de notificatiebel: alleen een COUNT-query, geen
// volledige lijst (die wordt pas opgehaald zodra het paneel echt geopend
// wordt), om onnodige databasebelasting te voorkomen.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ count: 0 }, { status: 401 });

  const count = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  return Response.json({ count });
}
