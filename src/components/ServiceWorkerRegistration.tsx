"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registratie mislukt:", err);
    });

    // Zodra een nieuwe service worker de controle overneemt (een update is
    // geactiveerd), de pagina eenmalig verversen zodat de gebruiker direct
    // de nieuwste versie gebruikt in plaats van halverwege een sessie op
    // oude bestanden te blijven zitten.
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
