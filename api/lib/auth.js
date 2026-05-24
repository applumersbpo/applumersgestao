import { SignJWT, jwtVerify } from 'jose';

const getSecret = () => new TextEncoder().encode(
  process.env.JWT_SECRET || 'lumers-gestao-secret-2025-change-in-production'
);

export async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
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
