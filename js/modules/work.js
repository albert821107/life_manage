'use strict';

const express = require('express');
const axios   = require('axios');

// 依 base_url 自動選擇 API 版本
// atlassian.net → Cloud → API v3；其他私有實例 → API v2
function apiPath(baseUrl, path) {
  const isCloud = /\.atlassian\.net/i.test(baseUrl);
  const version = isCloud ? '3' : '2';
  return `${baseUrl}/rest/api/${version}${path}`;
}

// 建立 Authorization header：
//   - PAT 模式：帳號留空，token 欄填入 PAT → Bearer
//   - Basic 模式：帳號 + 密碼/token → Basic base64
function buildAuthHeader(email, token) {
  if (!email || !email.trim()) {
    return `Bearer ${token}`;
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/work/jira/config
  router.get('/jira/config', (req, res) => {
    try {
      const cfg = db.prepare('SELECT base_url, email, auth_type, updated_at FROM work_jira_config ORDER BY id DESC LIMIT 1').get();
      res.json({ success: true, data: cfg || null });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/work/jira/config
  router.post('/jira/config', (req, res) => {
    try {
      const { base_url, email = '', api_token } = req.body;
      if (!base_url || !api_token) return res.json({ success: false, error: '請填寫 Jira 網域與 Token' });
      const clean    = base_url.replace(/\/+$/, '');
      const authType = email.trim() ? 'basic' : 'pat';
      db.prepare('DELETE FROM work_jira_config').run();
      db.prepare('INSERT INTO work_jira_config (base_url, email, api_token) VALUES (?,?,?)').run(clean, email.trim(), api_token);
      res.json({ success: true, authType });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/work/jira/issues?jql=...&maxResults=50
  router.get('/jira/issues', async (req, res) => {
    try {
      const cfg = db.prepare('SELECT base_url, email, api_token FROM work_jira_config ORDER BY id DESC LIMIT 1').get();
      if (!cfg) return res.json({ success: false, error: '尚未設定 Jira 連線資訊' });

      const jql        = req.query.jql || 'assignee = currentUser() ORDER BY updated DESC';
      const maxResults = Math.min(parseInt(req.query.maxResults) || 50, 100);
      const isCloud    = /\.atlassian\.net/i.test(cfg.base_url);
      const fields     = 'summary,status,priority,assignee,updated,issuetype,project';

      const resp = await axios.get(apiPath(cfg.base_url, '/search'), {
        params: { jql, maxResults, fields },
        headers: { Authorization: buildAuthHeader(cfg.email, cfg.api_token), Accept: 'application/json' },
        timeout: 15000,
      });

      // 統一 Cloud v3 與 Server v2 的 status 名稱格式
      const issues = (resp.data.issues || []).map(issue => {
        const st = issue.fields?.status;
        if (st && typeof st === 'object') {
          issue.fields.status = { name: st.name || st.id || '未知', ...st };
        }
        return issue;
      });

      res.json({ success: true, data: { ...resp.data, issues }, isCloud });
    } catch(e) {
      const status = e.response?.status;
      const msg = status === 401 ? '認證失敗，請檢查帳號/Token 是否正確'
        : status === 403 ? '無存取權限（403）'
        : status === 400 ? `JQL 語法錯誤：${e.response?.data?.errorMessages?.join(', ') || e.message}`
        : `無法連線：${e.message}`;
      res.json({ success: false, error: msg });
    }
  });

  // GET /api/work/jira/issue/:key
  router.get('/jira/issue/:key', async (req, res) => {
    try {
      const cfg = db.prepare('SELECT base_url, email, api_token FROM work_jira_config ORDER BY id DESC LIMIT 1').get();
      if (!cfg) return res.json({ success: false, error: '尚未設定 Jira 連線資訊' });
      const resp = await axios.get(apiPath(cfg.base_url, `/issue/${req.params.key}`), {
        headers: { Authorization: buildAuthHeader(cfg.email, cfg.api_token), Accept: 'application/json' },
        timeout: 15000,
      });
      res.json({ success: true, data: resp.data });
    } catch(e) {
      res.json({ success: false, error: `無法取得工單：${e.message}` });
    }
  });

  // ── 帳密設定 CRUD ─────────────────────────────

  // GET /api/work/credentials
  router.get('/credentials', (req, res) => {
    try {
      const rows = db.prepare('SELECT id, category, name, username, password, url, note, created_at FROM work_credentials ORDER BY category, name').all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/work/credentials
  router.post('/credentials', (req, res) => {
    try {
      const { category = '其他', name, username = '', password = '', url = '', note = '' } = req.body;
      if (!name) return res.json({ success: false, error: '請填寫名稱' });
      const r = db.prepare(`INSERT INTO work_credentials (category, name, username, password, url, note) VALUES (?,?,?,?,?,?)`).run(category, name, username, password, url, note);
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // PUT /api/work/credentials/:id
  router.put('/credentials/:id', (req, res) => {
    try {
      const { category = '其他', name, username = '', password = '', url = '', note = '' } = req.body;
      if (!name) return res.json({ success: false, error: '請填寫名稱' });
      db.prepare(`UPDATE work_credentials SET category=?,name=?,username=?,password=?,url=?,note=?,updated_at=datetime('now','localtime') WHERE id=?`).run(category, name, username, password, url, note, req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // DELETE /api/work/credentials/:id
  router.delete('/credentials/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM work_credentials WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};
