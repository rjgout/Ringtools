const bcrypt = require('bcryptjs');
const { readDB, writeDB, newId, newToken } = require('./db');

// ---- users (inlogaccounts: admin + ringpresidium) ----

function findUserByUsername(username) {
  const db = readDB();
  return db.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
}

function findUserById(id) {
  const db = readDB();
  return db.users.find((u) => u.id === id);
}

function listUsers() {
  const db = readDB();
  return db.users.slice().sort((a, b) => a.username.localeCompare(b.username));
}

function listRingpresidiumEmails() {
  const db = readDB();
  return db.users.filter((u) => u.email).map((u) => u.email);
}

function ensureAdminUser(username, plainPassword) {
  const db = readDB();
  let admin = db.users.find((u) => u.isAdmin);
  const passwordHash = bcrypt.hashSync(plainPassword, 10);
  if (!admin) {
    admin = {
      id: newId(),
      username,
      email: '',
      passwordHash,
      isAdmin: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(admin);
    writeDB(db);
  } else if (admin.username !== username || !bcrypt.compareSync(plainPassword, admin.passwordHash)) {
    // Houd het admin-account gesynchroniseerd met de ADMIN_USERNAME/ADMIN_PASSWORD env-variabelen.
    admin.username = username;
    admin.passwordHash = passwordHash;
    writeDB(db);
  }
}

function createUser({ username, password, email }) {
  const db = readDB();
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('Er bestaat al een gebruiker met deze gebruikersnaam.');
  }
  const user = {
    id: newId(),
    username,
    email: email || '',
    passwordHash: bcrypt.hashSync(password, 10),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeDB(db);
  return user;
}

function deleteUser(id) {
  const db = readDB();
  const user = db.users.find((u) => u.id === id);
  if (user && user.isAdmin) {
    throw new Error('Het admin-account kan niet verwijderd worden.');
  }
  db.users = db.users.filter((u) => u.id !== id);
  writeDB(db);
}

function verifyPassword(user, plainPassword) {
  return bcrypt.compareSync(plainPassword, user.passwordHash);
}

// ---- hogeraadsleden ----

function listMembers() {
  const db = readDB();
  return db.members.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function addMember(name) {
  const db = readDB();
  const member = { id: newId(), name: name.trim(), createdAt: new Date().toISOString() };
  db.members.push(member);
  writeDB(db);
  return member;
}

function deleteMember(id) {
  const db = readDB();
  db.members = db.members.filter((m) => m.id !== id);
  writeDB(db);
}

// ---- roepingen ----

function computeStatus(calling) {
  const allResponded = calling.expectedMembers.every((em) =>
    calling.votes.some((v) => v.memberId === em.id)
  );
  return allResponded ? 'te_verwerken' : 'open';
}

function withStatus(calling) {
  return { ...calling, status: computeStatus(calling) };
}

function listCallings() {
  const db = readDB();
  return db.callings.map(withStatus).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function findCallingById(id) {
  const db = readDB();
  const calling = db.callings.find((c) => c.id === id);
  return calling ? withStatus(calling) : null;
}

function findCallingByToken(token) {
  const db = readDB();
  const calling = db.callings.find((c) => c.token === token);
  return calling ? withStatus(calling) : null;
}

function createCalling({ name, functie, createdBy }) {
  const db = readDB();
  const calling = {
    id: newId(),
    token: newToken(),
    name: name.trim(),
    functie: functie.trim(),
    createdBy,
    createdAt: new Date().toISOString(),
    completedAt: null,
    expectedMembers: db.members.map((m) => ({ id: m.id, name: m.name })),
    votes: [],
  };
  db.callings.push(calling);
  writeDB(db);
  return withStatus(calling);
}

function recordVote(callingId, { memberId, support, byBackend }) {
  const db = readDB();
  const calling = db.callings.find((c) => c.id === callingId);
  if (!calling) throw new Error('Roeping niet gevonden.');
  const member = calling.expectedMembers.find((m) => m.id === memberId);
  if (!member) throw new Error('Dit hogeraadslid hoort niet bij deze roeping.');
  if (calling.votes.some((v) => v.memberId === memberId)) {
    throw new Error('Dit hogeraadslid heeft al gereageerd op deze roeping.');
  }
  calling.votes.push({
    memberId,
    memberName: member.name,
    support: !!support,
    respondedAt: new Date().toISOString(),
    byBackend: !!byBackend,
  });
  const nowComplete = calling.expectedMembers.every((em) =>
    calling.votes.some((v) => v.memberId === em.id)
  );
  if (nowComplete && !calling.completedAt) {
    calling.completedAt = new Date().toISOString();
  }
  writeDB(db);
  return withStatus(calling);
}

function deleteCalling(id) {
  const db = readDB();
  db.callings = db.callings.filter((c) => c.id !== id);
  writeDB(db);
}

function listCallingsOlderThan(days) {
  const db = readDB();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return db.callings
    .map(withStatus)
    .filter((c) => c.status === 'te_verwerken' && c.completedAt && new Date(c.completedAt).getTime() <= cutoff);
}

module.exports = {
  findUserByUsername,
  findUserById,
  listUsers,
  listRingpresidiumEmails,
  ensureAdminUser,
  createUser,
  deleteUser,
  verifyPassword,
  listMembers,
  addMember,
  deleteMember,
  listCallings,
  findCallingById,
  findCallingByToken,
  createCalling,
  recordVote,
  deleteCalling,
  listCallingsOlderThan,
};
