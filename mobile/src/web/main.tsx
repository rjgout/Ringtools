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
