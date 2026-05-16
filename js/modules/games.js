'use strict';

const express = require('express');
const axios   = require('axios');

const PSN_CLIENT_CREDS = 'MDk1MTUxNTktNzIzNy00MzcwLTliNGUtNGY1ZTMyNWQ5MzAyOnVjUGprYVR4RmFGbDN5cFpoV1VpV1VmSi10akQ5MWpDRGZmZDNiSA==';

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // ── helpers ──────────────────────────────────────────────

  function getStoredToken() {
    return db.prepare('SELECT access_token, refresh_token, expires_at FROM psn_auth ORDER BY id DESC LIMIT 1').get();
  }

  function isTokenValid(row) {
    if (!row) return false;
    return new Date(row.expires_at) > new Date(Date.now() + 60_000);
  }

  async function exchangeNpsso(npsso) {
    // Step 1: NPSSO → auth code
    const authResp = await axios.get('https://ca.account.sony.com/api/authz/v3/oauth/authorize', {
      params: {
        access_type: 'offline',
        client_id: '09515159-7237-4370-9b4e-4f5e325d9302',
        redirect_uri: 'com.scee.psxandroid.scecompc://redirect',
        response_type: 'code',
        scope: 'psn:mobile.v2.core psn:clientapp',
      },
      headers: { Cookie: `npsso=${npsso}` },
      maxRedirects: 0,
      validateStatus: s => s === 302 || s === 200,
      timeout: 15000,
    });

    const location = authResp.headers?.location || '';
    const codeMatch = location.match(/[?&]code=([^&]+)/);
    if (!codeMatch) throw new Error('無法取得授權碼，請確認 NPSSO 是否有效');
    const code = codeMatch[1];

    // Step 2: auth code → access token
    const tokenResp = await axios.post(
      'https://ca.account.sony.com/api/authz/v3/oauth/token',
      new URLSearchParams({
        code,
        redirect_uri: 'com.scee.psxandroid.scecompc://redirect',
        grant_type: 'authorization_code',
        token_format: 'jwt',
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${PSN_CLIENT_CREDS}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResp.data;
    if (!access_token) throw new Error('未取得 access_token');

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
    db.prepare('DELETE FROM psn_auth').run();
    db.prepare('INSERT INTO psn_auth (access_token, refresh_token, expires_at) VALUES (?,?,?)').run(
      access_token, refresh_token || '', expiresAt
    );
    return access_token;
  }

  async function getValidToken() {
    const row = getStoredToken();
    if (isTokenValid(row)) return row.access_token;

    // Try refresh
    if (row?.refresh_token) {
      try {
        const tokenResp = await axios.post(
          'https://ca.account.sony.com/api/authz/v3/oauth/token',
          new URLSearchParams({
            refresh_token: row.refresh_token,
            grant_type: 'refresh_token',
            token_format: 'jwt',
            scope: 'psn:mobile.v2.core psn:clientapp',
          }).toString(),
          {
            headers: {
              Authorization: `Basic ${PSN_CLIENT_CREDS}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15000,
          }
        );
        const { access_token, refresh_token, expires_in } = tokenResp.data;
        if (access_token) {
          const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
          db.prepare('DELETE FROM psn_auth').run();
          db.prepare('INSERT INTO psn_auth (access_token, refresh_token, expires_at) VALUES (?,?,?)').run(
            access_token, refresh_token || '', expiresAt
          );
          return access_token;
        }
      } catch(e) { /* fall through */ }
    }
    return null;
  }

  // ── routes ──────────────────────────────────────────────

  // POST /api/games/psn/auth — exchange NPSSO for access token
  router.post('/psn/auth', async (req, res) => {
    const { npsso } = req.body;
    if (!npsso) return res.json({ success: false, error: '請提供 NPSSO' });
    try {
      await exchangeNpsso(npsso.trim());
      res.json({ success: true });
    } catch(e) {
      res.json({ success: false, error: e.response?.data?.error_description || e.message });
    }
  });

  // GET /api/games/psn/auth-status — check if token is valid
  router.get('/psn/auth-status', (req, res) => {
    const row = getStoredToken();
    if (isTokenValid(row)) {
      res.json({ success: true, authorized: true, expires_at: row.expires_at });
    } else {
      res.json({ success: true, authorized: false });
    }
  });

  // DELETE /api/games/psn/auth — clear stored token
  router.delete('/psn/auth', (req, res) => {
    try {
      db.prepare('DELETE FROM psn_auth').run();
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/games/psn/profile?username=xxx&refresh=1
  router.get('/psn/profile', async (req, res) => {
    const { username, refresh } = req.query;
    if (!username) return res.json({ success: false, error: '請提供 PSN 使用者名稱' });

    if (!refresh) {
      const cached = db.prepare('SELECT profile_data, updated_at FROM psn_cache WHERE username=?').get(username.toLowerCase());
      if (cached) {
        return res.json({ success: true, data: JSON.parse(cached.profile_data), cached: true, updated_at: cached.updated_at });
      }
    }

    try {
      const token = await getValidToken();
      if (!token) {
        return res.json({ success: false, error: '尚未授權 PSN，請先設定 NPSSO', needAuth: true });
      }

      const psnHeaders = { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh-TW' };

      // Resolve account ID from username
      const lookupResp = await axios.get(
        `https://us-prof.np.community.playstation.net/userProfile/v1/users/${encodeURIComponent(username)}/profile2`,
        {
          params: { fields: 'accountId,onlineId,avatarUrls,plus,trophySummary' },
          headers: psnHeaders,
          timeout: 15000,
        }
      );
      const profileData = lookupResp.data?.profile;
      if (!profileData) throw new Error('找不到此 PSN 帳號');

      const accountId = profileData.accountId;
      const avatarUrl = profileData.avatarUrls?.[profileData.avatarUrls.length - 1]?.avatarUrl || null;

      // Trophy summary
      const trophyResp = await axios.get(
        `https://m.np.playstation.com/api/trophy/v1/users/${accountId}/trophySummary`,
        { headers: psnHeaders, timeout: 15000 }
      );
      const tSummary = trophyResp.data;
      const trophies = {
        platinum: tSummary.earnedTrophies?.platinum ?? 0,
        gold:     tSummary.earnedTrophies?.gold     ?? 0,
        silver:   tSummary.earnedTrophies?.silver   ?? 0,
        bronze:   tSummary.earnedTrophies?.bronze   ?? 0,
        total:    (tSummary.earnedTrophies?.platinum ?? 0) + (tSummary.earnedTrophies?.gold ?? 0) +
                  (tSummary.earnedTrophies?.silver ?? 0)   + (tSummary.earnedTrophies?.bronze ?? 0),
      };
      const level = tSummary.trophyLevel ?? null;

      const profile = {
        username: username.toLowerCase(),
        displayName: profileData.onlineId || username,
        accountId,
        level,
        avatar: avatarUrl,
        trophies,
        plus: profileData.plus === 1,
      };

      db.prepare('INSERT OR REPLACE INTO psn_cache (username,profile_data,updated_at) VALUES (?,?,datetime(\'now\',\'localtime\'))').run(
        username.toLowerCase(), JSON.stringify(profile)
      );
      res.json({ success: true, data: profile, cached: false });
    } catch(e) {
      const status = e.response?.status;
      if (status === 401) return res.json({ success: false, error: 'PSN 授權已過期，請重新設定 NPSSO', needAuth: true });
      if (status === 404) return res.json({ success: false, error: '找不到此 PSN 帳號' });
      res.json({ success: false, error: `查詢失敗：${e.message}` });
    }
  });

  // GET /api/games/psn/saved
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
