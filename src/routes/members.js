const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const { listMembers, addMember, deleteMember } = require('../models');

const router = express.Router();

router.use(requireLogin);

router.get('/members', ensureCsrfToken, (req, res) => {
  res.render('members', { title: 'Hogeraadsleden', members: listMembers(), error: null });
});

router.post('/members', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).render('members', { title: 'Hogeraadsleden', members: listMembers(), error: 'Vul een naam in.' });
  }
  addMember(name);
  res.redirect('/members');
});

router.post('/members/:id/delete', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  deleteMember(req.params.id);
  res.redirect('/members');
});

module.exports = router;
