import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { normalizeAdminEmail, verifyAdminPassword } from './passwords.js';
import { SQLiteSessionStore } from './session-store.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

function csrfMatches(expectedToken, providedToken) {
  if (typeof expectedToken !== 'string' || typeof providedToken !== 'string') {
    return false;
  }
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return (
    expected.length === provided.length &&
    timingSafeEqual(expected, provided)
  );
}

function createCsrfToken() {
  return randomBytes(32).toString('hex');
}

export function requireCsrf(request, response, next) {
  if (
    !csrfMatches(
      request.session?.csrfToken,
      request.get('X-CSRF-Token'),
    )
  ) {
    return response.status(403).json({
      error: {
        code: 'CSRF_TOKEN_INVALID',
        message: 'Your security token is missing or expired. Refresh and try again.',
      },
    });
  }
  return next();
}

export function requireAdmin(request, response, next) {
  if (!request.session?.admin) {
    return response.status(401).json({
      error: {
        code: 'ADMIN_AUTHENTICATION_REQUIRED',
        message: 'Please sign in as an administrator.',
      },
    });
  }
  return next();
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) =>
      error ? reject(error) : resolve(),
    );
  });
}

export function createAdminSessionMiddleware(
  database,
  { sessionSecret, secureCookies = false, trustProxy = false },
) {
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
  }
  const store = new SQLiteSessionStore(database);
  const cookieName = secureCookies
    ? '__Host-restaurant-admin'
    : 'restaurant-admin.sid';
  return {
    store,
    middleware: session({
      name: cookieName,
      secret: sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: trustProxy,
      cookie: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_MS,
      },
    }),
    cookieName,
    cookieOptions: {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path: '/',
    },
  };
}

export function createAdminAuthRouter(
  database,
  { cookieName, cookieOptions },
) {
  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'LOGIN_RATE_LIMITED',
        message: 'Too many sign-in attempts. Please wait and try again.',
      },
    },
  });

  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/csrf', (request, response) => {
    request.session.csrfToken ??= createCsrfToken();
    response.json({ csrfToken: request.session.csrfToken });
  });

  router.post('/login', loginLimiter, requireCsrf, async (request, response) => {
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
    const password =
      typeof request.body?.password === 'string'
        ? request.body.password
        : '';
    let normalizedEmail = '';
    try {
      normalizedEmail = normalizeAdminEmail(email);
    } catch {
      normalizedEmail = '';
    }
    const admin = normalizedEmail
      ? database
          .prepare(`
            SELECT id, email, password_hash AS passwordHash
            FROM admin_users
            WHERE email = ? AND disabled_at IS NULL
          `)
          .get(normalizedEmail)
      : undefined;
    const passwordMatches = await verifyAdminPassword(
      password,
      admin?.passwordHash,
    );
    if (!admin || !passwordMatches) {
      return response.status(401).json({
        error: {
          code: 'INVALID_ADMIN_CREDENTIALS',
          message: GENERIC_LOGIN_ERROR,
        },
      });
    }

    await regenerateSession(request);
    request.session.admin = {
      id: admin.id,
      email: admin.email,
    };
    request.session.csrfToken = createCsrfToken();
    request.session.cookie.maxAge = SESSION_TTL_MS;
    await saveSession(request);
    database
      .prepare(`
        UPDATE admin_users
        SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `)
      .run(admin.id);
    return response.json({
      admin: request.session.admin,
      csrfToken: request.session.csrfToken,
    });
  });

  router.get('/me', requireAdmin, (request, response) => {
    response.json({ admin: request.session.admin });
  });

  router.post('/logout', requireAdmin, requireCsrf, async (request, response) => {
    await destroySession(request);
    response.clearCookie(cookieName, cookieOptions);
    return response.status(204).end();
  });

  return router;
}

export async function createAdminUser(database, email, password, hashPassword) {
  const normalizedEmail = normalizeAdminEmail(email);
  const existingAdmin = database
    .prepare('SELECT id FROM admin_users LIMIT 1')
    .get();
  if (existingAdmin) {
    throw new Error(
      'An admin account already exists. Public registration is disabled.',
    );
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  database
    .prepare('INSERT INTO admin_users (id, email, password_hash) VALUES (?, ?, ?)')
    .run(id, normalizedEmail, passwordHash);
  return { id, email: normalizedEmail };
}
