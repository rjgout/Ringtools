import { resolveMfaActor, mayEnrollFirstFactorWhilePending } from "@/lib/mfaActor";
import { startPasskeyRegistration } from "@/lib/webauthn";
import { isRecentlyMfaVerified } from "@/lib/auth";

export async function POST() {
  const actor = await resolveMfaActor();
  if (!actor) return Response.json({ error: "Niet ingelogd." }, { status: 401 });

  // Al volledig ingelogd: een nieuwe passkey toevoegen is een gevoelige
  // actie en vereist een recente MFA-verificatie, ook via deze API-route.
  // Wachtende sessie: alleen een eerste inschrijving, nooit een tweede factor "erbij".
  if (!(await mayEnrollFirstFactorWhilePending(actor))) {
    return Response.json({ error: "Deze actie is nu niet toegestaan. Log in met je bestaande tweede factor." }, { status: 403 });
  }

  if (actor.mode === "full" && actor.mfaRequired && !isRecentlyMfaVerified(actor.mfaAt)) {
    return Response.json({ error: "Herverifieer eerst om deze actie uit te voeren." }, { status: 403 });
  }

  const options = await startPasskeyRegistration(actor.userId, actor.email, actor.name);
  return Response.json(options);
}
