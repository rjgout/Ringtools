"use client";

export function RecoveryCodesReveal({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">
        Bewaar deze eenmalige herstelcodes op een veilige plek (bv. een wachtwoordmanager). Elke code werkt één keer en
        geeft toegang als je authenticator-app niet beschikbaar is. Ze worden hierna niet meer getoond.
      </p>
      <div className="recovery-codes">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
    </div>
  );
}
