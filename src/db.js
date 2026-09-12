const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDB() {
  return { users: [], members: [], callings: [] };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDB() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    writeDB(emptyDB());
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Databasebestand ${DB_FILE} is corrupt: ${err.message}`);
  }
}

function writeDB(db) {
  ensureDataDir();
  const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function newToken() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = { readDB, writeDB, newId, newToken, DATA_DIR };
