import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import {
  createAdminUser,
  requireAdmin,
} from '../src/auth/admin-auth.js';
import {
  hashAdminPassword,
  normalizeAdminEmail,
  validateAdminPassword,
} from '../src/auth/passwords.js';
import { openDatabase } from '../src/database/database.js';

const sessionSecret = 'test-session-secret-with-more-than-32-characters';

async function withAuthApp(run) {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-admin-auth-'));
  const database = await openDatabase(join(directory, 'auth.sqlite'));
  const app = createApp(database, {
    allowedOrigins: ['https://admin.example'],
    sessionSecret,
  });
  try {
    const admin = await createAdminUser(
      database,
      'OWNER@EXAMPLE.COM',
      'SecureTestPass123!',
      hashAdminPassword,
    );
    await run({ app, database, admin });
  } finally {
    app.locals.adminSessionStore.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function request(app, path, init = {}, cookie = '') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const headers = new Headers(init.headers);
    if (cookie) {
      headers.set('Cookie', cookie);
    }
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      { ...init, headers },
    );
    const setCookie = response.headers.get('set-cookie');
    const contentType = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      body: contentType.includes('application/json')
        ? await response.json()
        : null,
      cookie: setCookie ? setCookie.split(';')[0] : cookie,
      headers: response.headers,
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function csrf(app, cookie = '') {
  return request(app, '/api/admin/csrf', {}, cookie);
}

async function login(app, email, password) {
  const tokenResponse = await csrf(app);
  const response = await request(
    app,
    '/api/admin/login',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': tokenResponse.body.csrfToken,
      },
      body: JSON.stringify({ email, password }),
    },
    tokenResponse.cookie,
  );
  return response;
}

test('normalizes admin email and requires strong passwords', async () => {
  assert.equal(normalizeAdminEmail('  OWNER@Example.COM '), 'owner@example.com');
  assert.equal(validateAdminPassword('SecureTestPass123!'), 'SecureTestPass123!');
  assert.throws(() => validateAdminPassword('short'), /at least 12 characters/);
  assert.throws(
    () => normalizeAdminEmail('not-an-email'),
    /valid admin email/,
  );
});

test('login establishes a protected server-side session and rotates the CSRF token', async () => {
  await withAuthApp(async ({ app, admin, database }) => {
    const tokenResponse = await request(
      app,
      '/api/admin/csrf',
      { headers: { Origin: 'https://admin.example' } },
    );
    assert.equal(tokenResponse.status, 200);
    assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
    assert.equal(
      tokenResponse.headers.get('access-control-allow-origin'),
      'https://admin.example',
    );
    assert.equal(
      tokenResponse.headers.get('access-control-allow-credentials'),
      'true',
    );

    const response = await request(
      app,
      '/api/admin/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': tokenResponse.body.csrfToken,
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'SecureTestPass123!',
        }),
      },
      tokenResponse.cookie,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.admin, {
      id: admin.id,
      email: 'owner@example.com',
    });
    assert.notEqual(response.body.csrfToken, tokenResponse.body.csrfToken);
    assert.match(response.cookie, /^restaurant-admin\.sid=/);
    assert.match(
      response.headers.get('set-cookie'),
      /HttpOnly; SameSite=Strict/,
    );
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS count FROM admin_sessions')
        .get().count,
      1,
    );

    const me = await request(app, '/api/admin/me', {}, response.cookie);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.admin, response.body.admin);
    assert.equal(me.headers.get('cache-control'), 'no-store');
  });
});

test('rejects invalid credentials and CSRF requests without revealing accounts', async () => {
  await withAuthApp(async ({ app }) => {
    const token = await csrf(app);
    const missingCsrf = await request(app, '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@example.com',
        password: 'SecureTestPass123!',
      }),
    }, token.cookie);
    const wrongPassword = await request(
      app,
      '/api/admin/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token.body.csrfToken,
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'WrongPassword123!',
        }),
      },
      token.cookie,
    );
    const unknownAccount = await login(
      app,
      'unknown@example.com',
      'WrongPassword123!',
    );

    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.body.error.code, 'CSRF_TOKEN_INVALID');
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownAccount.status, 401);
    assert.deepEqual(wrongPassword.body, unknownAccount.body);
    assert.equal(wrongPassword.body.error.code, 'INVALID_ADMIN_CREDENTIALS');
  });
});

test('logout destroys the session and no public registration route exists', async () => {
  await withAuthApp(async ({ app }) => {
    const authenticated = await login(
      app,
      'owner@example.com',
      'SecureTestPass123!',
    );
    const logoutToken = await csrf(app, authenticated.cookie);
    const logout = await request(
      app,
      '/api/admin/logout',
      {
        method: 'POST',
        headers: { 'X-CSRF-Token': logoutToken.body.csrfToken },
      },
      authenticated.cookie,
    );
    const afterLogout = await request(
      app,
      '/api/admin/me',
      {},
      authenticated.cookie,
    );
    const registration = await request(app, '/api/admin/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@example.com',
        password: 'SecureTestPass123!',
      }),
    });

    assert.equal(logout.status, 204);
    assert.equal(afterLogout.status, 401);
    assert.equal(registration.status, 404);
  });
});

test('admin middleware returns unauthorized without an authenticated session', async () => {
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let continued = false;
  requireAdmin({}, response, () => {
    continued = true;
  });

  assert.equal(response.statusCode, 401);
  assert.equal(continued, false);
  assert.equal(
    response.body.error.code,
    'ADMIN_AUTHENTICATION_REQUIRED',
  );
});
