import { isRecipientAllowed } from "./devGuard";
import { functionalActionEmail } from "./notificationText";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super("SMTP is nog niet geconfigureerd in Instellingen > E-mail.");
  }
}

/**
 * Expliciete SMTP-time-outs (nodemailer-standaarden zijn te ruim: 2 min verbinden, 10 min inactiviteit). Samen met de harde
 * totaaltijd hieronder blijft een verzending altijd ruim korter dan de claimlease van uitnodigingen (`INVITATION_SEND_LEASE_MS`, 2 min).
 */
export const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, dnsTimeout: 10_000 } as const;
export const SMTP_SEND_DEADLINE_DEFAULT_MS = 45_000;
/** Bovengrens, ook voor de (test)instelling SMTP_SEND_DEADLINE_MS: nooit in de buurt van de claimlease. */
export const SMTP_SEND_DEADLINE_MAX_MS = 60_000;

export function smtpSendDeadlineMs(): number {
  const raw = Number(process.env.SMTP_SEND_DEADLINE_MS);
  return Number.isFinite(raw) && raw >= 100 ? Math.min(raw, SMTP_SEND_DEADLINE_MAX_MS) : SMTP_SEND_DEADLINE_DEFAULT_MS;
}

/** De verzending duurde langer dan de harde totaaltijd. De afleverstatus is dan ONBEKEND: de server kan de mail alsnog hebben aangenomen. */
export class SmtpDeadlineError extends Error {
  constructor() {
    super("SMTP-verzending overschreed de maximale tijd");
    this.name = "SmtpDeadlineError";
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
    ...SMTP_TIMEOUTS,
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
  const destinations = Array.isArray(to) ? to : [to];
  // Gereserveerde fictieve adressen zijn nooit externe afleverbestemmingen.
  if (destinations.some(address => /@[^>\s,]*\.invalid(?:[>\s,]|$)/i.test(address))) return;
  // Development-omgeving: alleen naar expliciet toegestane testers (DEV_MAIL_ALLOWLIST); anders niet versturen (zonder het adres te loggen).
  if (!destinations.every((address) => isRecipientAllowed(address.replace(/^.*<([^>]+)>\s*$/, "$1")))) {
    console.warn("[devGuard] E-mail niet verstuurd: ontvanger staat niet op DEV_MAIL_ALLOWLIST.");
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmtpDeadlineError()), smtpSendDeadlineMs());
  });
  const send = (async () => {
    const { transport, fromAddress, fromName } = await getTransport();
    await transport.sendMail({
      from: `${fromName} <${fromAddress}>`,
      to: Array.isArray(to) ? to.join(",") : to,
      subject,
      text,
    });
  })();
  send.catch(() => {}); // een na de deadline alsnog mislukkende verzending veroorzaakt geen onverwerkte rejection
  try {
    // Harde bovengrens op de totale duur (DNS, verbinden, inloggen, versturen). Na de deadline kan de onderliggende verbinding
    // nog even doorlopen tot de nodemailer-time-outs hierboven; de aanroeper behandelt dit als mislukt met onbekende afleverstatus.
    await Promise.race([send, deadline]);
  } finally {
    clearTimeout(timer);
  }
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

export function loginCodeEmail(name: string, code: string) {
  return { subject: "Ringtools – je inlogcode", text: [
    `Hallo ${name.trim().split(/\s+/)[0]},`, "", `Je eenmalige inlogcode voor Ringtools is: ${code}`, "",
    "Open Ringtools en voer deze acht cijfers in. De code is 15 minuten geldig en kan één keer worden gebruikt.",
    "Heb je deze code niet aangevraagd? Dan kun je deze e-mail negeren.",
  ].join("\n") };
}

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
  void opts; // Broncompatibiliteit; vertrouwelijke velden worden nooit opgenomen.
  return functionalActionEmail();
}

export function taskAssignedEmail(opts: { name: string; taskLabel: string; personName: string; functionTitle: string; link: string }) {
  void opts; // Broncompatibiliteit; vertrouwelijke velden worden nooit opgenomen.
  return functionalActionEmail();
}

export function reminder30Email(opts: { name: string; personName: string; functionTitle: string; phaseLabel: string; link: string }) {
  void opts; // Broncompatibiliteit; vertrouwelijke velden worden nooit opgenomen.
  return functionalActionEmail();
}

export function supportReminderEmail(opts: { name: string; personName: string; functionTitle: string; link: string }) {
  void opts; // Broncompatibiliteit; vertrouwelijke velden worden nooit opgenomen.
  return functionalActionEmail();
}

/** Uitnodiging voor een nieuwe of bestaande gebruiker. Bewust zonder rol- of functiegegevens en zonder namen van anderen. */
export function invitationEmail(opts: { name: string; ringName: string; link: string; code: string; expiresAt: Date }) {
  const links = [
    ["iPhone/iPad", process.env.IOS_INSTALL_URL], ["Android", process.env.ANDROID_INSTALL_URL],
  ].flatMap(([label, value]) => {
    if (!value) return [];
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? [`${label}: ${url.href}`] : []; } catch { return []; }
  });
  return {
    subject: "Welkom bij Ringtools",
    text: [
      `Hallo ${opts.name.trim().split(/\s+/)[0]},`, "",
      `Je bent uitgenodigd om Ringtools te gebruiken voor ${opts.ringName}.`, "",
      "Met Ringtools kun je op een veilige en eenvoudige manier betrokken zijn bij het behandelen van roepingen en ontheffingen.", "",
      "Om te beginnen:",
      links.length ? "1. Download de Ringtools-app via de onderstaande link voor jouw telefoon." : "1. Vraag je ringbeheerder om de installatie-instructies voor jouw telefoon.",
      ...links,
      "2. Open de app en vul het e-mailadres in waarop je deze mail ontvangt.",
      "3. Je ontvangt een eenmalige inlogcode waarmee je kunt aanmelden.", "",
      "Daarna kun je direct aan de slag. Je hoeft geen wachtwoord aan te maken.",
      "Heb je al extra verificatie ingesteld? Die blijft nodig bij het aanmelden.", "",
      "Hartelijke groet,", "Ringtools",
    ].join("\n"),
  };
}

export function mfaResetEmail(name: string) {
  return {
    subject: "Ringtools – je verificatie is gereset",
    text: [
      `Beste ${name},`,
      "",
      "De systeembeheerder van Ringtools heeft je tweede verificatiemethode (passkey of authenticator-app) gereset en je actieve sessies beëindigd.",
      "Bij je volgende keer inloggen stel je opnieuw een methode in.",
      "",
      "Heb je hier niet om gevraagd of verwacht je dit niet? Neem dan direct contact op met je ringbeheerder.",
    ].join("\n"),
  };
}
