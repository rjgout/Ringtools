export function StatCard({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number;
  href: string;
  tone?: "default" | "success" | "danger";
}) {
  const toneClass = tone === "success" ? "text-[var(--success)]" : tone === "danger" ? "text-[var(--danger)]" : "text-[var(--text)]";
  return (
    <a href={href} className="glass-card block !p-4">
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{label}</div>
    </a>
  );
}
