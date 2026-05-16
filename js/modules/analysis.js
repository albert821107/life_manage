'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const DOCS_DIR = path.resolve(__dirname, '../../data/docs');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

function safeName(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200);
}

module.exports = (io) => {
  const router = express.Router();

  // GET /api/analysis/files — 列出 data/docs/ 下所有檔案
  router.get('/files', (req, res) => {
    try {
      const entries = fs.readdirSync(DOCS_DIR).map(name => {
        const fullPath = path.join(DOCS_DIR, name);
        const stat = fs.statSync(fullPath);
        return { name, size: stat.size, created_at: stat.birthtime.toISOString().replace('T',' ').slice(0,16) };
      }).sort((a, b) => b.created_at.localeCompare(a.created_at));
      res.json({ success: true, data: entries });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/analysis/upload — 接收 base64，寫入 data/docs/
  router.post('/upload', (req, res) => {
    try {
      const { filename, dataB64 } = req.body;
      if (!filename || !dataB64) return res.json({ success: false, error: '缺少 filename 或 dataB64' });
      const safe = safeName(filename);
      const dest = path.join(DOCS_DIR, safe);
      fs.writeFileSync(dest, Buffer.from(dataB64, 'base64'));
      res.json({ success: true, saved: safe });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/analysis/file/:name — 讀取檔案內容（base64）
  router.get('/file/:name', (req, res) => {
    try {
      const safe = safeName(req.params.name);
      const fullPath = path.join(DOCS_DIR, safe);
      if (!fullPath.startsWith(DOCS_DIR)) return res.json({ success: false, error: '路徑不合法' });
      if (!fs.existsSync(fullPath)) return res.json({ success: false, error: '找不到檔案' });
      const buf = fs.readFileSync(fullPath);
      res.json({ success: true, data: { name: safe, dataB64: buf.toString('base64') } });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // DELETE /api/analysis/files — 批次刪除 body: { names: [...] }
  router.delete('/files', (req, res) => {
    try {
      const { names } = req.body;
      if (!Array.isArray(names) || !names.length) return res.json({ success: false, error: '請提供 names 陣列' });
      let deleted = 0;
      names.forEach(n => {
        const safe = safeName(n);
        const p = path.join(DOCS_DIR, safe);
        if (p.startsWith(DOCS_DIR) && fs.existsSync(p)) { fs.unlinkSync(p); deleted++; }
      });
      res.json({ success: true, deleted });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};
