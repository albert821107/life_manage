'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../js/db');

db.init().then(d => {
  const rows = d.prepare('SELECT country FROM travel_geojson').all();
  console.log('已下載:', rows.map(r => r.country));

  for (const { country } of rows) {
    const row = d.prepare('SELECT geojson FROM travel_geojson WHERE country = ?').get(country);
    const geo = JSON.parse(row.geojson);
    const props = geo.features[0].properties;
    console.log(`\n=== ${country} ===`);
    console.log('  keys:', Object.keys(props).join(', '));
    console.log('  sample:', geo.features.slice(0, 4).map(f => {
      const p = f.properties;
      return p.name || p.nam || p.shapeName || p.PROV_NAM_T || JSON.stringify(p).slice(0,40);
    }));
  }
  process.exit(0);
});
