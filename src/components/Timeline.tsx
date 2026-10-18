import type { Calling } from "@prisma/client";

export function Timeline({ calling }: { calling: Calling }) {
  const approved = calling.status === "APPROVED" || calling.status === "PROCESSED";
  const presidiumDone = calling.status !== "PRESIDIUM_VOTING" && calling.status !== "PRESIDIUM_PAUSED";

  const steps = [
    { label: "Voorstel aangemaakt", done: true },
    { label: "Ringpresidium akkoord", done: presidiumDone },
    { label: "Hoge raad akkoord", done: approved },
    { label: "Geroepen", done: !!calling.roepenDoneAt },
    { label: "Ondersteund", done: !!calling.ondersteunenDoneAt },
    { label: "Aangesteld", done: !!calling.aanstellenDoneAt },
    { label: "Verwerkt", done: !!calling.processedAt },
  ];

  return (
    <ol className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-sm">
          <span className={s.done ? "text-[var(--success)]" : "text-[var(--text-muted)]"}>{s.done ? "✓" : "○"}</span>
          <span className={s.done ? "" : "text-[var(--text-muted)]"}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
