import { clipboard, dialog, shell } from 'electron';
import { collectGithubEmailSignup } from './email-ingest.js';
import { clearToken, loadToken, saveToken } from './token-store.js';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_USER = 'https://api.github.com/user';
const API_USER_EMAILS = 'https://api.github.com/user/emails';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const GITHUB_SCOPE = 'repo read:org user:email';
const DEFAULT_GITHUB_CLIENT_ID = 'Ov23liCR68jrz9MBieT0';

function getEnv() {
  const clientId =
    process.env.GITFINDER_GITHUB_CLIENT_ID?.trim() ||
    process.env.GITCP_GITHUB_CLIENT_ID?.trim() ||
    DEFAULT_GITHUB_CLIENT_ID;
  return { clientId };
}

export function getOAuthAppConnectionsUrl() {
  const { clientId } = getEnv();
  if (!clientId) return null;
  return `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`;
}

function fetchJson(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'gitfinder/0.1.0',
      ...opts.headers,
    },
  }).then(async (r) => {
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!r.ok) {
      const msg = data.message || data.error_description || data.error || r.statusText;
      throw new Error(msg || `HTTP ${r.status}`);
    }
    return data;
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestDeviceCode(clientId) {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: GITHUB_SCOPE,
  });

  const data = await fetchJson(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (data.error === 'device_flow_disabled') {
    throw new Error('Enable Device Flow in the GitHub OAuth App settings for GitFinder.');
  }
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('No GitHub device authorization code in response');
  }
  return data;
}

async function pollDeviceToken({ clientId, deviceCode, intervalSeconds, expiresInSeconds }) {
  let intervalMs = Math.max(Number(intervalSeconds) || 5, 1) * 1000;
  const deadline = Date.now() + Math.max(Number(expiresInSeconds) || 900, 1) * 1000;

  while (Date.now() < deadline) {
    await wait(intervalMs);

    const tokenData = await fetchJson(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: DEVICE_GRANT_TYPE,
      }).toString(),
    });

    if (tokenData.access_token) {
      return tokenData;
    }
    if (tokenData.error === 'authorization_pending') {
      continue;
    }
    if (tokenData.error === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    if (tokenData.error === 'expired_token') {
      throw new Error('GitHub sign-in code expired');
    }
    if (tokenData.error === 'access_denied') {
      throw new Error('GitHub sign-in was cancelled');
    }

    throw new Error(tokenData.error_description || tokenData.error || 'GitHub sign-in failed');
  }

  throw new Error('GitHub sign-in timed out');
}

async function saveTokenFromResponse(tokenData) {
  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || 'No access token in response');
  }

  const user = await fetchJson(API_USER, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });
  const emails = await fetchJson(API_USER_EMAILS, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  }).catch((error) => {
    console.warn(`GitFinder could not read GitHub email addresses: ${error.message}`);
    return [];
  });

  const emailSignup = await collectGithubEmailSignup({ user, emails }).catch((error) => {
    console.warn(`GitFinder email ingest failed: ${error.message}`);
    return { ok: false, reason: 'exception' };
  });
  if (emailSignup.ok) {
    console.info('GitFinder email ingest accepted');
  } else {
    console.warn(`GitFinder email ingest skipped: ${emailSignup.reason}`);
  }

  const row = {
    access_token: tokenData.access_token,
    token_type: tokenData.token_type || 'bearer',
    scope: tokenData.scope || '',
    login: user.login || null,
    avatar_url: user.avatar_url ?? null,
  };
  saveToken(row);
  return row;
}

export async function loginWithOAuth() {
  const { clientId } = getEnv();
  if (!clientId) {
    throw new Error('Set GITFINDER_GITHUB_CLIENT_ID (GitHub OAuth App client ID).');
  }

  const previous = loadToken();
  clearToken();

  try {
    const device = await requestDeviceCode(clientId);
    clipboard.writeText(device.user_code);
    await shell.openExternal(device.verification_uri_complete || device.verification_uri);
    void dialog.showMessageBox({
      type: 'info',
      title: 'GitFinder GitHub Sign-In',
      message: `Enter code ${device.user_code} on GitHub`,
      detail: 'The code has been copied to your clipboard. GitFinder will finish signing in after you authorize it in the browser.',
      buttons: ['OK'],
    });

    const tokenData = await pollDeviceToken({
      clientId,
      deviceCode: device.device_code,
      intervalSeconds: device.interval,
      expiresInSeconds: device.expires_in,
    });
    return await saveTokenFromResponse(tokenData);
  } catch (error) {
    if (previous?.access_token) {
      saveToken(previous);
    }
    throw error;
  }
}

export function getAuthState() {
  const t = loadToken();
  if (!t?.access_token) {
    return { loggedIn: false, login: null, avatarUrl: null };
  }
  return {
    loggedIn: true,
    login: t.login ?? null,
    avatarUrl: t.avatar_url ?? null,
  };
}

export function logout() {
  clearToken();
}

export { loadToken };
