const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const axios = require('axios');

const app = express();
const PORT = Number(process.env.PORT || 5001);
const ALLOWED_PLATFORMS = new Set(['linkedin', 'coursera']);
const USERS = [
  { email: 'user@cert.com', password: 'user123', role: 'user', platform: null, name: 'Student User' },
  {
    email: 'linkedin@cert.com',
    password: 'linkedin123',
    role: 'admin',
    platform: 'linkedin',
    name: 'LinkedIn Dashboard',
  },
  {
    email: 'coursera@cert.com',
    password: 'coursera123',
    role: 'admin',
    platform: 'coursera',
    name: 'Coursera Dashboard',
  },
  {
    email: 'admin@cert.com',
    password: 'admin123',
    role: 'main_admin',
    platform: null,
    name: 'Admin Dashboard',
  },
  {
    email: 'admin.linkedin@cert.com',
    password: 'admin123',
    role: 'admin',
    platform: 'linkedin',
    name: 'LinkedIn Admin',
  },
  {
    email: 'admin.coursera@cert.com',
    password: 'admin123',
    role: 'admin',
    platform: 'coursera',
    name: 'Coursera Admin',
  },
  {
    email: 'mainadmin@cert.com',
    password: 'main123',
    role: 'main_admin',
    platform: null,
    name: 'Main Admin',
  },
];
const sessions = new Map();

app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const dbPath = path.join(__dirname, 'certificate_chain.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_index INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    data_json TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    student_id TEXT NOT NULL,
    course TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    cert_hash TEXT NOT NULL UNIQUE,
    block_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (block_id) REFERENCES blocks(id)
  );
`);

const certificateColumns = db
  .prepare(`PRAGMA table_info(certificates)`)
  .all()
  .map((column) => column.name);

if (!certificateColumns.includes('wallet_address')) {
  db.exec(`ALTER TABLE certificates ADD COLUMN wallet_address TEXT`);
}

if (!certificateColumns.includes('wallet_signature')) {
  db.exec(`ALTER TABLE certificates ADD COLUMN wallet_signature TEXT`);
}

if (!certificateColumns.includes('platform')) {
  db.exec(`ALTER TABLE certificates ADD COLUMN platform TEXT`);
}

if (!certificateColumns.includes('source_file_name')) {
  db.exec(`ALTER TABLE certificates ADD COLUMN source_file_name TEXT`);
}

if (!certificateColumns.includes('submitted_by')) {
  db.exec(`ALTER TABLE certificates ADD COLUMN submitted_by TEXT`);
}

if (!certificateColumns.includes('approved_by')) {
  db.exec(`ALTER TABLE certificates ADD COLUMN approved_by TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file_name TEXT NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    student_name TEXT,
    course TEXT,
    student_id TEXT,
    platform TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    wallet_signature TEXT NOT NULL,
    submitted_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const pendingColumns = db
  .prepare(`PRAGMA table_info(pending_certificates)`)
  .all()
  .map((column) => column.name);

if (!pendingColumns.includes('student_name')) {
  db.exec(`ALTER TABLE pending_certificates ADD COLUMN student_name TEXT`);
}
if (!pendingColumns.includes('course')) {
  db.exec(`ALTER TABLE pending_certificates ADD COLUMN course TEXT`);
}
if (!pendingColumns.includes('student_id')) {
  db.exec(`ALTER TABLE pending_certificates ADD COLUMN student_id TEXT`);
}

const { PDFParse } = require('pdf-parse');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function extractCertificateDetails(buffer) {
  let parser = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('SCAN TEXT:', text.slice(0, 800));

    let student_name = 'Unknown Student';
    let course = 'Unknown Course';

    let student_id = 'N/A';
    let platform = 'Global';
    let issue_date = new Date().toISOString().slice(0, 10);

    // 1. Extract Certificate ID (Prioritize simple format from Python script)
    const idMatch = text.match(/Certificate ID:\s*([A-Za-z0-9]+)/i) ||
      text.match(/(?:Certificate ID|Credential ID|ID|No|Number|Ref|Serial)[:\s]+([A-Za-z0-9-]+)/i);
    if (idMatch) student_id = idMatch[1];

    // 2. Extract Name and Course
    // Logic from reference Python scripts
    const pythonNameMatch = text.match(/Course completed by\s+([A-Za-z\s]{2,50}?[A-Za-z]+)(?=\s+on|\s+\.|\s+\d|$)/i);
    const pythonCourseMatch = text.match(/([A-Za-z\s]{2,100}?[A-Za-z]+)\s+Course completed by/i);

    if (pythonNameMatch) student_name = pythonNameMatch[1].trim();
    if (pythonCourseMatch) course = pythonCourseMatch[1].trim();

    // If both still unknown, try additional patterns for LinkedIn and fallback
    if (student_name === 'Unknown Student' || course === 'Unknown Course') {
      const patterns = [
        { regex: /This is to certify that\s+([A-Za-z\s]+?)\s+(?:has|successfully|completed)\s+/i, order: ['name'] },
        { regex: /Certificate of Completion\s+([A-Za-z0-9\s:-]+?)\s+Course completed by/i, order: ['course'] },
        { regex: /certify that\s+([A-Za-z\s]+?)\s+(?:has|successfully|completed)\s+.*?(?:course|program|certification)\s+(.*?)(?=\s+on|\s+at|$)/i, order: ['name', 'course'] },
        { regex: /([A-Za-z\s]+?)\s+(?:has )?(?:successfully )?completed\s+(?:the course|the program|the)?\s*(.*?)(?=\s+on|\s+at|\s+date|$)/i, order: ['name', 'course'] },
        { regex: /awarded to\s+([A-Za-z\s]+?)\s+(?:for|on|successfully|in)\s+(.*?)(?=\s+on|\s+at|\s+\d|$)/i, order: ['name', 'course'] }
      ];

      for (const p of patterns) {
        const m = text.match(p.regex);
        if (m) {
          if (student_name === 'Unknown Student' && p.order.includes('name')) {
            student_name = m[p.order.indexOf('name') + 1].trim();
          }
          if (course === 'Unknown Course' && p.order.includes('course')) {
            course = m[p.order.indexOf('course') + 1].trim();
          }
        }
      }
    }


    // 3. Extract Date (From Python script: Jan 01, 2026 format)
    const dateMatch = text.match(/([A-Za-z]{3}\s\d{1,2},\s\d{4})/i);
    if (dateMatch) {
      try {
        const d = new Date(dateMatch[1]);
        if (!isNaN(d.getTime())) {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          issue_date = `${year}-${month}-${day}`;
        }
      } catch (e) {
        console.error('Date parsing error:', e);
      }
    }

    // 4. Detect Platform (Handling spaced out text like "L i n k e d I n")
    const lowerText = text.toLowerCase();
    const cleanText = text.replace(/\s/g, '').toLowerCase();

    if (lowerText.includes('coursera') || cleanText.includes('coursera')) {
      platform = 'coursera';
    } else if (lowerText.includes('linkedin') || cleanText.includes('linkedin')) {
      platform = 'linkedin';
    }

    // Post-processing: Clean name if it accidentally caught the month
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (const m of months) {
      if (student_name.endsWith(' ' + m)) {
        student_name = student_name.slice(0, -(m.length + 1)).trim();
        break;
      }
    }

    return { student_name, course, student_id, platform, issue_date };
  } catch (err) {

    console.error('Extraction Error:', err);
    return { student_name: 'Unknown', course: 'Unknown', student_id: 'N/A', platform: 'Global', issue_date: new Date().toISOString().slice(0, 10) };
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (e) {
        console.error('Parser Destroy Error:', e);
      }
    }
  }
}



function getLatestBlock() {
  return db
    .prepare('SELECT * FROM blocks ORDER BY block_index DESC LIMIT 1')
    .get();
}

function calculateBlockHash(blockIndex, timestamp, dataJson, previousHash) {
  return sha256(`${blockIndex}|${timestamp}|${dataJson}|${previousHash}`);
}

function createGenesisBlockIfMissing() {
  const latest = getLatestBlock();
  if (latest) return;

  const blockIndex = 0;
  const timestamp = new Date().toISOString();
  const dataJson = JSON.stringify({ type: 'GENESIS' });
  const previousHash = '0';
  const currentHash = calculateBlockHash(
    blockIndex,
    timestamp,
    dataJson,
    previousHash,
  );

  db.prepare(
    `INSERT INTO blocks (block_index, timestamp, data_json, previous_hash, current_hash)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(blockIndex, timestamp, dataJson, previousHash, currentHash);
}

createGenesisBlockIfMissing();

function getSessionFromRequest(req) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  if (!token || !sessions.has(token)) {
    return null;
  }
  return sessions.get(token);
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(session.role)) {
      return res.status(403).json({ message: 'Insufficient role permissions.' });
    }
    req.auth = session;
    return next();
  };
}

function requireAdminRole(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  if (!['admin', 'main_admin'].includes(session.role)) {
    return res.status(403).json({ message: 'Admin role required.' });
  }
  req.auth = session;
  return next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'certificate-backend' });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const matchedUser = USERS.find(
    (user) => user.email === email && user.password === password,
  );
  if (!matchedUser) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    email: matchedUser.email,
    role: matchedUser.role,
    platform: matchedUser.platform,
    name: matchedUser.name,
  });
  return res.json({
    message: 'Login successful.',
    token,
    user: {
      email: matchedUser.email,
      role: matchedUser.role,
      platform: matchedUser.platform,
      name: matchedUser.name,
    },
  });
});

app.get('/api/auth/me', requireRole(['user', 'admin', 'main_admin']), (req, res) => {
  res.json({ user: req.auth });
});

app.post('/api/certificates/preview', upload.single('certificate_file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Certificate file is required.' });
  }
  const details = await extractCertificateDetails(file.buffer);
  return res.json({ details });
});

app.post('/api/certificates/fetch-link', async (req, res) => {
  const { url } = req.body || {};
  if (!url || (!url.includes('linkedin.com') && !url.includes('coursera.org'))) {
    return res.status(400).json({ message: 'Valid Certificate URL (LinkedIn/Coursera) is required.' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = response.data;

    let student_name = 'Unknown Student';
    let course = 'Unknown Course';
    let student_id = 'N/A';
    let platform = url.includes('linkedin') ? 'linkedin' : 'coursera';
    let issue_date = new Date().toISOString().slice(0, 10);

    // Extract ID from URL
    const idMatch = url.match(/(?:certificates|verify|credential)\/([a-zA-Z0-9-]+)/);
    if (idMatch) student_id = idMatch[1];

    if (platform === 'linkedin') {
      // LinkedIn Learning Specific Extraction

      // 1. Course from <title> or og:title
      const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/<meta property="og:title" content="(.*?)"/i);
      if (titleMatch) {
        const titleText = titleMatch[1];
        if (titleText.includes(':')) {
          course = titleText.split(':').pop().trim();
        } else if (titleText.includes('successfully completed')) {
          course = titleText.split('successfully completed').pop().trim();
        } else {
          course = titleText.trim();
        }
      }

      // 2. Student Name from og:title or description
      const ogTitle = html.match(/<meta property="og:title" content="(.*?)"/i);
      if (ogTitle && ogTitle[1].includes(' successfully completed ')) {
        student_name = ogTitle[1].split(' successfully completed ')[0].trim();
      } else {
        const metaDesc = html.match(/<meta name="description" content="(.*?)"/i) || html.match(/<meta property="og:description" content="(.*?)"/i);
        if (metaDesc) {
          const descMatch = metaDesc[1].match(/(.*?) has successfully completed/i);
          if (descMatch) student_name = descMatch[1].trim();
        }
      }
    } else {
      // Coursera Specific Extraction (Basic)
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch) course = titleMatch[1].replace(' | Coursera', '').trim();

      const nameMatch = html.match(/completed by (.*?)(?:\s+on|\s+\d|$)/i);
      if (nameMatch) student_name = nameMatch[1].trim();
    }

    // Clean up extracted data
    student_name = student_name.replace(/Certificate of Completion/gi, '').trim();
    if (course.length > 100) course = course.substring(0, 97) + '...';

    return res.json({
      details: {
        student_name,
        course,
        student_id,
        platform,
        issue_date,
      },
    });
  } catch (err) {
    console.error('Link Fetch Error:', err);
    return res.status(500).json({ message: 'Failed to fetch certificate data from link. It might be private or require login.' });
  }
});

app.post(
  '/api/certificates/upload',
  requireRole(['user', 'main_admin']),
  upload.single('certificate_file'),
  async (req, res) => {
    const { wallet_address, wallet_signature } = req.body || {};
    const file = req.file;

    if (!file || !wallet_address || !wallet_signature) {
      return res.status(400).json({
        message: 'certificate_file, wallet_address, wallet_signature are required.',
      });
    }

    const fileHash = sha256(file.buffer);
    const alreadyApproved = db
      .prepare('SELECT id FROM certificates WHERE cert_hash = ?')
      .get(fileHash);
    if (alreadyApproved) {
      return res.status(409).json({
        message: 'Certificate already approved.',
        certificate_id: alreadyApproved.id,
      });
    }

    const pending = db
      .prepare('SELECT id, status FROM pending_certificates WHERE file_hash = ?')
      .get(fileHash);
    if (pending) {
      return res.status(409).json({
        message: `Certificate already ${pending.status}.`,
        pending_id: pending.id,
      });
    }

    // Extract details from PDF
    const details = await extractCertificateDetails(file.buffer);
    const platform = details?.platform || 'linkedin';
    const student_id = details?.student_id || 'N/A';

    // Check for duplicate Certificate ID (student_id)
    if (student_id !== 'N/A') {
      const existingCertId = db
        .prepare('SELECT id FROM certificates WHERE student_id = ?')
        .get(student_id);
      if (existingCertId) {
        return res.status(409).json({
          message: `Duplicate Certificate: ID ${student_id} is already registered on the blockchain.`,
          certificate_id: existingCertId.id,
        });
      }

      const pendingCertId = db
        .prepare("SELECT id FROM pending_certificates WHERE student_id = ? AND status = 'pending'")
        .get(student_id);

      if (pendingCertId) {
        return res.status(409).json({
          message: `Duplicate Request: Certificate ID ${student_id} is already waiting for approval.`,
          pending_id: pendingCertId.id,
        });
      }
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO pending_certificates
      (source_file_name, file_hash, student_name, course, student_id, platform, wallet_address, wallet_signature, submitted_by, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        file.originalname,
        fileHash,
        details?.student_name || 'Unknown',
        details?.course || 'Unknown',
        details?.student_id || 'Unknown',
        platform,
        String(wallet_address).trim(),
        String(wallet_signature).trim(),
        req.auth.email,
        now,
        now,
      );

    return res.status(201).json({
      message: 'Certificate uploaded and details extracted.',
      pending_id: result.lastInsertRowid,
      file_hash: fileHash,
      extracted_details: details,
    });
  },
);

app.post('/api/certificates', requireRole(['main_admin']), (req, res) => {
  const {
    student_name,
    student_id,
    course,
    issue_date,
    platform,
    wallet_address,
    wallet_signature,
  } = req.body || {};

  if (!student_name || !student_id || !course || !issue_date || !platform || !wallet_address || !wallet_signature) {
    return res.status(400).json({
      message:
        'student_name, student_id, course, issue_date, platform, wallet_address, wallet_signature are required.',
    });
  }

  const normalizedPlatform = String(platform).trim().toLowerCase();
  if (!ALLOWED_PLATFORMS.has(normalizedPlatform)) {
    return res.status(400).json({
      message: 'Only LinkedIn and Coursera certificates are supported.',
    });
  }

  const certificateData = {
    student_name: String(student_name).trim(),
    student_id: String(student_id).trim(),
    course: String(course).trim(),
    issue_date: String(issue_date).trim(),
    platform: normalizedPlatform,
    wallet_address: String(wallet_address).trim(),
  };

  const certHash = sha256(JSON.stringify(certificateData));

  const existing = db
    .prepare('SELECT * FROM certificates WHERE cert_hash = ?')
    .get(certHash);

  if (existing) {
    return res.status(409).json({
      message: 'Certificate already exists.',
      certificate: existing,
    });
  }

  const latestBlock = getLatestBlock();
  const blockIndex = (latestBlock?.block_index ?? 0) + 1;
  const timestamp = new Date().toISOString();
  const dataJson = JSON.stringify({
    type: 'CERTIFICATE',
    cert_hash: certHash,
    ...certificateData,
  });
  const previousHash = latestBlock ? latestBlock.current_hash : '0';
  const currentHash = calculateBlockHash(
    blockIndex,
    timestamp,
    dataJson,
    previousHash,
  );

  const tx = db.transaction(() => {
    const blockResult = db
      .prepare(
        `INSERT INTO blocks (block_index, timestamp, data_json, previous_hash, current_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(blockIndex, timestamp, dataJson, previousHash, currentHash);

    const certResult = db
      .prepare(
        `INSERT INTO certificates (student_name, student_id, course, issue_date, platform, cert_hash, block_id, created_at, wallet_address, wallet_signature, submitted_by, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        certificateData.student_name,
        certificateData.student_id,
        certificateData.course,
        certificateData.issue_date,
        certificateData.platform,
        certHash,
        blockResult.lastInsertRowid,
        timestamp,
        certificateData.wallet_address,
        String(wallet_signature).trim(),
        req.auth.email,
        req.auth.email,
      );

    return {
      certificateId: certResult.lastInsertRowid,
      blockId: blockResult.lastInsertRowid,
    };
  });

  const created = tx();

  return res.status(201).json({
    message: 'Certificate added to blockchain successfully.',
    certificate_id: created.certificateId,
    cert_hash: certHash,
    block_id: created.blockId,
  });
});

app.post('/api/verify', (req, res) => {
  const { certificate_id, cert_hash } = req.body || {};

  if (!certificate_id && !cert_hash) {
    return res.status(400).json({
      message: 'Provide certificate_id or cert_hash.',
    });
  }

  let certificate;
  if (certificate_id) {
    const searchId = String(certificate_id).trim();
    // Try primary key first if it looks like a number
    if (/^\d+$/.test(searchId)) {
      certificate = db
        .prepare('SELECT * FROM certificates WHERE id = ?')
        .get(Number(searchId));
    }

    // If not found by PK, search by student_id (the one from PDF)
    if (!certificate) {
      certificate = db
        .prepare('SELECT * FROM certificates WHERE student_id = ?')
        .get(searchId);
    }
  } else if (cert_hash) {
    certificate = db
      .prepare('SELECT * FROM certificates WHERE cert_hash = ?')
      .get(String(cert_hash).trim());
  }


  if (!certificate) {
    return res.status(404).json({
      valid: false,
      message: 'Certificate not found.',
    });
  }

  const certificatePlatform = String(certificate.platform || '')
    .trim()
    .toLowerCase();
  if (!ALLOWED_PLATFORMS.has(certificatePlatform)) {
    return res.status(400).json({
      valid: false,
      message: 'Only LinkedIn and Coursera certificates can be verified.',
    });
  }

  const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(certificate.block_id);
  if (!block) {
    return res.status(500).json({
      valid: false,
      message: 'Linked blockchain block missing.',
    });
  }

  return res.json({
    valid: true,
    message: 'Certificate is valid.',
    certificate,
    block,
  });
});

app.get('/api/certificates', requireRole(['user', 'admin', 'main_admin']), (req, res) => {
  let certificates;
  const baseSelect = `SELECT id, student_name, student_id, course, issue_date, platform, cert_hash,
       wallet_address, source_file_name, submitted_by, approved_by, created_at
       FROM certificates`;

  if (req.auth.role === 'main_admin') {
    certificates = db.prepare(`${baseSelect} ORDER BY id DESC`).all();
  } else if (req.auth.role === 'admin') {
    certificates = db
      .prepare(`${baseSelect} WHERE platform = ? ORDER BY id DESC`)
      .all(req.auth.platform);
  } else {
    certificates = db
      .prepare(`${baseSelect} WHERE submitted_by = ? ORDER BY id DESC`)
      .all(req.auth.email);
  }

  res.json({ certificates });
});

app.get('/api/panel/summary', requireRole(['user', 'admin', 'main_admin']), (req, res) => {
  const auth = req.auth;
  const whereForAdmin =
    auth.role === 'admin' ? 'WHERE platform = ?' : auth.role === 'user' ? 'WHERE submitted_by = ?' : '';
  const param = auth.role === 'admin' ? auth.platform : auth.role === 'user' ? auth.email : undefined;

  const certSql = `SELECT COUNT(*) AS total FROM certificates ${whereForAdmin}`;
  const pendingSql = `SELECT status, COUNT(*) AS total FROM pending_certificates ${whereForAdmin} GROUP BY status`;

  const certificateCount =
    param === undefined
      ? db.prepare(certSql).get().total
      : db.prepare(certSql).get(param).total;
  const pendingRows =
    param === undefined
      ? db.prepare(pendingSql).all()
      : db.prepare(pendingSql).all(param);

  const pendingByStatus = pendingRows.reduce(
    (result, row) => ({ ...result, [row.status]: row.total }),
    { pending: 0, approved: 0, rejected: 0 },
  );

  res.json({
    user: auth,
    certificates: certificateCount,
    requests: pendingByStatus,
  });
});

app.get('/api/admin/pending-certificates', requireAdminRole, (req, res) => {
  const auth = req.auth;
  let pending;
  if (auth.role === 'admin') {
    pending = db
      .prepare(
        `SELECT id, source_file_name, student_name, course, student_id, file_hash, platform, wallet_address, submitted_by, status, rejection_reason, created_at, updated_at
         FROM pending_certificates
         WHERE platform = ?
         ORDER BY id DESC`,
      )
      .all(auth.platform);
  } else {
    pending = db
      .prepare(
        `SELECT id, source_file_name, student_name, course, student_id, file_hash, platform, wallet_address, submitted_by, status, rejection_reason, created_at, updated_at
         FROM pending_certificates
         ORDER BY id DESC`,
      )
      .all();
  }
  res.json({ pending });
});

app.post('/api/admin/certificates/:id/approve', requireAdminRole, (req, res) => {
  const pendingId = Number(req.params.id);
  if (!pendingId) {
    return res.status(400).json({ message: 'Invalid pending certificate id.' });
  }

  const pending = db
    .prepare('SELECT * FROM pending_certificates WHERE id = ?')
    .get(pendingId);
  if (!pending) {
    return res.status(404).json({ message: 'Pending certificate not found.' });
  }
  if (pending.status !== 'pending') {
    return res.status(400).json({ message: `Certificate is already ${pending.status}.` });
  }
  if (req.auth.role === 'admin' && req.auth.platform !== pending.platform) {
    return res
      .status(403)
      .json({ message: 'This admin can only approve own platform certificates.' });
  }

  const now = new Date().toISOString();
  const latestBlock = getLatestBlock();
  const blockIndex = (latestBlock?.block_index ?? 0) + 1;
  const dataJson = JSON.stringify({
    type: 'CERTIFICATE',
    cert_hash: pending.file_hash,
    student_name: pending.student_name,
    course: pending.course,
    student_id: pending.student_id,
    source_file_name: pending.source_file_name,
    platform: pending.platform,
    wallet_address: pending.wallet_address,
    approved_at: now,
  });
  const previousHash = latestBlock ? latestBlock.current_hash : '0';
  const currentHash = calculateBlockHash(blockIndex, now, dataJson, previousHash);

  const tx = db.transaction(() => {
    const blockResult = db
      .prepare(
        `INSERT INTO blocks (block_index, timestamp, data_json, previous_hash, current_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(blockIndex, now, dataJson, previousHash, currentHash);

    const certResult = db
      .prepare(
        `INSERT INTO certificates (student_name, student_id, course, issue_date, platform, cert_hash, block_id, created_at, wallet_address, wallet_signature, source_file_name, submitted_by, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pending.student_name || 'Unknown',
        pending.student_id || `UPL-${pending.id}`,
        pending.course || 'Uploaded Certificate',
        now.slice(0, 10),
        pending.platform,
        pending.file_hash,
        blockResult.lastInsertRowid,
        now,
        pending.wallet_address,
        pending.wallet_signature,
        pending.source_file_name,
        pending.submitted_by,
        req.auth.email,
      );

    db.prepare(
      `UPDATE pending_certificates
       SET status = 'approved', updated_at = ?
       WHERE id = ?`,
    ).run(now, pending.id);

    return {
      certificateId: certResult.lastInsertRowid,
      blockId: blockResult.lastInsertRowid,
    };
  });

  const created = tx();
  return res.json({
    message: 'Certificate approved successfully.',
    certificate_id: created.certificateId,
    block_id: created.blockId,
  });
});

app.post('/api/admin/certificates/:id/reject', requireAdminRole, (req, res) => {
  const pendingId = Number(req.params.id);
  const reason = String(req.body?.reason ?? 'Rejected by admin').trim();
  if (!pendingId) {
    return res.status(400).json({ message: 'Invalid pending certificate id.' });
  }

  const pending = db
    .prepare('SELECT * FROM pending_certificates WHERE id = ?')
    .get(pendingId);
  if (!pending) {
    return res.status(404).json({ message: 'Pending certificate not found.' });
  }
  if (pending.status !== 'pending') {
    return res.status(400).json({ message: `Certificate is already ${pending.status}.` });
  }
  if (req.auth.role === 'admin' && req.auth.platform !== pending.platform) {
    return res
      .status(403)
      .json({ message: 'This admin can only reject own platform certificates.' });
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE pending_certificates
     SET status = 'rejected', rejection_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).run(reason, now, pendingId);

  return res.json({ message: 'Certificate rejected successfully.' });
});

app.get('/api/blockchain', (_req, res) => {
  const chain = db.prepare('SELECT * FROM blocks ORDER BY block_index ASC').all();
  res.json({ blocks: chain });
});

app.get('/api/blockchain/validate', (_req, res) => {
  const chain = db.prepare('SELECT * FROM blocks ORDER BY block_index ASC').all();

  for (let i = 0; i < chain.length; i += 1) {
    const block = chain[i];
    const expectedHash = calculateBlockHash(
      block.block_index,
      block.timestamp,
      block.data_json,
      block.previous_hash,
    );
    if (block.current_hash !== expectedHash) {
      return res.json({
        valid: false,
        message: `Block ${block.block_index} hash mismatch.`,
      });
    }

    if (i > 0) {
      const previous = chain[i - 1];
      if (block.previous_hash !== previous.current_hash) {
        return res.json({
          valid: false,
          message: `Block ${block.block_index} previous hash mismatch.`,
        });
      }
    }
  }

  return res.json({ valid: true, message: 'Blockchain is valid.' });
});

app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

app.listen(PORT, () => {
  console.log(`Backend API running at http://localhost:${PORT}`);
});
