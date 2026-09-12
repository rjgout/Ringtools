const express = require('express');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const { listUsers, createUser, deleteUser } = require('../models');

const router = express.Router();

router.use(requireLogin, requireAdmin);

router.get('/users', ensureCsrfToken, (req, res) => {
  res.render('admin-users', { title: 'Gebruikersbeheer', users: listUsers(), error: null });
});

router.post('/users', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) {
    return res.status(400).render('admin-users', {
      title: 'Gebruikersbeheer',
      users: listUsers(),
      error: 'Gebruikersnaam en wachtwoord zijn verplicht.',
    });
  }
  try {
    createUser({ username: username.trim(), password, email: (email || '').trim() });
    res.redirect('/admin/users');
  } catch (err) {
    res.status(400).render('admin-users', { title: 'Gebruikersbeheer', users: listUsers(), error: err.message });
  }
});

router.post('/users/:id/delete', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  try {
    deleteUser(req.params.id);
  } catch (err) {
    // negeren van poging tot verwijderen van admin-account, gewoon terug naar overzicht
  }
  res.redirect('/admin/users');
});

module.exports = router;
