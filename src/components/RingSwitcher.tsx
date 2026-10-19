"use client";

import { switchRingAction } from "@/lib/actions/ring.actions";

/** Ringwisselaar voor gebruikers met meer dan één actieve ring. */
export function RingSwitcher({ rings, activeRingId }: { rings: { id: string; name: string }[]; activeRingId: string }) {
  return (
    <form action={switchRingAction}>
      <label className="sr-only" htmlFor="ring-switcher">
        Ring
      </label>
      <select
        id="ring-switcher"
        name="ringId"
        defaultValue={activeRingId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input !w-auto !py-2 text-sm"
      >
        {rings.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </form>
  );
}
