'use strict';

const express = require('express');
const https   = require('https');
const http    = require('http');

const ALLOWED_COUNTRIES = new Set(['japan', 'thailand', 'korea', 'taiwan', 'hk', 'vietnam']);

const GEOJSON_SOURCES = {
  japan:    'https://cdn.jsdelivr.net/gh/dataofjapan/land/japan.geojson',
  thailand: 'https://cdn.jsdelivr.net/gh/apisit/thailand.json/thailand.json',
  taiwan:   'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/taiwan.geojson',
  korea:    'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_KOR_1.json',
  vietnam:  'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_VNM_1.json',
};

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': 'life-manager/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume();
        return fetchUrl(loc, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Timeout')); });
  });
}

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

  // ── Weekly Schedule (大小週) ──
  router.get('/weekly', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM travel_weekly_schedule ORDER BY week_date ASC`).all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.post('/weekly', (req, res) => {
    try {
      const { week_date, return_date, week_type, location, transportation, tickets, accommodation, note } = req.body;
      if (!week_date) return res.json({ success: false, error: '請填寫出發日期' });
      const r = db.prepare(`INSERT INTO travel_weekly_schedule (week_date,return_date,week_type,location,transportation,tickets,accommodation,note) VALUES (?,?,?,?,?,?,?,?)`)
        .run(week_date, return_date||null, week_type||'大', location||'', transportation||'', tickets||'', accommodation||'', note||'');
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.put('/weekly/:id', (req, res) => {
    try {
      const { week_date, return_date, week_type, location, transportation, tickets, accommodation, note } = req.body;
      db.prepare(`UPDATE travel_weekly_schedule SET week_date=?,return_date=?,week_type=?,location=?,transportation=?,tickets=?,accommodation=?,note=? WHERE id=?`)
        .run(week_date, return_date||null, week_type||'大', location||'', transportation||'', tickets||'', accommodation||'', note||'', req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  router.delete('/weekly/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM travel_weekly_schedule WHERE id=?`).run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/travel/download-maps — download GeoJSON for all countries
  router.post('/download-maps', async (req, res) => {
    const results = {};
    for (const [country, url] of Object.entries(GEOJSON_SOURCES)) {
      const existing = db.prepare('SELECT country FROM travel_geojson WHERE country=?').get(country);
      if (existing) { results[country] = 'skipped'; continue; }
      try {
        const text = await fetchUrl(url);
        JSON.parse(text);
        db.prepare('INSERT OR REPLACE INTO travel_geojson (country,geojson) VALUES (?,?)').run(country, text);
        results[country] = 'ok';
      } catch(e) {
        results[country] = 'fail: ' + e.message;
      }
    }
    res.json({ success: true, results });
  });

  // POST /api/travel/weekly/generate — auto-generate schedule from params
  router.post('/weekly/generate', (req, res) => {
    try {
      const { start_date, end_date, start_type = '小', small_duration = 1, big_duration = 2, small_to_big = 6, big_to_small = 8 } = req.body;
      if (!start_date || !end_date) return res.json({ success: false, error: '請提供起訖日期' });

      // Preserve entries that have any data filled
      const existing = db.prepare(`SELECT * FROM travel_weekly_schedule WHERE location!='' OR transportation!='' OR tickets!='' OR accommodation!=''`).all();
      const existingByDate = {};
      existing.forEach(e => { existingByDate[e.week_date] = e; });

      // Clear all
      db.prepare(`DELETE FROM travel_weekly_schedule`).run();

      // Generate new entries
      const endDt = new Date(end_date);
      let current = new Date(start_date);
      let type = start_type;
      const entries = [];

      while (current <= endDt) {
        const dateStr = current.toISOString().slice(0, 10);
        const dur = type === '大' ? Number(big_duration) : Number(small_duration);
        const retDate = new Date(current);
        retDate.setDate(retDate.getDate() + dur - 1);
        const retStr = retDate.toISOString().slice(0, 10);

        const saved = existingByDate[dateStr] || {};
        entries.push({ week_date: dateStr, return_date: retStr, week_type: type,
          location: saved.location||'', transportation: saved.transportation||'',
          tickets: saved.tickets||'', accommodation: saved.accommodation||'', note: saved.note||'' });

        // Advance to next entry
        if (type === '小') {
          current.setDate(current.getDate() + Number(small_to_big));
          type = '大';
        } else {
          current.setDate(current.getDate() + Number(big_to_small));
          type = '小';
        }
      }

      const raw = db._raw;
      const stmt = raw.prepare(`INSERT INTO travel_weekly_schedule (week_date,return_date,week_type,location,transportation,tickets,accommodation,note) VALUES (?,?,?,?,?,?,?,?)`);
      entries.forEach(e => { stmt.bind([e.week_date, e.return_date, e.week_type, e.location, e.transportation, e.tickets, e.accommodation, e.note]); stmt.step(); stmt.reset(); });
      stmt.free();
      db.persist();

      res.json({ success: true, count: entries.length });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};
