import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { isNative } from "./lib/native";
import { API_HOST } from "./config";
import { nativeCapabilities } from "./lib/buildProfile";
import { registerCapawesomePasskeys } from "./lib/capawesomePasskeys";
import { enablePrivacyScreen } from "./lib/privacyScreen";

// Native passkey-plug-in koppelen (alleen native en niet in de Personal Team-build). Dit schakelt niets in: de serverfunctievlag blijft leidend.
void registerCapawesomePasskeys({ isNative, passkeysCapable: nativeCapabilities().passkeys, rpId: API_HOST.split(":")[0] }).catch(() => {
  /* geen provider: de app toont dan de veilige melding bij verplichte MFA */
});

// Native schermbescherming (Android FLAG_SECURE, iOS afscherming voor de app-switcher). Valt de plug-in weg, dan blijft de JS-afscherming werken.
void enablePrivacyScreen();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
