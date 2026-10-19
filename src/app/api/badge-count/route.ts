import { getCurrentUser } from "@/lib/session";
import { getPendingActionCount } from "@/lib/queries";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ count: 0 }, { status: 401 });

  // De webmin neemt niet deel aan het roepingenproces; voor ieder ander is dit
  // het aantal openstaande acties over alle ringen waarvan de gebruiker actief
  // lid is (een apparaat-badge hoort niet bij één ring).
  const count = user.role === "ADMIN" ? 0 : await getPendingActionCount(user.id);
  return Response.json({ count });
}
