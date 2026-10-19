import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in.");

export const createCallingSchema = z.object({
  personName: z.string().trim().min(2, "Vul de naam van de persoon in.").max(200),
  functionTitle: z.string().trim().min(2, "Vul de roeping/functie in.").max(200),
  roepenAssigneeId: z.string().optional().nullable(),
  ondersteunenAssigneeId: z.string().optional().nullable(),
  aanstellenAssigneeId: z.string().optional().nullable(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Vul een naam in.").max(200),
  email: emailSchema,
  role: z.enum(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"]),
});

export const updateUserSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(2).max(200),
  email: emailSchema,
  role: z.enum(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"]),
  active: z.boolean(),
});

export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1, "Vul de SMTP-server in.").max(255),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(["NONE", "TLS", "STARTTLS"]),
  username: z.string().trim().max(255).optional().or(z.literal("")),
  password: z.string().max(500).optional().or(z.literal("")),
  fromAddress: z.string().trim().email("Vul een geldig afzenderadres in."),
  fromName: z.string().trim().min(1).max(200),
});

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Vul de 6-cijferige code uit je authenticator-app in.");

export const recoveryCodeSchema = z
  .string()
  .trim()
  .min(8, "Vul een geldige herstelcode in.")
  .max(24, "Vul een geldige herstelcode in.");

export const adminPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Vul je huidige wachtwoord in."),
    newPassword: z.string().min(10, "Het nieuwe wachtwoord moet minimaal 10 tekens lang zijn."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "De wachtwoorden komen niet overeen.",
    path: ["confirmPassword"],
  });
