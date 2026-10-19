"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Alleen een al eerder door een service worker gecontroleerde pagina
    // moet verversen bij een "controllerchange" (dat betekent dan een
    // nieuwe versie die de oude vervangt). Bij de allereerste installatie
    // (nog geen controller) is er niets verouderds om te verversen — zou
    // dit toch gebeuren, dan kan de reload een net ingediende actie (zoals
    // het eenmalig bevestigen van een magic link) onderbreken.
    const hadControllerBeforeRegistration = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registratie mislukt:", err);
    });

    // Zodra een nieuwe service worker de controle overneemt (een update is
    // geactiveerd), de pagina eenmalig verversen zodat de gebruiker direct
    // de nieuwste versie gebruikt in plaats van halverwege een sessie op
    // oude bestanden te blijven zitten.
    let reloaded = false;
    const onControllerChange = () => {
      if (!hadControllerBeforeRegistration) return;
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
