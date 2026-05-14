'use strict';

const express = require('express');

/**
 * 健身模組 - 運動紀錄管理
 */
module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/fitness?month=YYYY-MM
  router.get('/', (req, res) => {
    const { month } = req.query;
    const rows = month
      ? db.prepare(`SELECT * FROM fitness WHERE date LIKE ? ORDER BY date DESC, id DESC`).all(`${month}%`)
      : db.prepare(`SELECT * FROM fitness ORDER BY date DESC, id DESC LIMIT 200`).all();
    res.json({ success: true, data: rows });
  });

  // GET /api/fitness/summary
  router.get('/summary', (req, res) => {
    const month = new Date().toISOString().slice(0, 7);
    const week  = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(duration),0) AS duration, COALESCE(SUM(calories),0) AS calories
      FROM fitness WHERE date >= date('now','-6 days')
    `).get();
    const monthStat = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(duration),0) AS duration, COALESCE(SUM(calories),0) AS calories
      FROM fitness WHERE date LIKE ?
    `).get(`${month}%`);
    const byType = db.prepare(`
      SELECT type, COUNT(*) AS count, COALESCE(SUM(duration),0) AS duration, COALESCE(SUM(calories),0) AS calories
      FROM fitness GROUP BY type ORDER BY count DESC
    `).all();
    res.json({ success: true, data: { week, month: monthStat, byType } });
  });

  // GET /api/fitness/daily - 近 30 天每日統計 (圖表用)
  router.get('/daily', (req, res) => {
    const rows = db.prepare(`
      SELECT date, COUNT(*) AS count, COALESCE(SUM(duration),0) AS duration, COALESCE(SUM(calories),0) AS calories
      FROM fitness WHERE date >= date('now','-29 days')
      GROUP BY date ORDER BY date
    `).all();
    res.json({ success: true, data: rows });
  });

  // POST /api/fitness
  router.post('/', (req, res) => {
    const { type, duration, calories, note, date } = req.body;
    if (!type || !date) return res.status(400).json({ success: false, error: '請填寫運動類型和日期' });
    const result = db.prepare(
      `INSERT INTO fitness (type, duration, calories, note, date) VALUES (?, ?, ?, ?, ?)`
    ).run(type, parseInt(duration) || 0, parseInt(calories) || 0, note || '', date);
    const log = db.prepare(`SELECT * FROM fitness WHERE id=?`).get(result.lastInsertRowid);
    io.emit('fitness:update');
    res.json({ success: true, data: log });
  });

  // DELETE /api/fitness/:id
  router.delete('/:id', (req, res) => {
    db.prepare(`DELETE FROM fitness WHERE id=?`).run(req.params.id);
    io.emit('fitness:update');
    res.json({ success: true });
  });

  return router;
};
