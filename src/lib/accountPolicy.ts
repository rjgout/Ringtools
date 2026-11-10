/** Serverbeleid, zonder bijzondere tenant-ID's in de app. Dezelfde grens bestaat als databaseconstraint. */
export function accountCanUseRing(user: { accountKind?: string; reviewRingId?: string | null; role?: string }, ring: { id: string; isDemo?: boolean }): boolean {
  if (user.accountKind === "AUDIT") return false;
  return user.accountKind === "REVIEW"
    ? user.role !== "ADMIN" && ring.isDemo === true && user.reviewRingId === ring.id
    : !ring.isDemo;
}
