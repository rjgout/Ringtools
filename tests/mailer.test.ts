import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing } from "./setup";
import { SMTP_TIMEOUTS, SMTP_SEND_DEADLINE_DEFAULT_MS, SMTP_SEND_DEADLINE_MAX_MS, SmtpDeadlineError, sendMail, smtpSendDeadlineMs } from "@/lib/mailer";
import { INVITATION_SEND_LEASE_MS, INVITATION_RESEND_COOLDOWN_MS, createInvitation, resendInvitation } from "@/lib/invitations";

// Echte mailer (niet gemockt) tegen een SMTP-server die verbindt maar nooit antwoordt: zo wordt de harde totaaltijd werkelijk gemeten.
let server: net.Server;
let port: number;
const sockets = new Set<net.Socket>();
const saved = process.env.SMTP_SEND_DEADLINE_MS;

beforeEach(async () => {
  await resetDatabase();
  server = net.createServer((s) => {
    sockets.add(s); // geen greeting, nooit een antwoord
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as net.AddressInfo).port;
  await prisma.smtpSettings.create({ data: { id: 1, host: "127.0.0.1", port, security: "NONE", username: "", fromAddress: "ringtools@test.nl", fromName: "Ringtools" } });
});
afterEach(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
  if (saved === undefined) delete process.env.SMTP_SEND_DEADLINE_MS;
  else process.env.SMTP_SEND_DEADLINE_MS = saved;
  vi.restoreAllMocks();
});

describe("SMTP-time-outs", () => {
  it("de totaaltijd en alle time-outs liggen aantoonbaar ruim onder de claimlease van uitnodigingen", () => {
    expect(SMTP_SEND_DEADLINE_MAX_MS + 30_000).toBeLessThanOrEqual(INVITATION_SEND_LEASE_MS); // minstens 30 s marge, ook bij de maximale instelling
    expect(SMTP_SEND_DEADLINE_DEFAULT_MS).toBeLessThan(SMTP_SEND_DEADLINE_MAX_MS);
    expect(SMTP_TIMEOUTS.connectionTimeout + SMTP_TIMEOUTS.greetingTimeout).toBeLessThan(INVITATION_SEND_LEASE_MS);
    expect(Object.values(SMTP_TIMEOUTS).every((t) => t > 0 && t < INVITATION_SEND_LEASE_MS)).toBe(true);
    // De wachttijd na een verzending is langer dan de lease-marge: een nieuw verzoek kan nooit in de verzendperiode vallen.
    expect(INVITATION_RESEND_COOLDOWN_MS).toBeGreaterThan(SMTP_SEND_DEADLINE_MAX_MS);
  });

  it("de instelling SMTP_SEND_DEADLINE_MS wordt begrensd en onzin valt terug op de standaard", () => {
    for (const [raw, expected] of [[undefined, SMTP_SEND_DEADLINE_DEFAULT_MS], ["abc", SMTP_SEND_DEADLINE_DEFAULT_MS], ["5", SMTP_SEND_DEADLINE_DEFAULT_MS], ["-1", SMTP_SEND_DEADLINE_DEFAULT_MS], ["999999999", SMTP_SEND_DEADLINE_MAX_MS], ["500", 500]] as const) {
      if (raw === undefined) delete process.env.SMTP_SEND_DEADLINE_MS;
      else process.env.SMTP_SEND_DEADLINE_MS = raw;
      expect(smtpSendDeadlineMs()).toBe(expected);
    }
  });

  it("een SMTP-server die nooit antwoordt: sendMail faalt binnen de harde totaaltijd met SmtpDeadlineError en de transport krijgt de expliciete time-outs", async () => {
    process.env.SMTP_SEND_DEADLINE_MS = "300";
    const create = vi.spyOn(nodemailer, "createTransport");
    const t0 = Date.now();
    await expect(sendMail({ to: "x@test.nl", subject: "s", text: "t" })).rejects.toBeInstanceOf(SmtpDeadlineError);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(create).toHaveBeenCalledWith(expect.objectContaining(SMTP_TIMEOUTS));
  });
});

describe("Uitnodiging versturen bij een hangende SMTP-server (echte mailer)", () => {
  async function ringWithManager() {
    const ring = await createTestRing("Ring T");
    const manager = await createTestUser("RINGPRESIDIUM", "Beheerder T", { ringId: ring.id, isRingManager: true });
    return { ring, manager };
  }

  it("de verzending eindigt binnen de totaaltijd als mislukt (time-out, afleverstatus onbekend), de claim is vrij en de nieuwe link blijft bruikbaar bij een eerste verzending", async () => {
    process.env.SMTP_SEND_DEADLINE_MS = "300";
    const { ring, manager } = await ringWithManager();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t0 = Date.now();
    const created = await createInvitation({ actorId: manager.id, ringId: ring.id, name: "Eva Nieuw", email: "eva@test.nl", role: "RINGSECRETARIS", churchFunctionCode: "RINGSECRETARIS" });
    expect(Date.now() - t0).toBeLessThan(2500);
    errSpy.mockRestore();
    expect(created.sent).toBe(false);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    expect(row.sentAt).toBeNull();
    expect(row.sendClaimedAt).toBeNull(); // vrijgegeven: een nieuwe poging mag direct
    const audit = await prisma.ringInvitationAudit.findFirstOrThrow({ where: { action: "SEND_FAILED" } });
    expect(audit.detail).toBe("time-out; afleverstatus onbekend");
  });

  it("opnieuw versturen met time-out: de eerder bezorgde link wordt hersteld en blijft de enige gegarandeerd geldige", async () => {
    process.env.SMTP_SEND_DEADLINE_MS = "300";
    const { ring, manager } = await ringWithManager();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await createInvitation({ actorId: manager.id, ringId: ring.id, name: "Eva Nieuw", email: "eva@test.nl", role: "RINGSECRETARIS" });
    const row = await prisma.ringInvitation.findFirstOrThrow();
    // Doe alsof de eerste mail wél is bezorgd.
    await prisma.ringInvitation.update({ where: { id: row.id }, data: { sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000), sendCount: 1 } });
    const before = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    const res = await resendInvitation({ actorId: manager.id, invitationId: row.id });
    errSpy.mockRestore();
    expect(res).toMatchObject({ sent: false, inProgress: false });
    const after = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.tokenHash).toBe(before.tokenHash);
    expect(after.codeHash).toBe(before.codeHash);
    expect(after.sentAt?.getTime()).toBe(before.sentAt?.getTime());
    expect(after.sendClaimedAt).toBeNull();
  });
});
