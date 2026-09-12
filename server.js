require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');

const { ensureAdminUser } = require('./src/models');
const { loadUser } = require('./src/middleware/auth');
const { startCron } = require('./src/cron');

const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const memberRoutes = require('./src/routes/members');
const callingRoutes = require('./src/routes/callings');
const publicVoteRoutes = require('./src/routes/publicVote');

const app = express();
const PORT = process.env.PORT || 3000;

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[server] SESSION_SECRET is niet gezet; er wordt een tijdelijke sleutel gebruikt. Iedereen wordt uitgelogd bij een herstart. Zet SESSION_SECRET in productie.'
  );
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  cookieSession({
    name: 'ringpresidium.sid',
    secret: sessionSecret,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE || 'true') === 'true',
    httpOnly: true,
  })
);
app.use(loadUser);

app.get('/', (req, res) => res.redirect(res.locals.currentUser ? '/dashboard' : '/login'));

// Publieke routes (login, publieke stempagina) staan hier bewust vóór de
// beveiligde routers: die routers passen `requireLogin` toe op ál hun
// binnenkomende requests (ook paden die ze zelf niet afhandelen), dus als ze
// eerder gemount zouden zijn, zouden ze de publieke /vote/:token-pagina
// onterecht naar /login sturen.
app.use(authRoutes);
app.use(publicVoteRoutes);
app.use('/admin', adminRoutes);
app.use(memberRoutes);
app.use(callingRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze pagina bestaat niet.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Er ging iets mis', message: 'Er is een onverwachte fout opgetreden.' });
});

ensureAdminUser(process.env.ADMIN_USERNAME || 'webmin', process.env.ADMIN_PASSWORD || 'ldstools123!');
startCron();

app.listen(PORT, () => {
  console.log(`[server] Ringpresidium-tool draait op poort ${PORT}`);
});
