'use strict';

const express = require('express');

const ALLOWED_COUNTRIES = new Set(['japan', 'thailand', 'korea', 'taiwan', 'hk', 'vietnam']);

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/travel/geojson/:country — 從 SQLite 回傳快取的 GeoJSON
  router.get('/geojson/:country', (req, res) => {
    const { country } = req.params;
    if (!ALLOWED_COUNTRIES.has(country)) {
      return res.status(400).json({ success: false, error: '無效的國家代碼' });
    }
    const row = db.prepare('SELECT geojson FROM travel_geojson WHERE country = ?').get(country);
    if (!row) {
      return res.status(404).json({ success: false, error: '地圖資料尚未下載，請執行: node scripts/seed_geojson.js' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(row.geojson);
  });

  // GET /api/travel/visited?country=japan
  router.get('/visited', (req, res) => {
    const { country } = req.query;
    if (!country) return res.status(400).json({ success: false, error: '請提供 country 參數' });
    const rows = db.prepare(`SELECT * FROM travel_visited WHERE country = ? ORDER BY visited_at DESC`).all(country);
    res.json({ success: true, data: rows });
  });

  // GET /api/travel/summary - 各國已造訪數量
  router.get('/summary', (req, res) => {
    const rows = db.prepare(`SELECT country, COUNT(*) AS visited FROM travel_visited GROUP BY country`).all();
    res.json({ success: true, data: rows });
  });

  // POST /api/travel/visited - toggle (已存在則刪除，未存在則新增)
  router.post('/visited', (req, res) => {
    const { country, region_id, region_name } = req.body;
    if (!country || !region_id) return res.status(400).json({ success: false, error: '缺少必要欄位' });
    const existing = db.prepare(`SELECT id FROM travel_visited WHERE country = ? AND region_id = ?`).get(country, region_id);
    if (existing) {
      db.prepare(`DELETE FROM travel_visited WHERE country = ? AND region_id = ?`).run(country, region_id);
      io.emit('travel:update', { country });
      return res.json({ success: true, action: 'removed' });
    }
    db.prepare(`INSERT INTO travel_visited (country, region_id, region_name) VALUES (?, ?, ?)`).run(country, region_id, region_name || region_id);
    io.emit('travel:update', { country });
    res.json({ success: true, action: 'added' });
  });

  return router;
};
