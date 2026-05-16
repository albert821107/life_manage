'use strict';

const express = require('express');
const axios   = require('axios');

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/games/psn/profile?username=xxx
  router.get('/psn/profile', async (req, res) => {
    const { username, refresh } = req.query;
    if (!username) return res.json({ success: false, error: '請提供 PSN 使用者名稱' });

    // Return cache unless refresh requested
    if (!refresh) {
      const cached = db.prepare('SELECT profile_data, updated_at FROM psn_cache WHERE username=?').get(username.toLowerCase());
      if (cached) {
        return res.json({ success: true, data: JSON.parse(cached.profile_data), cached: true, updated_at: cached.updated_at });
      }
    }

    try {
      const url = `https://psnprofiles.com/${encodeURIComponent(username)}`;
      const resp = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://psnprofiles.com/',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 15000,
        maxRedirects: 5,
      });
      if (resp.status === 403) {
        return res.json({ success: false, error: 'PSNProfiles 拒絕存取 (403)。請直接前往 https://psnprofiles.com/' + encodeURIComponent(username), blocked: true });
      }
      const html = resp.data;

      // Parse trophy counts from HTML
      const platinum = _parseCount(html, 'platinum');
      const gold     = _parseCount(html, 'gold');
      const silver   = _parseCount(html, 'silver');
      const bronze   = _parseCount(html, 'bronze');

      // Parse level
      const levelMatch = html.match(/<span class="level"[^>]*>(\d+)<\/span>/i)
        || html.match(/psnprofiles-level[^>]*>.*?<\/span>.*?(\d+)/is)
        || html.match(/"level":(\d+)/);
      const level = levelMatch ? parseInt(levelMatch[1]) : null;

      // Parse avatar
      const avatarMatch = html.match(/<img[^>]+class="[^"]*avatar[^"]*"[^>]+src="([^"]+)"/i)
        || html.match(/src="(https:\/\/[^"]*cdn[^"]*avatar[^"]+)"/i);
      const avatar = avatarMatch ? avatarMatch[1] : null;

      // Parse username as shown on site
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const displayName = titleMatch ? titleMatch[1].replace(/ - PSNProfiles\.com$/, '').trim() : username;

      // Parse game count
      const gameCountMatch = html.match(/(\d+)\s*(?:game|games)/i);
      const gameCount = gameCountMatch ? parseInt(gameCountMatch[1]) : null;

      const profile = { username: username.toLowerCase(), displayName, level, avatar,
        trophies: { platinum, gold, silver, bronze, total: (platinum||0)+(gold||0)+(silver||0)+(bronze||0) },
        gameCount, url };

      db.prepare('INSERT OR REPLACE INTO psn_cache (username,profile_data,updated_at) VALUES (?,?,datetime(\'now\',\'localtime\'))').run(username.toLowerCase(), JSON.stringify(profile));
      res.json({ success: true, data: profile, cached: false });
    } catch(e) {
      const status = e.response?.status;
      const msg = status === 404 ? '找不到此 PSN 帳號'
        : status === 403 ? 'PSNProfiles 封鎖伺服器端存取 (403)。請點擊下方連結直接查看。'
        : `無法取得資料：${e.message}`;
      res.json({ success: false, error: msg, blocked: status === 403, profileUrl: `https://psnprofiles.com/${encodeURIComponent(username)}` });
    }
  });

  // GET /api/games/psn/saved — list all cached profiles
  router.get('/psn/saved', (req, res) => {
    try {
      const rows = db.prepare('SELECT username, updated_at FROM psn_cache ORDER BY updated_at DESC').all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // DELETE /api/games/psn/:username
  router.delete('/psn/:username', (req, res) => {
    try {
      db.prepare('DELETE FROM psn_cache WHERE username=?').run(req.params.username.toLowerCase());
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};

function _parseCount(html, type) {
  // Try multiple patterns
  const patterns = [
    new RegExp(`class="[^"]*${type}[^"]*"[^>]*>\\s*(\\d[\\d,]*)`, 'i'),
    new RegExp(`${type}[^<]{0,80}<[^>]+>(\\d[\\d,]*)`, 'i'),
    new RegExp(`"${type}":\\s*(\\d+)`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return parseInt(m[1].replace(/,/g, ''));
  }
  return 0;
}
