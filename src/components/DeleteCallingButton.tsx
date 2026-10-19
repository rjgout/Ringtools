"use client";

import { useRef } from "react";
import { deleteCallingAction } from "@/lib/actions/calling.actions";

/**
 * "Voorstel verwijderen" met een bevestigingsscherm. Het formulier bevat pas
 * `confirmed=yes` binnen het bevestigingsscherm; de server controleert dat
 * veld en de bevoegdheid opnieuw.
 */
export function DeleteCallingButton({ callingId }: { callingId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className="btn-danger !flex-none px-5" onClick={() => dialogRef.current?.showModal()}>
        Voorstel verwijderen
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`delete-title-${callingId}`}
        className="glass-card m-auto w-[min(92vw,28rem)] text-[var(--text)] backdrop:bg-black/40"
      >
        <form action={deleteCallingAction} className="space-y-4">
          <input type="hidden" name="callingId" value={callingId} />
          <input type="hidden" name="confirmed" value="yes" />
          <h2 id={`delete-title-${callingId}`} className="font-semibold">
            Voorstel verwijderen
          </h2>
          <p className="text-sm">
            Weet je zeker dat je dit roepingsvoorstel definitief wilt verwijderen? Alle bijbehorende ondersteuningsreacties
            en openstaande taken worden ook verwijderd. Dit kan niet ongedaan worden gemaakt.
          </p>
          <div className="flex gap-3">
            <button type="button" className="btn-ghost flex-1" onClick={() => dialogRef.current?.close()}>
              Annuleren
            </button>
            <button type="submit" className="btn-danger">
              Definitief verwijderen
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
