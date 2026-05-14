'use strict';

const express = require('express');
const axios   = require('axios');

/**
 * LINE Notify 模組
 * 取得 Token: https://notify-bot.line.me/zh_TW/
 */

const LINE_NOTIFY_URL = 'https://notify-api.line.me/api/notify';

/** 發送 LINE 通知 (standalone，可由 server.js cron 呼叫) */
async function sendLineNotification(message) {
  const token = process.env.LINE_NOTIFY_TOKEN;
  if (!token || token.includes('your-line-notify-token')) {
    throw new Error('LINE_NOTIFY_TOKEN 未設定，請在 .env 填入 token');
  }
  const resp = await axios.post(
    LINE_NOTIFY_URL,
    new URLSearchParams({ message }).toString(),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    }
  );
  return resp.data;
}

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/line/status
  router.get('/status', (req, res) => {
    const token = process.env.LINE_NOTIFY_TOKEN;
    const configured = !!(token && !token.includes('your-line-notify-token'));
    res.json({ success: true, data: { configured } });
  });

  // GET /api/line/history
  router.get('/history', (req, res) => {
    const rows = db.prepare(`SELECT * FROM line_notifications ORDER BY id DESC LIMIT 100`).all();
    res.json({ success: true, data: rows });
  });

  // POST /api/line/notify - 自訂訊息
  router.post('/notify', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: '請填寫通知訊息' });
    try {
      await sendLineNotification(message);
      db.prepare(`INSERT INTO line_notifications (message, status) VALUES (?, 'sent')`).run(message);
      io.emit('line:update');
      res.json({ success: true, message: '通知已發送' });
    } catch (err) {
      db.prepare(`INSERT INTO line_notifications (message, status) VALUES (?, 'failed')`).run(message);
      io.emit('line:update');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/line/notify/summary - 發送今日摘要
  router.post('/notify/summary', async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const income   = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='income'  AND date LIKE ?`).get(`${month}%`);
    const expense  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='expense' AND date LIKE ?`).get(`${month}%`);
    const pending  = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status='pending'`).get();
    const dueSoon  = db.prepare(`SELECT title FROM tasks WHERE status!='done' AND due_date BETWEEN date('now') AND date('now','+3 days') LIMIT 3`).all();
    const fitness  = db.prepare(`SELECT COUNT(*) AS c FROM fitness WHERE date >= date('now','-6 days')`).get();

    const msg = [
      `\n📊 生活管理日報 ${today}`,
      `💰 本月收入 $${income.t} | 支出 $${expense.t} | 結餘 $${(income.t-expense.t).toFixed(0)}`,
      `✅ 待辦任務 ${pending.c} 件`,
      dueSoon.length ? `⚠️  即將到期：${dueSoon.map(t => t.title).join('、')}` : '',
      `💪 本週運動 ${fitness.c} 次`
    ].filter(Boolean).join('\n');

    try {
      await sendLineNotification(msg);
      db.prepare(`INSERT INTO line_notifications (message, status) VALUES (?, 'sent')`).run(msg);
      io.emit('line:update');
      res.json({ success: true, message: '日報已發送' });
    } catch (err) {
      db.prepare(`INSERT INTO line_notifications (message, status) VALUES (?, 'failed')`).run(msg);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return { router, sendLineNotification };
};
