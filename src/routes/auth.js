const express = require('express');
const rateLimit = require('express-rate-limit');
const { findUserByUsername, verifyPassword } = require('../models');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Te veel inlogpogingen. Probeer het over een paar minuten opnieuw.',
});

router.get('/login', ensureCsrfToken, (req, res) => {
  if (res.locals.currentUser) return res.redirect('/dashboard');
  res.render('login', { title: 'Inloggen', error: null });
});

router.post('/login', loginLimiter, ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const { username, password } = req.body;
  const user = username ? findUserByUsername(username) : null;
  if (!user || !verifyPassword(user, password || '')) {
    return res.status(401).render('login', { title: 'Inloggen', error: 'Onjuiste gebruikersnaam of wachtwoord.' });
  }
  req.session.userId = user.id;
  res.redirect(user.isAdmin ? '/admin/users' : '/dashboard');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
