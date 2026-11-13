import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing } from "./setup";
import { isRecipientAllowed, isDevelopmentEnvironment } from "@/lib/devGuard";
import { sendMail } from "@/lib/mailer";
import { sendPushToUser } from "@/lib/push";
import { handleApi } from "@/lib/api/router";

const saved = { env: process.env.APP_ENVIRONMENT, list: process.env.DEV_MAIL_ALLOWLIST };
afterEach(() => {
  for (const [k, v] of [["APP_ENVIRONMENT", saved.env], ["DEV_MAIL_ALLOWLIST", saved.list]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("Development-omgeving: toegestane ontvangers", () => {
  it("in productie (standaard) verandert er niets", () => {
    delete process.env.APP_ENVIRONMENT;
    delete process.env.DEV_MAIL_ALLOWLIST;
    expect(isDevelopmentEnvironment()).toBe(false);
    expect(isRecipientAllowed("iemand@example.nl")).toBe(true);
  });

  it("in development is zonder lijst niemand toegestaan (fail-closed)", () => {
    process.env.APP_ENVIRONMENT = "development";
    delete process.env.DEV_MAIL_ALLOWLIST;
    expect(isRecipientAllowed("tester@example.nl")).toBe(false);
    expect(isRecipientAllowed("")).toBe(false);
    expect(isRecipientAllowed(null)).toBe(false);
  });

  it("alleen exacte adressen of expliciete domeinen op de lijst; hoofdletters en spaties maken niet uit", () => {
    process.env.APP_ENVIRONMENT = " Development ";
    process.env.DEV_MAIL_ALLOWLIST = " Tester@Example.nl , @testers.example.org\n;";
    expect(isRecipientAllowed("tester@example.nl")).toBe(true);
    expect(isRecipientAllowed("TESTER@example.nl")).toBe(true);
    expect(isRecipientAllowed("x@testers.example.org")).toBe(true);
    expect(isRecipientAllowed("andere@example.nl")).toBe(false);
    expect(isRecipientAllowed("tester@example.nl.evil.com")).toBe(false);
    expect(isRecipientAllowed("x@nottesters.example.org")).toBe(false);
    expect(isRecipientAllowed("evil@evil.com@testers.example.org".replace("@testers.example.org", ""))).toBe(false);
  });
});

describe("Development-omgeving: e-mail, push en meta", () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.smtpSettings.create({ data: { id: 1, host: "127.0.0.1", port: 1, security: "NONE", username: "", fromAddress: "ringtools@test.nl", fromName: "Ringtools" } });
  });

  it("een niet-toegestane ontvanger krijgt geen e-mail (geen verbinding met de SMTP-server); een toegestane wel", async () => {
    const sendMailMock = vi.fn().mockResolvedValue({});
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail: sendMailMock } as never);
    process.env.APP_ENVIRONMENT = "development";
    process.env.DEV_MAIL_ALLOWLIST = "tester@example.nl";
    await sendMail({ to: "echte.gebruiker@example.com", subject: "x", text: "y" });
    await sendMail({ to: ["tester@example.nl", "echte.gebruiker@example.com"], subject: "x", text: "y" });
    expect(sendMailMock).not.toHaveBeenCalled();
    await sendMail({ to: "Tester@example.nl", subject: "x", text: "y" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("zonder development-modus wordt gewoon verstuurd", async () => {
    const sendMailMock = vi.fn().mockResolvedValue({});
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail: sendMailMock } as never);
    delete process.env.APP_ENVIRONMENT;
    await sendMail({ to: "iemand@example.com", subject: "x", text: "y" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("push gaat in development alleen naar toegestane testers", async () => {
    const ring = await createTestRing("Dev-ring");
    const user = await createTestUser("HOGERAAD", "Niet Toegestaan", { ringId: ring.id, email: "niet.toegestaan@example.com" });
    const send = vi.spyOn(globalThis, "fetch");
    await prisma.devicePushToken.create({ data: { userId: user.id, token: "t".repeat(64), provider: "apns", platform: "ios", active: true } });
    process.env.APP_ENVIRONMENT = "development";
    process.env.DEV_MAIL_ALLOWLIST = "tester@example.nl";
    expect(await sendPushToUser(user.id, { title: "t", body: "b", url: "/app" } as never)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("/meta meldt alleen op development de omgeving", async () => {
    const call = async () => (await handleApi(new Request("http://localhost/api/mobile/v1/meta"), ["meta"])).json();
    delete process.env.APP_ENVIRONMENT;
    expect((await call()).environment).toBeUndefined();
    process.env.APP_ENVIRONMENT = "development";
    expect((await call()).environment).toBe("development");
  });
});
