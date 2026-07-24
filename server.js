// server.js — plain Node http server (no Express/npm install needed).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const db = require('./db');
const auth = require('./auth');

const PORT = process.env.PORT || 5178;
const INDEX_FILE = path.join(__dirname, 'index.html');

const STATIC_FILES = {
  '/manifest.json': { file: path.join(__dirname, 'manifest.json'), type: 'application/json; charset=utf-8' },
  '/sw.js': { file: path.join(__dirname, 'sw.js'), type: 'text/javascript; charset=utf-8' },
  '/icon.svg': { file: path.join(__dirname, 'icon.svg'), type: 'image/svg+xml' }
};

auth.ensureDefaultAdmin();
setInterval(() => db.purgeExpiredSessions(), 60 * 60 * 1000);

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Access-Control-Allow-Origin': '*' }, headers));
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 3_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

function serveIndex(req, res) {
  fs.readFile(INDEX_FILE, (err, data) => {
    if (err) { send(res, 404, 'index.html not found'); return; }
    send(res, 200, data, { 'Content-Type': 'text/html; charset=utf-8' });
  });
}
function serveStaticFile(res, entry) {
  fs.readFile(entry.file, (err, data) => {
    if (err) { send(res, 404, 'Not found'); return; }
    send(res, 200, data, { 'Content-Type': entry.type });
  });
}

/* ---------------- permission helpers ---------------- */
function requireAuth(req) {
  const token = auth.getBearerToken(req);
  const user = auth.getUserFromToken(token);
  return user; // null if not authenticated
}
function canManageProjects(user) { return user && (user.role === 'admin' || user.role === 'pm'); }
function canDeleteAnything(user) { return user && user.role === 'admin'; }
function canLogUsage(user, project) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'pm') return true;
  if (user.role === 'engineer') return project && project.engineer_username === user.username;
  return false;
}

function projectPublic(p) {
  return p; // all fields are safe to expose to any logged-in user
}

function materialWithTotals(m) {
  const used = db.totalUsed(m.id);
  return {
    ...m,
    total_used: used,
    remaining_quantity: (m.planned_quantity || 0) - used
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const method = req.method;

  try {
    // ---------- static assets (no auth) ----------
    if (STATIC_FILES[p] && method === 'GET') return serveStaticFile(res, STATIC_FILES[p]);

    // ---------- auth ----------
    if (p === '/api/auth/login' && method === 'POST') {
      const body = await readJson(req);
      const username = (body.username || '').trim();
      const password = body.password || '';
      const user = db.getUserByUsername(username);
      if (!user || !auth.verifyPassword(password, user.password_salt, user.password_hash)) {
        return json(res, 401, { error: 'Invalid username or password' });
      }
      const { token, expiresAt } = auth.createSessionForUser(user.id);
      return json(res, 200, { token, expiresAt, user: auth.publicUser(user) });
    }

    if (p === '/api/auth/logout' && method === 'POST') {
      const token = auth.getBearerToken(req);
      if (token) db.deleteSession(token);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/auth/me' && method === 'GET') {
      const user = requireAuth(req);
      if (!user) return json(res, 401, { error: 'Not authenticated' });
      return json(res, 200, { user: auth.publicUser(user) });
    }

    // ---------- everything below requires login ----------
    const user = requireAuth(req);
    if (p.startsWith('/api/') && !user) return json(res, 401, { error: 'Please log in' });

    // ---------- users ----------
    // Admin and PM can view the user list (needed for the Engineer/PM assignment
    // dropdown when creating or editing a project). Only admin can create users.
    if (p === '/api/users' && method === 'GET') {
      if (!canManageProjects(user)) return json(res, 403, { error: 'Admin or PM only' });
      return json(res, 200, db.listUsers());
    }
    if (p === '/api/users' && method === 'POST') {
      if (!canDeleteAnything(user)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const username = (body.username || '').trim();
      const full_name = (body.full_name || '').trim();
      const role = body.role;
      const password = body.password || '';
      if (!username || !full_name || !password || !['admin','pm','engineer'].includes(role)) {
        return json(res, 400, { error: 'username, full_name, password, and a valid role are required' });
      }
      if (db.getUserByUsername(username)) return json(res, 400, { error: 'Username already exists' });
      const { hash, salt } = auth.hashPassword(password);
      const newUser = db.insertUser({ username, password_hash: hash, password_salt: salt, full_name, role });
      return json(res, 201, auth.publicUser(newUser));
    }

    // ---------- projects ----------
    if (p === '/api/projects' && method === 'GET') {
      let projects = db.listProjects();
      if (user.role === 'engineer') {
        projects = projects.filter(pr => pr.engineer_username === user.username);
      }
      return json(res, 200, projects.map(projectPublic));
    }

    if (p === '/api/projects' && method === 'POST') {
      if (!canManageProjects(user)) return json(res, 403, { error: 'Only admin/PM can create projects' });
      const body = await readJson(req);
      if (!body.name || !body.name.trim()) return json(res, 400, { error: 'Project name is required' });
      const project = db.insertProject({ ...body, last_updated_by: user.full_name });
      return json(res, 201, project);
    }

    const projectIdMatch = p.match(/^\/api\/projects\/(\d+)$/);
    if (projectIdMatch && method === 'GET') {
      const project = db.getProject(Number(projectIdMatch[1]));
      if (!project) return json(res, 404, { error: 'Project not found' });
      if (user.role === 'engineer' && project.engineer_username !== user.username) {
        return json(res, 403, { error: 'Not assigned to this project' });
      }
      return json(res, 200, project);
    }

    if (projectIdMatch && method === 'PUT') {
      const projectId = Number(projectIdMatch[1]);
      const project = db.getProject(projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });
      if (!canManageProjects(user)) return json(res, 403, { error: 'Only admin/PM can edit project details' });
      const body = await readJson(req);
      const updated = db.updateProject(projectId, { ...body, last_updated_by: user.full_name });
      return json(res, 200, updated);
    }

    if (projectIdMatch && method === 'DELETE') {
      if (!canDeleteAnything(user)) return json(res, 403, { error: 'Admin only' });
      db.deleteProject(Number(projectIdMatch[1]));
      return json(res, 200, { ok: true });
    }

    // ---------- materials ----------
    const materialsListMatch = p.match(/^\/api\/projects\/(\d+)\/materials$/);
    if (materialsListMatch && method === 'GET') {
      const projectId = Number(materialsListMatch[1]);
      const project = db.getProject(projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });
      if (user.role === 'engineer' && project.engineer_username !== user.username) {
        return json(res, 403, { error: 'Not assigned to this project' });
      }
      const materials = db.listMaterials(projectId).map(materialWithTotals);
      return json(res, 200, materials);
    }

    if (materialsListMatch && method === 'POST') {
      const projectId = Number(materialsListMatch[1]);
      const project = db.getProject(projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });
      if (!canManageProjects(user)) return json(res, 403, { error: 'Only admin/PM can add materials' });
      const body = await readJson(req);
      if (!body.name || !body.unit) return json(res, 400, { error: 'name and unit are required' });
      const material = db.insertMaterial({
        project_id: projectId, name: body.name.trim(), unit: body.unit.trim(),
        planned_quantity: Number(body.planned_quantity) || 0
      });
      return json(res, 201, materialWithTotals(material));
    }

    const materialDeleteMatch = p.match(/^\/api\/projects\/(\d+)\/materials\/(\d+)$/);
    if (materialDeleteMatch && method === 'DELETE') {
      if (!canManageProjects(user)) return json(res, 403, { error: 'Only admin/PM can remove materials' });
      db.deleteMaterial(Number(materialDeleteMatch[2]));
      return json(res, 200, { ok: true });
    }

    // ---------- material usage ----------
    const usageListMatch = p.match(/^\/api\/projects\/(\d+)\/materials\/(\d+)\/usage$/);
    if (usageListMatch && method === 'GET') {
      const materialId = Number(usageListMatch[2]);
      const limit = Math.min(500, parseInt(u.searchParams.get('limit')) || 200);
      return json(res, 200, db.usageHistory(materialId, limit));
    }

    if (usageListMatch && method === 'POST') {
      const projectId = Number(usageListMatch[1]);
      const materialId = Number(usageListMatch[2]);
      const project = db.getProject(projectId);
      const material = db.getMaterial(materialId);
      if (!project || !material) return json(res, 404, { error: 'Project or material not found' });
      if (!canLogUsage(user, project)) return json(res, 403, { error: 'Not authorized to log usage for this project' });
      const body = await readJson(req);
      const qty = Number(body.quantity_used);
      if (isNaN(qty) || qty < 0) return json(res, 400, { error: 'quantity_used must be a non-negative number' });
      const usage_date = body.usage_date || new Date().toISOString().slice(0, 10);
      const entry = db.insertUsage({
        material_id: materialId, project_id: projectId, usage_date,
        quantity_used: qty, remarks: body.remarks || null, logged_by: user.full_name
      });
      db.touchProject(projectId, user.full_name);
      return json(res, 201, { entry, material: materialWithTotals(material) });
    }

    // Project-wide usage feed (management view: usage by date across all materials)
    const projectUsageMatch = p.match(/^\/api\/projects\/(\d+)\/usage$/);
    if (projectUsageMatch && method === 'GET') {
      const projectId = Number(projectUsageMatch[1]);
      const project = db.getProject(projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });
      if (user.role === 'engineer' && project.engineer_username !== user.username) {
        return json(res, 403, { error: 'Not assigned to this project' });
      }
      const limit = Math.min(1000, parseInt(u.searchParams.get('limit')) || 500);
      const rows = db.usageForProject(projectId, limit);
      // attach material name/unit for display
      const materials = db.listMaterials(projectId);
      const byId = Object.fromEntries(materials.map(m => [m.id, m]));
      const enriched = rows.map(r => ({ ...r, material_name: byId[r.material_id]?.name, unit: byId[r.material_id]?.unit }));
      return json(res, 200, enriched);
    }

    // ---------- static (single-page app) ----------
    if (method === 'GET' && !p.startsWith('/api/')) return serveIndex(req, res);

    return send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Solar EPC MVP running: http://localhost:${PORT}`);
});
