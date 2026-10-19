import { getCurrentUser } from "@/lib/session";
import { isStaff } from "@/lib/rbac";
import { getStaffDashboardCounts, getHogeraadOverview } from "@/lib/queries";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ count: 0 }, { status: 401 });

  let count = 0;
  if (user.role === "ADMIN") {
    count = 0;
  } else if (isStaff(user.role)) {
    const counts = await getStaffDashboardCounts();
    count = counts.paused + counts.readyToProcess;
  } else {
    const { pendingVotes, tasks } = await getHogeraadOverview(user.id);
    count = pendingVotes.length + tasks.length;
  }

  return Response.json({ count });
}
