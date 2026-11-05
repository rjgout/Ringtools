"use client";

import { useFormStatus } from "react-dom";

/** Submit-knop die tijdens het verwerken uitgeschakeld is: voorkomt dubbel klikken (bijv. tijdens een vergadering met trage verbinding). */
export function SubmitButton({ children, className = "btn btn-primary", pendingLabel = "Bezig…" }: { children: React.ReactNode; className?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
