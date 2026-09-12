const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/errors');

function authSecret() {
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_TOKEN_SECRET) throw new ApiError(500, 'AUTH_TOKEN_SECRET is not configured');
  return process.env.AUTH_TOKEN_SECRET || 'development-only-secret';
}

function createAuthToken(userId) {
  const subject = String(userId);
  const signature = crypto.createHmac('sha256', authSecret()).update(subject).digest('base64url');
  return `${subject}.${signature}`;
}

function tokenUserId(req) {
  const header = req.get('authorization');
  if (!header || !header.startsWith('Bearer ')) throw new ApiError(401, 'Authentication required');
  const [subject, signature] = header.slice('Bearer '.length).trim().split('.');
  if (!subject || !signature) throw new ApiError(401, 'Bearer token is invalid');
  const expected = crypto.createHmac('sha256', authSecret()).update(subject).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ApiError(401, 'Bearer token is invalid');
  try { return BigInt(subject); } catch { throw new ApiError(401, 'Bearer token subject must identify a user'); }
}

async function requireAuth(req, res, next) {
  try {
    const user = await prisma.users.findUnique({
      where: { user_id: tokenUserId(req) },
      select: { user_id: true, username: true, role_id: true, is_active: true, role: { select: { role_permission: { select: { permission: { select: { permission_code: true } } } } } } }
    });
    if (!user || !user.is_active || !user.role) throw new ApiError(401, 'Invalid or inactive user');
    req.user = user;
    req.permissions = new Set(user.role.role_permission.map(({ permission }) => permission.permission_code));
    next();
  } catch (error) { next(error); }
}

function requirePermission(...requiredPermissions) {
  return (req, res, next) => {
    if (requiredPermissions.some((permission) => req.permissions && (req.permissions.has(permission) || req.permissions.has('*')))) return next();
    next(new ApiError(403, 'Insufficient permission', { required: requiredPermissions }));
  };
}

module.exports = { createAuthToken, requireAuth, requirePermission };