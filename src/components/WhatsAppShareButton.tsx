"use client";

import { useState } from "react";

// Bevat bewust GEEN naam, functie of persoonlijke stemlink: dit bericht is
// bedoeld om handmatig in een bestaande WhatsApp-groep te plakken, waar het
// voor iedereen zichtbaar is.
const MESSAGE = [
  "📢 Ringtools – Nieuwe stemming",
  "",
  "Er is een nieuw voorstel waarvoor jullie steun wordt gevraagd.",
  "Je ontvangt hierover een persoonlijke e-mail van: noreply@ringapeldoorn.nl",
  "Open de link in je e-mail om je stem uit te brengen.",
  "",
  "📩 Controleer je mailbox!",
].join("\n");

export function WhatsAppShareButton() {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: MESSAGE });
        return;
      } catch {
        // gebruiker annuleerde of delen niet ondersteund; val terug op WhatsApp-link
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(MESSAGE)}`, "_blank", "noopener");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(MESSAGE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard niet beschikbaar; niets te doen
    }
  }

  return (
    <div className="flex gap-2">
      <button type="button" onClick={share} className="btn-ghost flex-1">
        📲 Delen via WhatsApp
      </button>
      <button type="button" onClick={copy} className="btn-ghost !flex-none !px-4">
        {copied ? "Gekopieerd!" : "Kopieer tekst"}
      </button>
    </div>
  );
}
