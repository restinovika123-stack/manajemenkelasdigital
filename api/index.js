const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
require('dotenv').config();

const ROOT_DIR = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.join(ROOT_DIR, 'backend-data');
const SQLITE_FILE = path.join(DATA_DIR, 'agendaguru.sqlite');

let isDbInitialized = false;
async function ensureDbInitialized() {
  if (isDbInitialized) return;
  // Initialize Schema
  const statements = schemaSql.split(';').filter(s => s.trim());
  for (const sql of statements) {
    await client.execute(sql);
  }
  isDbInitialized = true;
}

// Database Connection
const useTurso = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url: useTurso ? process.env.TURSO_DATABASE_URL : `file:${SQLITE_FILE}`,
  authToken: useTurso ? process.env.TURSO_AUTH_TOKEN : undefined,
});

// Mock PG Pool for absolute compatibility with existing logic
const pool = {
  async query(text, params = []) {
    const sqliteParams = [];
    const sqliteText = text.replace(/\$(\d+)/g, (match, p1) => {
      sqliteParams.push(params[parseInt(p1) - 1]);
      return '?';
    });

    try {
      const result = await client.execute({ sql: sqliteText, args: sqliteParams });
      
      const isSelect = sqliteText.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        return { rows: result.rows, rowCount: result.rows.length };
      } else {
        return { rows: [], rowCount: result.rowsAffected };
      }
    } catch (err) {
      console.error('DATABASE ERROR:', err.message, '\nQuery:', sqliteText, '\nParams:', sqliteParams);
      throw err;
    }
  },
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {}
    };
  }
};

// Database Schema
const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    school TEXT NOT NULL,
    login_id TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    user_photo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS classrooms (
    user_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    class_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, class_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS students (
    user_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, student_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance_sheets (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    month_year TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, record_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance_sheet_dates (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    column_index INTEGER NOT NULL,
    date_value TEXT NULL,
    PRIMARY KEY (user_id, record_id, column_index),
    FOREIGN KEY (user_id, record_id) REFERENCES attendance_sheets(user_id, record_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance_sheet_entries (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    column_index INTEGER NOT NULL,
    status_value TEXT NOT NULL,
    PRIMARY KEY (user_id, record_id, student_id, column_index),
    FOREIGN KEY (user_id, record_id) REFERENCES attendance_sheets(user_id, record_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS grade_sheets (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade_type TEXT NOT NULL,
    month_year TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, record_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS grade_sheet_columns (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    column_index INTEGER NOT NULL,
    date_value TEXT NULL,
    coverage_text TEXT NULL,
    PRIMARY KEY (user_id, record_id, column_index),
    FOREIGN KEY (user_id, record_id) REFERENCES grade_sheets(user_id, record_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS grade_sheet_entries (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    column_index INTEGER NOT NULL,
    score_text TEXT NULL,
    PRIMARY KEY (user_id, record_id, student_id, column_index),
    FOREIGN KEY (user_id, record_id) REFERENCES grade_sheets(user_id, record_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS koku_entries (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    category TEXT NOT NULL,
    narrative TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    class_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, record_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schedule_entries (
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    day_name TEXT NOT NULL,
    time_start TEXT NOT NULL,
    time_end TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, record_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;

// Utilities
function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(String(value || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(value, storedHash) {
  const password = String(value || '');
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt$')) {
    const [, salt, expectedDigest] = storedHash.split('$');
    const actualDigest = crypto.scryptSync(password, salt, 64).toString('hex');
    const expectedBuffer = Buffer.from(expectedDigest, 'hex');
    const actualBuffer = Buffer.from(actualDigest, 'hex');
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return legacyHash === storedHash;
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeUser(row) {
  return {
    UserID: row.user_id,
    FullName: row.full_name,
    School: row.school,
    LoginID: row.login_id,
    UserPhoto: row.user_photo || ''
  };
}

function parseMaybeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  if (!value.trim()) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function createEmptyDb(configOverrides = {}) {
  return {
    classes: [], students: [], attendance: [], grades: [],
    koku: [], journal: [], schedule: [],
    config: { userName: 'Guru', userSchool: 'Sekolah', userPhoto: '', ...configOverrides }
  };
}

// Transaction helper
async function withTransaction(callback) {
  const tx = await client.transaction("write");
  try {
    const shim = {
      query: async (text, params = []) => {
        const sqliteParams = [];
        const sqliteText = text.replace(/\$(\d+)/g, (match, p1) => {
          sqliteParams.push(params[parseInt(p1) - 1]);
          return '?';
        });
        const result = await tx.execute({ sql: sqliteText, args: sqliteParams });
        const isSelect = sqliteText.trim().toUpperCase().startsWith('SELECT');
        if (isSelect) {
          return { rows: result.rows, rowCount: result.rows.length };
        } else {
          return { rows: [], rowCount: result.rowsAffected };
        }
      }
    };
    const result = await callback(shim);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

// Data Persistence Logic
async function persistUserDbTx(client, userId, db, options = {}) {
  const now = new Date().toISOString();
  const safeDb = db || createEmptyDb();
  const config = safeDb.config || {};

  if (options.syncUserProfile !== false) {
    await client.query(
      `UPDATE users SET full_name = $2, school = $3, user_photo = $4, updated_at = $5 WHERE user_id = $1`,
      [userId, config.userName || 'Guru', config.userSchool || 'Sekolah', config.userPhoto || '', now]
    );
  }

  await client.query('DELETE FROM attendance_sheets WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM grade_sheets WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM koku_entries WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM journal_entries WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM schedule_entries WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM students WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM classrooms WHERE user_id = $1', [userId]);

  for (const item of safeDb.classes || []) {
    await client.query(
      `INSERT INTO classrooms (user_id, class_id, class_name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
      [userId, item.ClassID, item.ClassName, now]
    );
  }

  for (const item of safeDb.students || []) {
    await client.query(
      `INSERT INTO students (user_id, student_id, class_id, student_name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
      [userId, item.StudentID, item.ClassID, item.StudentName, now]
    );
  }

  for (const sheet of safeDb.attendance || []) {
    await client.query(
      `INSERT INTO attendance_sheets (user_id, record_id, class_id, month_year, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
      [userId, sheet.RecordID, sheet.ClassID, sheet.MonthYear, now]
    );
    const dates = parseMaybeJson(sheet.DatesData, []);
    for (let i = 0; i < dates.length; i++) {
      await client.query(
        `INSERT INTO attendance_sheet_dates (user_id, record_id, column_index, date_value) VALUES ($1, $2, $3, $4)`,
        [userId, sheet.RecordID, i, dates[i] || null]
      );
    }
    const attData = parseMaybeJson(sheet.AttendanceData, {});
    for (const [sid, values] of Object.entries(attData)) {
      for (let i = 0; i < values.length; i++) {
        await client.query(
          `INSERT INTO attendance_sheet_entries (user_id, record_id, student_id, column_index, status_value) VALUES ($1, $2, $3, $4, $5)`,
          [userId, sheet.RecordID, sid, i, values[i] ?? '-']
        );
      }
    }
  }

  for (const sheet of safeDb.grades || []) {
    await client.query(
      `INSERT INTO grade_sheets (user_id, record_id, class_id, subject, grade_type, month_year, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [userId, sheet.RecordID, sheet.ClassID, sheet.Subject, sheet.Type, sheet.MonthYear || null, now]
    );
    const dates = parseMaybeJson(sheet.DatesData, []);
    const coverages = parseMaybeJson(sheet.Cakupan, []);
    const maxCols = Math.max(dates.length, coverages.length);
    for (let i = 0; i < maxCols; i++) {
      await client.query(
        `INSERT INTO grade_sheet_columns (user_id, record_id, column_index, date_value, coverage_text) VALUES ($1, $2, $3, $4, $5)`,
        [userId, sheet.RecordID, i, dates[i] || null, coverages[i] || null]
      );
    }
    const gradeData = parseMaybeJson(sheet.GradesData, {});
    for (const [sid, values] of Object.entries(gradeData)) {
      for (let i = 0; i < values.length; i++) {
        await client.query(
          `INSERT INTO grade_sheet_entries (user_id, record_id, student_id, column_index, score_text) VALUES ($1, $2, $3, $4, $5)`,
          [userId, sheet.RecordID, sid, i, values[i] ?? '']
        );
      }
    }
  }

  for (const item of safeDb.koku || []) {
    await client.query(
      `INSERT INTO koku_entries (user_id, student_name, category, narrative, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [userId, item.Siswa, item.Kategori, item.Narasi, now]
    );
  }

  for (const item of safeDb.journal || []) {
    await client.query(
      `INSERT INTO journal_entries (user_id, record_id, entry_date, class_id, subject, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [userId, item.RecordID, item.Date, item.ClassID, item.Subject, item.Content, now]
    );
  }

  for (const item of safeDb.schedule || []) {
    await client.query(
      `INSERT INTO schedule_entries (user_id, record_id, day_name, time_start, time_end, subject, class_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [userId, item.RecordID, item.Day, item.TimeStart, item.TimeEnd, item.Subject, item.ClassID, now]
    );
  }
}

async function loadUserDb(userId) {
  const [uRes, cRes, sRes, asRes, adRes, aeRes, gsRes, gcRes, geRes, kRes, jRes, scRes] = await Promise.all([
    pool.query('SELECT * FROM users WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM classrooms WHERE user_id = $1 ORDER BY class_id', [userId]),
    pool.query('SELECT * FROM students WHERE user_id = $1 ORDER BY student_id', [userId]),
    pool.query('SELECT * FROM attendance_sheets WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM attendance_sheet_dates WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM attendance_sheet_entries WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM grade_sheets WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM grade_sheet_columns WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM grade_sheet_entries WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM koku_entries WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM journal_entries WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM schedule_entries WHERE user_id = $1', [userId])
  ]);

  const user = uRes.rows[0];
  const db = createEmptyDb({
    userName: user?.full_name || 'Guru',
    userSchool: user?.school || 'Sekolah',
    userPhoto: user?.user_photo || ''
  });

  db.classes = cRes.rows.map(r => ({ ClassID: r.class_id, ClassName: r.class_name }));
  db.students = sRes.rows.map(r => ({ StudentID: r.student_id, ClassID: r.class_id, StudentName: r.student_name }));

  const attDates = new Map();
  adRes.rows.forEach(r => {
    if (!attDates.has(r.record_id)) attDates.set(r.record_id, []);
    attDates.get(r.record_id)[r.column_index] = r.date_value || '';
  });
  const attEntries = new Map();
  aeRes.rows.forEach(r => {
    if (!attEntries.has(r.record_id)) attEntries.set(r.record_id, {});
    const sheet = attEntries.get(r.record_id);
    if (!sheet[r.student_id]) sheet[r.student_id] = [];
    sheet[r.student_id][r.column_index] = r.status_value;
  });

  db.attendance = asRes.rows.map(r => ({
    RecordID: r.record_id, ClassID: r.class_id, MonthYear: r.month_year,
    DatesData: JSON.stringify(attDates.get(r.record_id) || []),
    AttendanceData: JSON.stringify(attEntries.get(r.record_id) || {})
  }));

  const gradeCols = new Map();
  const gradeCovs = new Map();
  gcRes.rows.forEach(r => {
    if (!gradeCols.has(r.record_id)) gradeCols.set(r.record_id, []);
    if (!gradeCovs.has(r.record_id)) gradeCovs.set(r.record_id, []);
    gradeCols.get(r.record_id)[r.column_index] = r.date_value || '';
    gradeCovs.get(r.record_id)[r.column_index] = r.coverage_text || '';
  });
  const gradeEntries = new Map();
  geRes.rows.forEach(r => {
    if (!gradeEntries.has(r.record_id)) gradeEntries.set(r.record_id, {});
    const sheet = gradeEntries.get(r.record_id);
    if (!sheet[r.student_id]) sheet[r.student_id] = [];
    sheet[r.student_id][r.column_index] = r.score_text || '';
  });

  db.grades = gsRes.rows.map(r => ({
    RecordID: r.record_id, ClassID: r.class_id, Subject: r.subject, Type: r.grade_type, MonthYear: r.month_year,
    DatesData: JSON.stringify(gradeCols.get(r.record_id) || []),
    Cakupan: JSON.stringify(gradeCovs.get(r.record_id) || []),
    GradesData: JSON.stringify(gradeEntries.get(r.record_id) || {})
  }));

  db.koku = kRes.rows.map(r => ({ Siswa: r.student_name, Kategori: r.category, Narasi: r.narrative }));
  db.journal = jRes.rows.map(r => ({ RecordID: r.record_id, Date: r.entry_date, ClassID: r.class_id, Subject: r.subject, Content: r.content }));
  db.schedule = scRes.rows.map(r => ({ RecordID: r.record_id, Day: r.day_name, TimeStart: r.time_start, TimeEnd: r.time_end, Subject: r.subject, ClassID: r.class_id }));

  return db;
}

// Express App setup
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(ROOT_DIR));

// Database Readiness Middleware
app.use(async (req, res, next) => {
  if (req.path === '/api/health') return next();
  try {
    await ensureDbInitialized();
    next();
  } catch (err) {
    console.error('Database Initialization Error:', err);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// API Routes
app.get('/api/health', (req, res) => res.json({ ok: true, engine: 'sqlite' }));

app.get('/api/bootstrap', async (req, res) => {
  const result = await pool.query('SELECT login_id FROM users ORDER BY created_at ASC LIMIT 1');
  res.json({ ok: true, defaultLoginId: result.rows[0]?.login_id || '' });
});

app.post('/api/auth/login', async (req, res) => {
  const { loginId, password } = req.body;
  const nid = normalizeIdentifier(loginId);
  const result = await pool.query('SELECT * FROM users WHERE login_id = $1', [nid]);
  const user = result.rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ message: 'Login ID atau password salah.' });
  }

  res.json({
    user: sanitizeUser(user),
    db: await loadUserDb(user.user_id)
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { fullName, school, loginId, password } = req.body;
  const nid = normalizeIdentifier(loginId);

  if (!fullName || !school || !nid || !password) {
    return res.status(400).json({ message: 'Data tidak lengkap.' });
  }

  const dup = await pool.query('SELECT 1 FROM users WHERE login_id = $1', [nid]);
  if (dup.rowCount > 0) {
    return res.status(409).json({ message: 'Login ID sudah terdaftar.' });
  }

  const userId = `U${Date.now()}`;
  const now = new Date().toISOString();
  
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO users (user_id, full_name, school, login_id, password_hash, user_photo, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, fullName, school, nid, hashPassword(password), '', now, now]
    );
    await persistUserDbTx(client, userId, createEmptyDb({ userName: fullName, userSchool: school }), { syncUserProfile: false });
  });

  const created = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  res.status(201).json({
    user: sanitizeUser(created.rows[0]),
    db: await loadUserDb(userId)
  });
});

app.get('/api/users/:userId/db', async (req, res) => {
  res.json({ db: await loadUserDb(req.params.userId) });
});

app.put('/api/users/:userId/db', async (req, res) => {
  await withTransaction(async client => {
    await persistUserDbTx(client, req.params.userId, req.body.db, { syncUserProfile: true });
  });
  res.json({ ok: true });
});

app.put('/api/users/:userId/profile', async (req, res) => {
  const { userId } = req.params;
  const { fullName, school, userPhoto } = req.body;
  const now = new Date().toISOString();

  await withTransaction(async client => {
    await client.query(
      `UPDATE users SET full_name = $2, school = $3, user_photo = $4, updated_at = $5 WHERE user_id = $1`,
      [userId, fullName, school, userPhoto || '', now]
    );
    const db = await loadUserDb(userId);
    db.config.userName = fullName;
    db.config.userSchool = school;
    db.config.userPhoto = userPhoto || '';
    await persistUserDbTx(client, userId, db, { syncUserProfile: false });
  });

  const updated = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  res.json({ user: sanitizeUser(updated.rows[0]) });
});

// Catch-all route to serve index.html for frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// Init and Start
module.exports = app;

if (require.main === module) {
  async function startServer() {
    try {
      // Ensure data directory exists for local fallback
      if (!useTurso && !fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      await ensureDbInitialized();
      
      app.listen(PORT, HOST, () => {
        console.log(`AgendaGuru Backend (Express) running at http://${HOST}:${PORT}`);
        console.log(`Using Database: ${useTurso ? 'Turso DB (Production)' : 'Local SQLite'}`);
      });
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  }
  startServer();
}
