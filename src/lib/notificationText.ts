/** Eén externe tekst voor alle functionele handelingen; geen namen, proceduretypes, besluiten of authenticatietokens. */
export const ACTION_PUSH = { title: "Ringtools", body: "Er staat een handeling voor je klaar." } as const;
export function functionalActionEmail() {
  return { subject: "Er staat een handeling klaar in Ringtools", text: "Er staat een handeling voor je klaar in Ringtools.\n\nOpen de Ringtools-app om deze te bekijken en af te handelen." };
}
