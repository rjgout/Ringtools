import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in.");

export const createCallingSchema = z.object({
  personName: z.string().trim().min(2, "Vul de naam van de persoon in.").max(200),
  functionTitle: z.string().trim().min(2, "Vul de roeping/functie in.").max(200),
  roepenAssigneeId: z.string().optional().nullable(),
  ondersteunenAssigneeId: z.string().optional().nullable(),
  aanstellenAssigneeId: z.string().optional().nullable(),
});

const membershipRoleSchema = z.enum(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"], {
  message: "Kies een rol binnen Ringtools.",
});
const churchFunctionSchema = z.string().trim().min(2, "Vul de kerkelijke functie in.").max(200);

export const ringNameSchema = z.string().trim().min(2, "Vul de naam van de ring in.").max(120);

export const addMemberSchema = z.object({
  ringId: z.string().min(1),
  existingUserId: z.string().optional(),
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().optional(),
  churchFunction: churchFunctionSchema,
  role: membershipRoleSchema,
  isRingManager: z.boolean(),
});

export const updateMemberSchema = z.object({
  membershipId: z.string().min(1),
  name: z.string().trim().min(2).max(200).optional(),
  email: emailSchema.optional(),
  churchFunction: churchFunctionSchema,
  role: membershipRoleSchema,
  isRingManager: z.boolean(),
  active: z.boolean(),
});

export const createRingSchema = z.object({
  name: ringNameSchema,
  existingUserId: z.string().optional(),
  userName: z.string().trim().max(200).optional(),
  userEmail: z.string().trim().optional(),
  churchFunction: churchFunctionSchema,
  role: membershipRoleSchema,
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
