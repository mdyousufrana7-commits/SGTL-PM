// auth.js — password hashing (scrypt) and bearer-token sessions, using only
// Node's built-in crypto module. No npm packages required.
const crypto = require('crypto');
const db = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSessionForUser(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.createSession(token, userId, expiresAt);
  return { token, expiresAt };
}

function getUserFromToken(token) {
  if (!token) return null;
  const session = db.getSession(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) { db.deleteSession(token); return null; }
  const user = db.getUserById(session.user_id);
  return user || null;
}

function getBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
}

// Ensure a default admin account exists on first run.
function ensureDefaultAdmin() {
  if (db.countUsers() === 0) {
    const { hash, salt } = hashPassword('admin123');
    db.insertUser({ username: 'admin', password_hash: hash, password_salt: salt, full_name: 'Administrator', role: 'admin' });
    console.log('Created default admin account -> username: admin / password: admin123 (please change this)');
  }
}

module.exports = {
  hashPassword, verifyPassword, createSessionForUser, getUserFromToken,
  getBearerToken, publicUser, ensureDefaultAdmin
};
