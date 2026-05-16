'use strict';

const express = require('express');
const axios   = require('axios');

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/work/jira/config — 取得目前 Jira 設定（不回傳 token）
  router.get('/jira/config', (req, res) => {
    try {
      const cfg = db.prepare('SELECT base_url, email, updated_at FROM work_jira_config ORDER BY id DESC LIMIT 1').get();
      res.json({ success: true, data: cfg || null });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/work/jira/config — 儲存 Jira 設定
  router.post('/jira/config', (req, res) => {
    try {
      const { base_url, email, api_token } = req.body;
      if (!base_url || !email || !api_token) return res.json({ success: false, error: '請填寫完整設定' });
      const clean = base_url.replace(/\/+$/, '');
      db.prepare('DELETE FROM work_jira_config').run();
      db.prepare('INSERT INTO work_jira_config (base_url, email, api_token) VALUES (?,?,?)').run(clean, email, api_token);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/work/jira/issues?jql=...&maxResults=50 — 搜尋工單
  router.get('/jira/issues', async (req, res) => {
    try {
      const cfg = db.prepare('SELECT base_url, email, api_token FROM work_jira_config ORDER BY id DESC LIMIT 1').get();
      if (!cfg) return res.json({ success: false, error: '尚未設定 Jira 連線資訊' });
      const jql = req.query.jql || 'assignee = currentUser() ORDER BY updated DESC';
      const maxResults = Math.min(parseInt(req.query.maxResults) || 50, 100);
      const token = Buffer.from(`${cfg.email}:${cfg.api_token}`).toString('base64');
      const resp = await axios.get(`${cfg.base_url}/rest/api/3/search`, {
        params: { jql, maxResults, fields: 'summary,status,priority,assignee,updated,issuetype,project' },
        headers: { 'Authorization': `Basic ${token}`, 'Accept': 'application/json' },
        timeout: 15000,
      });
      res.json({ success: true, data: resp.data });
    } catch(e) {
      const status = e.response?.status;
      const msg = status === 401 ? '認證失敗，請檢查 Email / API Token'
        : status === 403 ? '無存取權限'
        : status === 400 ? `JQL 語法錯誤：${e.response?.data?.errorMessages?.join(', ') || e.message}`
        : `無法連線：${e.message}`;
      res.json({ success: false, error: msg });
    }
  });

  // GET /api/work/jira/issue/:key — 取得單一工單詳情
  router.get('/jira/issue/:key', async (req, res) => {
    try {
      const cfg = db.prepare('SELECT base_url, email, api_token FROM work_jira_config ORDER BY id DESC LIMIT 1').get();
      if (!cfg) return res.json({ success: false, error: '尚未設定 Jira 連線資訊' });
      const token = Buffer.from(`${cfg.email}:${cfg.api_token}`).toString('base64');
      const resp = await axios.get(`${cfg.base_url}/rest/api/3/issue/${req.params.key}`, {
        headers: { 'Authorization': `Basic ${token}`, 'Accept': 'application/json' },
        timeout: 15000,
      });
      res.json({ success: true, data: resp.data });
    } catch(e) {
      res.json({ success: false, error: `無法取得工單：${e.message}` });
    }
  });

  return router;
};
