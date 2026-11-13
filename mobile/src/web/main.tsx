import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../styles.css";
import { Shell } from "../App";
import { ConfirmProvider } from "../components/Dialog";
import { WebAuthProvider } from "./WebAuthProvider";
import { consumeTargetParam } from "./webPaths";

// Webomgeving (web/PWA): dezelfde schermen als de app, zonder appvergrendeling, biometrie, toestelsleutels of native plug-ins.
// De sessie is de HttpOnly-cookie van de website; zie WebAuthProvider.
consumeTargetParam();
document.documentElement.dataset.platform = "web";

// Bestaande serviceworker van de website (alleen statische bestanden en de offlinepagina; nooit API-antwoorden of paginagegevens).
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});

// Terug-knop na uitloggen: een uit de bfcache teruggezette pagina wordt opnieuw geladen, zodat er nooit oude gegevens zichtbaar zijn (het verzoek krijgt dan 401).
window.addEventListener("pageshow", (e) => { if (e.persisted) window.location.reload(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <WebAuthProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </WebAuthProvider>
    </HashRouter>
  </StrictMode>
);
