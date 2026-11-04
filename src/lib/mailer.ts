import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super("SMTP is nog niet geconfigureerd in Instellingen > E-mail.");
  }
}

async function getTransport() {
  const settings = await prisma.smtpSettings.findUnique({ where: { id: 1 } });
  if (!settings || !settings.host) {
    throw new SmtpNotConfiguredError();
  }

  const security = settings.security as "NONE" | "TLS" | "STARTTLS";
  const secure = security === "TLS";
  const requireTLS = security === "STARTTLS";

  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure,
    requireTLS,
    auth: settings.username
      ? { user: settings.username, pass: settings.encryptedPassword ? decryptSecret(settings.encryptedPassword) : "" }
      : undefined,
  });

  return { transport, fromAddress: settings.fromAddress, fromName: settings.fromName };
}

export async function sendMail({ to, subject, text }: { to: string | string[]; subject: string; text: string }) {
  const { transport, fromAddress, fromName } = await getTransport();
  await transport.sendMail({
    from: `${fromName} <${fromAddress}>`,
    to: Array.isArray(to) ? to.join(",") : to,
    subject,
    text,
  });
}

export async function sendTestMail(to: string) {
  await sendMail({
    to,
    subject: "Ringtools – testbericht",
    text: [
      "Dit is een testbericht vanuit Ringtools.",
      "",
      "Als je dit bericht ontvangt, zijn de SMTP-instellingen correct geconfigureerd.",
    ].join("\n"),
  });
}

// ---- E-mailsjablonen (Nederlands) ----

export function magicLinkEmail(name: string, link: string, code?: string) {
  return {
    subject: "Ringtools – je inloglink",
    text: [
      `Beste ${name},`,
      "",
      "Je hebt een inloglink voor Ringtools aangevraagd. Klik op de onderstaande link om in te loggen:",
      "",
      link,
      "",
      ...(code
        ? [
            "Gebruik je de Ringtools-app op je beginscherm? Een link opent op een iPhone of iPad in de browser, niet in de app.",
            `Voer in dat geval op het inlogscherm van de app deze code in: ${code}`,
            "",
          ]
        : []),
      "De link en de code zijn 15 minuten geldig vanaf het moment dat deze e-mail is verstuurd (niet vanaf het openen) en kunnen samen maar één keer gebruikt worden.",
      "Heb je geen inlogverzoek gedaan? Dan kun je deze e-mail negeren.",
    ].join("\n"),
  };
}

export function supportInviteEmail(opts: {
  name: string;
  personName: string;
  functionTitle: string;
  link: string;
  isReinvite?: boolean;
}) {
  const intro = opts.isReinvite
    ? "Je wordt opnieuw gevraagd om je ondersteuning voor het volgende voorstel kenbaar te maken:"
    : "Er is een nieuw voorstel waarvoor jouw steun wordt gevraagd:";
  return {
    subject: opts.isReinvite
      ? "Ringtools – opnieuw ondersteuning gevraagd"
      : "Ringtools – ondersteuning gevraagd voor een nieuw voorstel",
    text: [
      `Beste ${opts.name},`,
      "",
      intro,
      "",
      `Naam: ${opts.personName}`,
      `Roeping: ${opts.functionTitle}`,
      "",
      "Open de onderstaande persoonlijke link om je ondersteuning uit te brengen:",
      opts.link,
      "",
      "Deze link is persoonlijk en 72 uur geldig. Hij logt je niet automatisch in: je kiest op de pagina hoe je verdergaat (inloggen in de browser, of een melding naar je Ringtools-app laten sturen).",
    ].join("\n"),
  };
}

export function taskAssignedEmail(opts: { name: string; taskLabel: string; personName: string; functionTitle: string; link: string }) {
  return {
    subject: `Ringtools – taak toegewezen: ${opts.taskLabel}`,
    text: [
      `Beste ${opts.name},`,
      "",
      `Aan jou is de volgende taak toegewezen: ${opts.taskLabel}.`,
      `Het betreft de roeping van: ${opts.personName} (${opts.functionTitle}).`,
      "",
      "Open Ringtools om de details te bekijken (persoonlijke link, 72 uur geldig):",
      opts.link,
    ].join("\n"),
  };
}

export function reminder30Email(opts: { name: string; personName: string; functionTitle: string; phaseLabel: string; link: string }) {
  return {
    subject: "Ringtools – herinnering: roeping nog niet verwerkt",
    text: [
      `Beste ${opts.name},`,
      "",
      `De roeping van ${opts.personName} (${opts.functionTitle}) staat al 30 dagen open en is nog niet verwerkt.`,
      `Huidige fase: ${opts.phaseLabel}.`,
      "",
      "Bekijk de roeping in Ringtools (persoonlijke link, 72 uur geldig):",
      opts.link,
    ].join("\n"),
  };
}

export function supportReminderEmail(opts: { name: string; personName: string; functionTitle: string; link: string }) {
  return {
    subject: "Ringtools – herinnering: ondersteuning gevraagd",
    text: [
      `Beste ${opts.name},`,
      "",
      "Dit is een herinnering: er staat nog een ondersteuningsverzoek voor je open voor het volgende voorstel:",
      "",
      `Naam: ${opts.personName}`,
      `Roeping: ${opts.functionTitle}`,
      "",
      "Open de onderstaande persoonlijke link om je ondersteuning uit te brengen:",
      opts.link,
      "",
      "Deze link is persoonlijk en 72 uur geldig. Hij logt je niet automatisch in: je kiest op de pagina hoe je verdergaat (inloggen in de browser, of een melding naar je Ringtools-app laten sturen).",
    ].join("\n"),
  };
}

/** Uitnodiging voor een nieuwe of bestaande gebruiker. Bewust zonder rol- of functiegegevens en zonder namen van anderen. */
export function invitationEmail(opts: { name: string; ringName: string; link: string; code: string; expiresAt: Date }) {
  const days = Math.max(1, Math.round((opts.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return {
    subject: "Ringtools – je bent uitgenodigd",
    text: [
      `Beste ${opts.name},`,
      "",
      `Je bent uitgenodigd om Ringtools te gebruiken voor ${opts.ringName}.`,
      "",
      "Zo activeer je je account:",
      "1. Installeer de Ringtools-app op je telefoon (of open hem als hij al is geïnstalleerd).",
      "2. Tik op de onderstaande link. De app opent en je account wordt geactiveerd.",
      "",
      opts.link,
      "",
      "Opent de app niet? Kies dan in de app op het inlogscherm 'Ik heb een uitnodiging' en vul dit e-mailadres en deze activeringscode in:",
      opts.code,
      "",
      "Daarna log je in met je e-mailadres: je ontvangt dan een code van 8 cijfers.",
      "",
      `De uitnodiging is ${days} dagen geldig en kan maar één keer worden gebruikt.`,
      "Heb je deze uitnodiging niet verwacht? Dan kun je deze e-mail negeren; er gebeurt niets zonder jouw activatie.",
    ].join("\n"),
  };
}
