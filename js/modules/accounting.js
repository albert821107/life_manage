'use strict';

const express = require('express');

/**
 * 記帳模組 - 收支管理
 */
module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/accounting?month=YYYY-MM
  router.get('/', (req, res) => {
    const { month } = req.query;
    const rows = month
      ? db.prepare(`SELECT * FROM accounting WHERE date LIKE ? ORDER BY date DESC, id DESC`).all(`${month}%`)
      : db.prepare(`SELECT * FROM accounting ORDER BY date DESC, id DESC LIMIT 300`).all();
    res.json({ success: true, data: rows });
  });

  // GET /api/accounting/summary?month=YYYY-MM
  router.get('/summary', (req, res) => {
    const m = req.query.month || new Date().toISOString().slice(0, 7);
    const income  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='income'  AND date LIKE ?`).get(`${m}%`);
    const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='expense' AND date LIKE ?`).get(`${m}%`);
    const byCategory = db.prepare(
      `SELECT category, type, ROUND(SUM(amount),2) AS total
       FROM accounting WHERE date LIKE ? GROUP BY category, type ORDER BY total DESC`
    ).all(`${m}%`);
    res.json({ success: true, data: { month: m, income: income.t, expense: expense.t, byCategory } });
  });

  // GET /api/accounting/monthly - 近 12 個月資料 (折線圖用)
  router.get('/monthly', (req, res) => {
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', date) AS month,
             ROUND(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),2) AS income,
             ROUND(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),2) AS expense
      FROM accounting
      WHERE date >= date('now','-11 months','start of month')
      GROUP BY month ORDER BY month
    `).all();
    res.json({ success: true, data: rows });
  });

  // POST /api/accounting
  router.post('/', (req, res) => {
    const { type, amount, category, note, date } = req.body;
    if (!type || !amount || !category || !date) {
      return res.status(400).json({ success: false, error: '缺少必要欄位 (type, amount, category, date)' });
    }
    const result = db.prepare(
      `INSERT INTO accounting (type, amount, category, note, date) VALUES (?, ?, ?, ?, ?)`
    ).run(type, parseFloat(amount), category, note || '', date);
    const record = db.prepare(`SELECT * FROM accounting WHERE id=?`).get(result.lastInsertRowid);
    io.emit('accounting:update');
    res.json({ success: true, data: record });
  });

  // DELETE /api/accounting/:id
  router.delete('/:id', (req, res) => {
    db.prepare(`DELETE FROM accounting WHERE id=?`).run(req.params.id);
    io.emit('accounting:update');
    res.json({ success: true });
  });

  return router;
};
