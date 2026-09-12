const express = require('express');
const { findCallingByToken, recordVote } = require('../models');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');

const router = express.Router();

router.get('/vote/:token', ensureCsrfToken, (req, res) => {
  const calling = findCallingByToken(req.params.token);
  if (!calling) {
    return res.status(404).render('vote-invalid', { title: 'Link ongeldig' });
  }
  const pendingMembers = calling.expectedMembers.filter(
    (m) => !calling.votes.some((v) => v.memberId === m.id)
  );
  res.render('vote', { title: 'Roeping', calling, pendingMembers, error: null });
});

router.post('/vote/:token', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const calling = findCallingByToken(req.params.token);
  if (!calling) {
    return res.status(404).render('vote-invalid', { title: 'Link ongeldig' });
  }
  const { memberId, support } = req.body;
  const member = calling.expectedMembers.find((m) => m.id === memberId);
  if (!member) {
    const pendingMembers = calling.expectedMembers.filter(
      (m) => !calling.votes.some((v) => v.memberId === m.id)
    );
    return res.status(400).render('vote', {
      title: 'Roeping',
      calling,
      pendingMembers,
      error: 'Kies je naam uit de lijst.',
    });
  }
  try {
    recordVote(calling.id, { memberId, support: support === 'true', byBackend: false });
  } catch (err) {
    const refreshed = findCallingByToken(req.params.token);
    const pendingMembers = refreshed.expectedMembers.filter(
      (m) => !refreshed.votes.some((v) => v.memberId === m.id)
    );
    return res.status(400).render('vote', {
      title: 'Roeping',
      calling: refreshed,
      pendingMembers,
      error: err.message,
    });
  }
  res.render('vote-thanks', { title: 'Bedankt', name: member.name, support: support === 'true' });
});

module.exports = router;
