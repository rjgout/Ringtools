import { isNative, shareText } from "./native";
import { GENERAL_REMINDER } from "./progress";

/** Deelt de algemene herinnering (zonder persoonsgegevens): native deelmenu in de app, het deelmenu van de browser of WhatsApp Web op de web. */
export async function shareGeneralReminder(): Promise<void> {
  if (isNative) return shareText("Ringtools", GENERAL_REMINDER);
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: GENERAL_REMINDER });
      return;
    } catch {
      /* geannuleerd of niet ondersteund: terugval hieronder */
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(GENERAL_REMINDER)}`, "_blank", "noopener,noreferrer");
}
