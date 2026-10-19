import { resolveMfaActor } from "@/lib/mfaActor";
import { startPasskeyAuthentication } from "@/lib/webauthn";

export async function POST() {
  const actor = await resolveMfaActor();
  if (!actor) return Response.json({ error: "Niet ingelogd." }, { status: 401 });

  const options = await startPasskeyAuthentication(actor.userId);
  if (!options) return Response.json({ error: "Er zijn nog geen passkeys geregistreerd." }, { status: 400 });

  return Response.json(options);
}
