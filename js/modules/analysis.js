'use strict';

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const hex = process.env.ENCRYPT_KEY || '';
  if (hex.length < 64) throw new Error('ENCRYPT_KEY 未設定或長度不足（需 64 個十六進制字元 = 32 bytes）');
  return Buffer.from(hex.slice(0, 64), 'hex');
}

function encrypt(plaintext) {
  const key = getKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encrypted: enc.toString('base64'),
    iv:        iv.toString('base64'),
    authTag:   cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(encB64, ivB64, authTagB64) {
  const key      = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/analysis/files
  router.get('/files', (req, res) => {
    try {
      const rows = db.prepare(
        'SELECT id, filename, mime_type, size_bytes, is_binary, created_at FROM encrypted_files ORDER BY created_at DESC'
      ).all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/analysis/upload  (body: { filename, mimeType, dataB64 })
  router.post('/upload', (req, res) => {
    try {
      if (!process.env.ENCRYPT_KEY) return res.json({ success: false, error: '伺服器未設定 ENCRYPT_KEY，請聯絡管理員' });
      const { filename, mimeType = 'application/octet-stream', dataB64 } = req.body;
      if (!filename || !dataB64) return res.json({ success: false, error: '缺少 filename 或 dataB64' });

      const isText   = /^text\/|\/json$|\/xml$|\/markdown/.test(mimeType);
      const sizeBytes = Buffer.from(dataB64, 'base64').length;
      const { encrypted, iv, authTag } = encrypt(dataB64);

      db.prepare(
        'INSERT INTO encrypted_files (filename, mime_type, size_bytes, content_encrypted, iv, auth_tag, is_binary) VALUES (?,?,?,?,?,?,?)'
      ).run(filename, mimeType, sizeBytes, encrypted, iv, authTag, isText ? 0 : 1);

      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/analysis/file/:id  → decrypt & return dataB64
  router.get('/file/:id', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM encrypted_files WHERE id=?').get(req.params.id);
      if (!row) return res.json({ success: false, error: '找不到檔案' });
      const dataB64 = decrypt(row.content_encrypted, row.iv, row.auth_tag);
      res.json({ success: true, data: { filename: row.filename, mimeType: row.mime_type, dataB64, isBinary: row.is_binary } });
    } catch(e) { res.json({ success: false, error: `解密失敗：${e.message}` }); }
  });

  // DELETE /api/analysis/file/:id
  router.delete('/file/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM encrypted_files WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/analysis/key-status
  router.get('/key-status', (req, res) => {
    res.json({ configured: !!(process.env.ENCRYPT_KEY && process.env.ENCRYPT_KEY.length >= 64) });
  });

  return router;
};
