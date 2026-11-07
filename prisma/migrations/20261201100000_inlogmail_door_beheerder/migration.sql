-- Additief: auditgebeurtenis wanneer een ringbeheerder een gewone inlogmail laat (her)versturen voor een bestaand account.
ALTER TYPE "SecurityEventType" ADD VALUE 'LOGIN_MAIL_RESENT_BY_MANAGER';
