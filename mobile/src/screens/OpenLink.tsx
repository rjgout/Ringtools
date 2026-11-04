import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";

/** E-maillink (/open/<token>): de server controleert het token; de app verstuurt het alleen naar de eigen backend. */
export function OpenLink() {
  const { token = "" } = useParams();
  const { api } = useAuth();
  const [result, setResult] = useState<{ callingId?: string } | "invalid" | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .openLink(token)
      .then((r) => !cancelled && setResult(r.valid && r.callingId ? { callingId: r.callingId } : "invalid"))
      .catch(() => !cancelled && setResult("invalid"));
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  if (result === null) return <Spinner />;
  if (result === "invalid") {
    return (
      <div className="glass card stack" role="alert">
        <strong>Deze link is niet meer geldig</strong>
        <span className="muted">Open het voorstel via het overzicht, of vraag een nieuwe herinnering aan.</span>
      </div>
    );
  }
  // De autorisatie van het voorstel zelf wordt daarna server-side gecontroleerd met de eigen sessie.
  return <Navigate to={`/roepingen/${result.callingId}`} replace />;
}
