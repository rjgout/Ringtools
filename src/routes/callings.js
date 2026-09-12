const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const {
  listCallings,
  findCallingById,
  createCalling,
  recordVote,
  deleteCalling,
  listMembers,
} = require('../models');

const router = express.Router();

router.use(requireLogin);

function baseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

router.get('/dashboard', ensureCsrfToken, (req, res) => {
  const all = listCallings();
  res.render('dashboard', {
    title: 'Dashboard',
    open: all.filter((c) => c.status === 'open'),
    teVerwerken: all.filter((c) => c.status === 'te_verwerken'),
  });
});

router.get('/callings/new', ensureCsrfToken, (req, res) => {
  const members = listMembers();
  res.render('calling-new', { title: 'Nieuwe roeping', error: null, members });
});

router.post('/callings', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const { name, functie } = req.body;
  if (!name || !name.trim() || !functie || !functie.trim()) {
    return res.status(400).render('calling-new', {
      title: 'Nieuwe roeping',
      error: 'Vul zowel de naam als de functie in.',
      members: listMembers(),
    });
  }
  if (listMembers().length === 0) {
    return res.status(400).render('calling-new', {
      title: 'Nieuwe roeping',
      error: 'Voeg eerst hogeraadsleden toe voordat je een roeping aanmaakt.',
      members: listMembers(),
    });
  }
  const calling = createCalling({ name, functie, createdBy: res.locals.currentUser.id });
  res.redirect(`/callings/${calling.id}`);
});

router.get('/callings/:id', ensureCsrfToken, (req, res) => {
  const calling = findCallingById(req.params.id);
  if (!calling) {
    return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze roeping bestaat niet (meer).' });
  }
  const pendingMembers = calling.expectedMembers.filter(
    (m) => !calling.votes.some((v) => v.memberId === m.id)
  );
  const link = `${baseUrl(req)}/vote/${calling.token}`;
  res.render('calling-detail', {
    title: calling.name,
    calling,
    pendingMembers,
    link,
    whatsappHref: `https://wa.me/?text=${encodeURIComponent(
      `Steun jij de roeping van ${calling.name} als ${calling.functie}? Geef hier je reactie: ${link}`
    )}`,
  });
});

router.post('/callings/:id/vote', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const calling = findCallingById(req.params.id);
  if (!calling) {
    return res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze roeping bestaat niet (meer).' });
  }
  const { memberId, support } = req.body;
  try {
    recordVote(calling.id, { memberId, support: support === 'true', byBackend: true });
  } catch (err) {
    // Val terug op de detailpagina met de fout zichtbaar via querystring-achtige aanpak is overkill hier;
    // eenvoudige aanpak: opnieuw renderen met foutmelding.
    const refreshed = findCallingById(calling.id);
    const pendingMembers = refreshed.expectedMembers.filter(
      (m) => !refreshed.votes.some((v) => v.memberId === m.id)
    );
    const link = `${baseUrl(req)}/vote/${refreshed.token}`;
    return res.status(400).render('calling-detail', {
      title: refreshed.name,
      calling: refreshed,
      pendingMembers,
      link,
      whatsappHref: `https://wa.me/?text=${encodeURIComponent(
        `Steun jij de roeping van ${refreshed.name} als ${refreshed.functie}? Geef hier je reactie: ${link}`
      )}`,
      error: err.message,
    });
  }
  res.redirect(`/callings/${calling.id}`);
});

router.post('/callings/:id/process', ensureCsrfToken, verifyCsrfToken, (req, res) => {
  const calling = findCallingById(req.params.id);
  if (calling && calling.status === 'te_verwerken') {
    deleteCalling(calling.id);
  }
  res.redirect('/dashboard');
});

module.exports = router;
