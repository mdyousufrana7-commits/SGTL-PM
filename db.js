// db.js — persistence layer using Node's built-in node:sqlite (Node 22+).
// Nothing to npm install. Designed so it's straightforward to later port
// to PostgreSQL when this moves to a company server (same query shapes,
// no SQLite-only tricks beyond AUTOINCREMENT).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'solar_epc.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','pm','engineer')),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client_name TEXT,
    capacity TEXT,
    location TEXT,
    project_manager TEXT,
    site_engineer TEXT,
    engineer_username TEXT,
    pm_username TEXT,
    start_date TEXT,
    expected_completion TEXT,
    progress_percent REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Planning',
    engineers_count INTEGER DEFAULT 0,
    labour_count INTEGER DEFAULT 0,
    last_site_update INTEGER,
    last_updated_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    planned_quantity REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS material_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    usage_date TEXT NOT NULL,
    quantity_used REAL NOT NULL DEFAULT 0,
    remarks TEXT,
    logged_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id);
  CREATE INDEX IF NOT EXISTS idx_usage_material ON material_usage(material_id);
  CREATE INDEX IF NOT EXISTS idx_usage_project_date ON material_usage(project_id, usage_date);
`);

/* ---------------- users ---------------- */
function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function listUsers() {
  return db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at ASC').all();
}
function insertUser(u) {
  db.prepare(`INSERT INTO users (username, password_hash, password_salt, full_name, role, created_at)
    VALUES (?,?,?,?,?,?)`).run(u.username, u.password_hash, u.password_salt, u.full_name, u.role, Date.now());
  return getUserByUsername(u.username);
}
function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/* ---------------- sessions ---------------- */
function createSession(token, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expiresAt);
}
function getSession(token) {
  return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
}
function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

/* ---------------- projects ---------------- */
function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
}
function getProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}
function insertProject(p) {
  const info = db.prepare(`INSERT INTO projects
    (name, client_name, capacity, location, project_manager, site_engineer, engineer_username, pm_username,
     start_date, expected_completion, progress_percent, status, engineers_count, labour_count,
     last_site_update, last_updated_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    p.name, p.client_name || null, p.capacity || null, p.location || null,
    p.project_manager || null, p.site_engineer || null, p.engineer_username || null, p.pm_username || null,
    p.start_date || null, p.expected_completion || null, p.progress_percent || 0, p.status || 'Planning',
    p.engineers_count || 0, p.labour_count || 0, Date.now(), p.last_updated_by || null, Date.now()
  );
  return getProject(info.lastInsertRowid);
}
function updateProject(id, fields) {
  const allowed = ['name','client_name','capacity','location','project_manager','site_engineer',
    'engineer_username','pm_username','start_date','expected_completion','progress_percent','status',
    'engineers_count','labour_count'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (sets.length === 0) return getProject(id);
  sets.push('last_site_update = ?'); vals.push(Date.now());
  sets.push('last_updated_by = ?'); vals.push(fields.last_updated_by || null);
  vals.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProject(id);
}
function touchProject(id, updatedBy) {
  db.prepare('UPDATE projects SET last_site_update = ?, last_updated_by = ? WHERE id = ?')
    .run(Date.now(), updatedBy || null, id);
}
function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* ---------------- materials ---------------- */
function listMaterials(projectId) {
  return db.prepare('SELECT * FROM materials WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
}
function getMaterial(id) {
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
}
function insertMaterial(m) {
  const info = db.prepare(`INSERT INTO materials (project_id, name, unit, planned_quantity, created_at)
    VALUES (?,?,?,?,?)`).run(m.project_id, m.name, m.unit, m.planned_quantity || 0, Date.now());
  return getMaterial(info.lastInsertRowid);
}
function deleteMaterial(id) {
  db.prepare('DELETE FROM materials WHERE id = ?').run(id);
}
function totalUsed(materialId) {
  const row = db.prepare('SELECT COALESCE(SUM(quantity_used),0) AS total FROM material_usage WHERE material_id = ?').get(materialId);
  return row.total;
}

/* ---------------- material usage ---------------- */
function insertUsage(u) {
  const info = db.prepare(`INSERT INTO material_usage
    (material_id, project_id, usage_date, quantity_used, remarks, logged_by, created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    u.material_id, u.project_id, u.usage_date, u.quantity_used, u.remarks || null, u.logged_by || null, Date.now()
  );
  return db.prepare('SELECT * FROM material_usage WHERE id = ?').get(info.lastInsertRowid);
}
function usageHistory(materialId, limit) {
  return db.prepare('SELECT * FROM material_usage WHERE material_id = ? ORDER BY usage_date DESC, created_at DESC LIMIT ?')
    .all(materialId, limit || 200);
}
function usageByProjectAndDate(projectId, date) {
  return db.prepare('SELECT * FROM material_usage WHERE project_id = ? AND usage_date = ? ORDER BY created_at DESC')
    .all(projectId, date);
}
function usageForProject(projectId, limit) {
  return db.prepare('SELECT * FROM material_usage WHERE project_id = ? ORDER BY usage_date DESC, created_at DESC LIMIT ?')
    .all(projectId, limit || 500);
}

module.exports = {
  getUserByUsername, getUserById, listUsers, insertUser, countUsers,
  createSession, getSession, deleteSession, purgeExpiredSessions,
  listProjects, getProject, insertProject, updateProject, touchProject, deleteProject,
  listMaterials, getMaterial, insertMaterial, deleteMaterial, totalUsed,
  insertUsage, usageHistory, usageByProjectAndDate, usageForProject
};
