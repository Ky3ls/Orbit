/**
 * Backup-Orchestrierung + Multipart-Upload-Hilfe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServerBackup, SERVER_BACKUP_CONTENTS } from './serverBackup.js';
import { createDatabaseBackup } from './databaseBackup.js';
import {
  assertBackupType,
  backupId,
  deleteBackup,
  enforceRetention,
  listBackups,
  MAX_UPLOAD_BYTES,
  normalizeRetention,
  parseBackupId,
  resolveBackupPath,
  sanitizeBackupBasename,
  typeDir,
  BACKUP_TYPES,
  RETENTION_OPTIONS,
  DEFAULT_RETENTION,
} from './store.js';

export {
  BACKUP_TYPES,
  RETENTION_OPTIONS,
  DEFAULT_RETENTION,
  MAX_UPLOAD_BYTES,
  SERVER_BACKUP_CONTENTS,
  assertBackupType,
  normalizeRetention,
  listBackups,
  deleteBackup,
  parseBackupId,
  backupId,
};

let running = null;

export function backupBusy() {
  return Boolean(running);
}

/**
 * @param {'server'|'database'} type
 * @param {{ settings: Record<string,string>, retention?: number }} opts
 */
export async function runBackup(type, opts = {}) {
  const t = assertBackupType(type);
  if (running) throw new Error(`Backup läuft bereits (${running}).`);
  running = t;
  try {
    if (t === 'server') return await createServerBackup(opts);
    return await createDatabaseBackup(opts);
  } finally {
    running = null;
  }
}

/**
 * Multipart (eine Datei) oder Raw-Body speichern.
 * @returns {Promise<{ type: string, name: string, id: string, size: number }>}
 */
export async function saveUploadedBackup(req, type, retention) {
  const t = assertBackupType(type);
  const keep = normalizeRetention(retention);
  typeDir(t);

  const ct = String(req.headers['content-type'] || '');
  let filename;
  let buffer;

  if (/multipart\/form-data/i.test(ct)) {
    const parsed = await parseMultipartFile(req, MAX_UPLOAD_BYTES);
    filename = parsed.filename;
    buffer = parsed.buffer;
    const formType = parsed.fields.type;
    if (formType) assertBackupType(formType);
  } else {
    const hint = String(req.headers['x-orbit-filename'] || req.headers['x-filename'] || '');
    filename = hint || defaultUploadName(t);
    buffer = await readRawBody(req, MAX_UPLOAD_BYTES);
  }

  if (!buffer?.length) throw new Error('Leerer Upload.');
  const safe = ensureUploadName(filename, t);
  const dest = resolveBackupPath(t, safe);
  fs.writeFileSync(dest, buffer, { mode: 0o600 });
  enforceRetention(t, keep);
  const st = fs.statSync(dest);
  return {
    id: backupId(t, safe),
    type: t,
    name: safe,
    size: st.size,
    created: Math.floor(st.mtimeMs),
  };
}

function defaultUploadName(type) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return type === 'database' ? `database-upload-${stamp}.sql.gz` : `server-upload-${stamp}.tar.gz`;
}

function ensureUploadName(name, type) {
  let base = path.basename(String(name || '').trim()) || defaultUploadName(type);
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base || base === '.' || base === '..') base = defaultUploadName(type);
  try {
    return sanitizeBackupBasename(base, type);
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const forced = type === 'database'
      ? `database-upload-${stamp}.sql.gz`
      : `server-upload-${stamp}.tar.gz`;
    return sanitizeBackupBasename(forced, type);
  }
}

function readRawBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error('Upload zu groß.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Minimaler Multipart-Parser für ein File-Feld (+ optionale Textfelder). */
function parseMultipartFile(req, max) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!m) {
      reject(Object.assign(new Error('Multipart-Boundary fehlt.'), { status: 400 }));
      return;
    }
    const boundary = Buffer.from(`--${(m[1] || m[2]).trim()}`);
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max + 64 * 1024) {
        reject(Object.assign(new Error('Upload zu groß.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(extractMultipart(Buffer.concat(chunks), boundary));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function extractMultipart(buf, boundary) {
  const fields = {};
  let filename = '';
  let fileBuf = null;
  let start = 0;

  while (start < buf.length) {
    const bIdx = indexOf(buf, boundary, start);
    if (bIdx < 0) break;
    let partStart = bIdx + boundary.length;
    if (buf[partStart] === 45 && buf[partStart + 1] === 45) break; // --
    if (buf[partStart] === 13 && buf[partStart + 1] === 10) partStart += 2;
    else if (buf[partStart] === 10) partStart += 1;

    const next = indexOf(buf, boundary, partStart);
    const partEnd = next < 0 ? buf.length : next;
    let part = buf.subarray(partStart, partEnd);
    // trailing CRLF vor Boundary entfernen
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2);
    } else if (part.length >= 1 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 1);
    }

    const headerEnd = findHeaderEnd(part);
    if (headerEnd < 0) {
      start = partEnd;
      continue;
    }
    const header = part.subarray(0, headerEnd).toString('utf8');
    const sepLen = part[headerEnd] === 13 ? 4 : 2; // \r\n\r\n oder \n\n
    const body = part.subarray(headerEnd + sepLen);

    const nameMatch = /name="([^"]+)"/i.exec(header);
    const fileMatch = /filename="([^"]*)"/i.exec(header);
    const name = nameMatch ? nameMatch[1] : '';
    if (fileMatch) {
      filename = path.basename(fileMatch[1] || '') || filename;
      fileBuf = Buffer.from(body);
    } else if (name) {
      fields[name] = body.toString('utf8').trim();
    }
    start = partEnd;
  }

  if (!fileBuf) throw Object.assign(new Error('Keine Datei im Upload.'), { status: 400 });
  return { filename, buffer: fileBuf, fields };
}

function indexOf(buf, needle, from = 0) {
  return buf.indexOf(needle, from);
}

function findHeaderEnd(part) {
  const crlf = part.indexOf(Buffer.from('\r\n\r\n'));
  if (crlf >= 0) return crlf;
  const lf = part.indexOf(Buffer.from('\n\n'));
  return lf;
}
