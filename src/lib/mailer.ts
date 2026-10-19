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

export function magicLinkEmail(name: string, link: string) {
  return {
    subject: "Ringtools – je inloglink",
    text: [
      `Beste ${name},`,
      "",
      "Je hebt een inloglink voor Ringtools aangevraagd. Klik op de onderstaande link om in te loggen:",
      "",
      link,
      "",
      "Deze link is 15 minuten geldig en kan maar één keer gebruikt worden.",
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
      "Deze link is persoonlijk en 15 minuten geldig nadat je hem opent; je kunt altijd een nieuwe aanvragen via de inlogpagina.",
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
      "Open Ringtools om de details te bekijken:",
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
      "Bekijk de roeping in Ringtools:",
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
      "Deze link is persoonlijk en 15 minuten geldig nadat je hem opent; je kunt altijd een nieuwe aanvragen via de inlogpagina.",
    ].join("\n"),
  };
}
