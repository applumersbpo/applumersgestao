import { SignJWT, jwtVerify } from 'jose';

const isProduction = () =>
  process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

const resolveSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (isProduction()) {
    throw new Error('JWT_SECRET não configurado — abortando por segurança');
  }

  console.warn('[auth] JWT_SECRET ausente — usando fallback de DEV. NÃO use em produção.');
  return 'dev-only-insecure-secret';
};

const getSecret = () => new TextEncoder().encode(resolveSecret());

export async function signToken(payload, options = {}) {
  // expiresIn é opcional e retrocompatível: login normal mantém 30d (default);
  // token de impersonação passa '2h'.
  const expiresIn = options.expiresIn || '30d';
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}

// Token de impersonação (admin "vendo como usuário"): sempre read-only.
export function isImpersonation(payload) {
  return !!(payload && payload.imp === true);
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload;
}

export async function requireAuth(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Error('Unauthorized');
  try {
    return await verifyToken(token);
  } catch {
    throw new Error('Unauthorized');
  }
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
