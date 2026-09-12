const nodemailer = require('nodemailer');

function isConfigured() {
  return !!process.env.SMTP_HOST;
}

function getTransport() {
  if (!isConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail({ to, subject, text }) {
  const transport = getTransport();
  if (!transport) {
    throw new Error('SMTP is niet geconfigureerd (SMTP_HOST ontbreekt).');
  }
  const from = process.env.MAIL_FROM || 'Ringpresidium <noreply@example.org>';
  await transport.sendMail({ from, to, subject, text });
}

module.exports = { isConfigured, sendMail };
