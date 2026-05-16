'use strict';
/**
 * 下載各國 GeoJSON 並存入 SQLite travel_geojson 資料表
 * 執行方式: node scripts/seed_geojson.js
 */
const https = require('https');
const http  = require('http');
const path  = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const COUNTRIES = {
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
    const req = protocol.get(url, { headers: { 'User-Agent': 'life-manager-seed/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchUrl(location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Timeout (60s)')); });
  });
}

(async () => {
  console.log('初始化資料庫...');
  const db = await require('../js/db').init();

  for (const [country, url] of Object.entries(COUNTRIES)) {
    const existing = db.prepare('SELECT country FROM travel_geojson WHERE country = ?').get(country);
    if (existing) {
      console.log(`[SKIP] ${country} 已存在於 DB`);
      continue;
    }
    process.stdout.write(`[DL]  ${country.padEnd(8)} 下載中... `);
    try {
      const text = await fetchUrl(url);
      JSON.parse(text); // 驗證 JSON 格式
      db.prepare('INSERT OR REPLACE INTO travel_geojson (country, geojson) VALUES (?, ?)').run(country, text);
      console.log(`OK (${(text.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }

  console.log('\n完成！GeoJSON 資料已儲存至 SQLite。');
  process.exit(0);
})();
