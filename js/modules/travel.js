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

  // POST /api/travel/visited - toggle
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

  // ── Trips ──
  router.get('/trips', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM travel_trips ORDER BY start_date DESC, created_at DESC`).all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.post('/trips', (req, res) => {
    try {
      const { name, destination, start_date, end_date, status, transportation, accommodation, notes } = req.body;
      if (!name) return res.json({ success: false, error: '請填寫行程名稱' });
      const r = db.prepare(`INSERT INTO travel_trips (name,destination,start_date,end_date,status,transportation,accommodation,notes) VALUES (?,?,?,?,?,?,?,?)`)
        .run(name, destination||'', start_date||null, end_date||null, status||'planning', transportation||'', accommodation||'', notes||'');
      io.emit('travel:trips:update');
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.put('/trips/:id', (req, res) => {
    try {
      const { name, destination, start_date, end_date, status, transportation, accommodation, notes } = req.body;
      db.prepare(`UPDATE travel_trips SET name=?,destination=?,start_date=?,end_date=?,status=?,transportation=?,accommodation=?,notes=? WHERE id=?`)
        .run(name, destination||'', start_date||null, end_date||null, status||'planning', transportation||'', accommodation||'', notes||'', req.params.id);
      io.emit('travel:trips:update');
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.delete('/trips/:id', (req, res) => {
    try {
      const id = req.params.id;
      db.prepare(`DELETE FROM travel_schedule WHERE trip_id=?`).run(id);
      db.prepare(`DELETE FROM travel_checklist WHERE trip_id=?`).run(id);
      db.prepare(`DELETE FROM travel_trips WHERE id=?`).run(id);
      io.emit('travel:trips:update');
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // ── Schedule ──
  router.get('/trips/:id/schedule', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM travel_schedule WHERE trip_id=? ORDER BY day_offset, time_slot`).all(req.params.id);
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.post('/trips/:id/schedule', (req, res) => {
    try {
      const { day_offset, time_slot, title, description, type } = req.body;
      if (!title) return res.json({ success: false, error: '請填寫項目名稱' });
      const r = db.prepare(`INSERT INTO travel_schedule (trip_id,day_offset,time_slot,title,description,type) VALUES (?,?,?,?,?,?)`)
        .run(req.params.id, day_offset||1, time_slot||'', title, description||'', type||'activity');
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.put('/schedule/:id', (req, res) => {
    try {
      const { day_offset, time_slot, title, description, type } = req.body;
      db.prepare(`UPDATE travel_schedule SET day_offset=?,time_slot=?,title=?,description=?,type=? WHERE id=?`)
        .run(day_offset||1, time_slot||'', title, description||'', type||'activity', req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.delete('/schedule/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM travel_schedule WHERE id=?`).run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // ── Checklist ──
  router.get('/trips/:id/checklist', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM travel_checklist WHERE trip_id=? ORDER BY sort_order, created_at`).all(req.params.id);
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.post('/trips/:id/checklist', (req, res) => {
    try {
      const { item, category } = req.body;
      if (!item) return res.json({ success: false, error: '請填寫清單項目' });
      const r = db.prepare(`INSERT INTO travel_checklist (trip_id,item,category) VALUES (?,?,?)`)
        .run(req.params.id, item, category||'其他');
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.patch('/checklist/:id', (req, res) => {
    try {
      const { checked, item, category } = req.body;
      if (checked !== undefined) {
        db.prepare(`UPDATE travel_checklist SET checked=? WHERE id=?`).run(checked ? 1 : 0, req.params.id);
      } else {
        db.prepare(`UPDATE travel_checklist SET item=?,category=? WHERE id=?`).run(item, category||'其他', req.params.id);
      }
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.delete('/checklist/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM travel_checklist WHERE id=?`).run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // ── Memories ──
  router.get('/memories', (req, res) => {
    try {
      const rows = db.prepare(`SELECT m.*, t.name as trip_name FROM travel_memories m LEFT JOIN travel_trips t ON m.trip_id=t.id ORDER BY m.date DESC, m.created_at DESC`).all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.post('/memories', (req, res) => {
    try {
      const { trip_id, title, content, date, tags } = req.body;
      if (!title) return res.json({ success: false, error: '請填寫回憶標題' });
      const r = db.prepare(`INSERT INTO travel_memories (trip_id,title,content,date,tags) VALUES (?,?,?,?,?)`)
        .run(trip_id||null, title, content||'', date||null, tags||'');
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.put('/memories/:id', (req, res) => {
    try {
      const { trip_id, title, content, date, tags } = req.body;
      db.prepare(`UPDATE travel_memories SET trip_id=?,title=?,content=?,date=?,tags=? WHERE id=?`)
        .run(trip_id||null, title, content||'', date||null, tags||'', req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.delete('/memories/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM travel_memories WHERE id=?`).run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};
