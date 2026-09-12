const crypto = require('crypto');

// Lichtgewicht CSRF-bescherming zonder extra dependency: een token per sessie,
// verplicht meegestuurd in elk formulier dat iets wijzigt.

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function verifyCsrfToken(req, res, next) {
  const sent = req.body && req.body._csrf;
  if (!sent || sent !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title: 'Ongeldig verzoek',
      message: 'Je sessie is verlopen of het formulier was verouderd. Ga terug en probeer het opnieuw.',
    });
  }
  next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken };
