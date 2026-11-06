import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Segmented } from "../components/ui";
import { UserManager } from "./UserManager";
import { RingSetup } from "./RingSetup";

type Section = "gebruikers" | "inrichting";

/** Ringbeheer: gebruikers en inrichting als twee segmenten van één hoofdgebied (de server blijft over de bevoegdheid beslissen). */
export function Beheer() {
  const { ring } = useAuth();
  const navigate = useNavigate();
  const { section } = useParams();
  const current: Section = section === "inrichting" ? "inrichting" : "gebruikers";
  if (!ring) return null;
  return (
    <div className="stack">
      <h1>{ring.name}</h1>
      <Segmented<Section>
        label="Beheer"
        value={current}
        onChange={(v) => navigate(`/beheer/${v}`, { replace: true })}
        options={[{ value: "gebruikers", label: "Gebruikers" }, { value: "inrichting", label: "Inrichting" }]}
      />
      {current === "gebruikers" ? <UserManager ringId={ring.id} /> : <RingSetup ringId={ring.id} />}
    </div>
  );
}
