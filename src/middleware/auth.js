const { findUserById } = require('../models');

function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = findUserById(req.session.userId);
    if (user) {
      res.locals.currentUser = { id: user.id, username: user.username, isAdmin: user.isAdmin };
    } else {
      req.session = null;
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!res.locals.currentUser) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser || !res.locals.currentUser.isAdmin) {
    return res.status(403).render('error', { title: 'Geen toegang', message: 'Alleen de admin heeft toegang tot deze pagina.' });
  }
  next();
}

module.exports = { loadUser, requireLogin, requireAdmin };
