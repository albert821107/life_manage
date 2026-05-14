'use strict';

const express = require('express');
const axios   = require('axios');

const TELEGRAM_API = 'https://api.telegram.org';

/** 發送 Telegram 訊息 (standalone，可由 server.js cron 呼叫) */
async function sendTelegramNotification(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || token.includes('your-telegram-bot-token')) {
    throw new Error('TELEGRAM_BOT_TOKEN 未設定，請在 .env 填入 token');
  }
  if (!chatId || chatId.includes('your-chat-id')) {
    throw new Error('TELEGRAM_CHAT_ID 未設定，請在 .env 填入 chat id');
  }
  const resp = await axios.post(
    `${TELEGRAM_API}/bot${token}/sendMessage`,
    { chat_id: chatId, text: message },
    { timeout: 10000 }
  );
  return resp.data;
}

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/telegram/status
  router.get('/status', (req, res) => {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const configured = !!(
      token  && !token.includes('your-telegram-bot-token') &&
      chatId && !chatId.includes('your-chat-id')
    );
    res.json({ success: true, data: { configured } });
  });

  // GET /api/telegram/history
  router.get('/history', (req, res) => {
    const rows = db.prepare(`SELECT * FROM telegram_notifications ORDER BY id DESC LIMIT 100`).all();
    res.json({ success: true, data: rows });
  });

  // POST /api/telegram/notify - 自訂訊息
  router.post('/notify', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: '請填寫通知訊息' });
    try {
      await sendTelegramNotification(message);
      db.prepare(`INSERT INTO telegram_notifications (message, status) VALUES (?, 'sent')`).run(message);
      io.emit('telegram:update');
      res.json({ success: true, message: '通知已發送' });
    } catch (err) {
      db.prepare(`INSERT INTO telegram_notifications (message, status) VALUES (?, 'failed')`).run(message);
      io.emit('telegram:update');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/telegram/notify/summary - 發送今日摘要
  router.post('/notify/summary', async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const income  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='income'  AND date LIKE ?`).get(`${month}%`);
    const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='expense' AND date LIKE ?`).get(`${month}%`);
    const pending = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status='pending'`).get();
    const dueSoon = db.prepare(`SELECT title FROM tasks WHERE status!='done' AND due_date BETWEEN date('now') AND date('now','+3 days') LIMIT 3`).all();
    const fitness = db.prepare(`SELECT COUNT(*) AS c FROM fitness WHERE date >= date('now','-6 days')`).get();

    const msg = [
      `📊 生活管理日報 ${today}`,
      `💰 本月收入 $${income.t} | 支出 $${expense.t} | 結餘 $${(income.t - expense.t).toFixed(0)}`,
      `✅ 待辦任務 ${pending.c} 件`,
      dueSoon.length ? `⚠️ 即將到期：${dueSoon.map(t => t.title).join('、')}` : '',
      `💪 本週運動 ${fitness.c} 次`
    ].filter(Boolean).join('\n');

    try {
      await sendTelegramNotification(msg);
      db.prepare(`INSERT INTO telegram_notifications (message, status) VALUES (?, 'sent')`).run(msg);
      io.emit('telegram:update');
      res.json({ success: true, message: '日報已發送' });
    } catch (err) {
      db.prepare(`INSERT INTO telegram_notifications (message, status) VALUES (?, 'failed')`).run(msg);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return { router, sendTelegramNotification };
};
