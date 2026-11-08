import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const BCRYPT_COST = 12;
const MAX_PASSWORD_BYTES = 72;
const dummyPasswordHash = bcrypt.hashSync(
  randomBytes(32).toString('hex'),
  BCRYPT_COST,
);

export function normalizeAdminEmail(email) {
  if (typeof email !== 'string') {
    throw new TypeError('Admin email must be a string.');
  }
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new TypeError('Enter a valid admin email address.');
  }
  return normalized;
}

export function validateAdminPassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('Admin password must be a string.');
  }
  const bytes = Buffer.byteLength(password, 'utf8');
  if (Array.from(password).length < 12 || bytes > MAX_PASSWORD_BYTES) {
    throw new TypeError(
      'Admin password must be at least 12 characters and no more than 72 UTF-8 bytes.',
    );
  }
  return password;
}

export function hashAdminPassword(password) {
  return bcrypt.hash(validateAdminPassword(password), BCRYPT_COST);
}

export async function verifyAdminPassword(password, passwordHash) {
  const candidate =
    typeof password === 'string' &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
      ? password
      : '';
  return bcrypt.compare(candidate, passwordHash ?? dummyPasswordHash);
}
