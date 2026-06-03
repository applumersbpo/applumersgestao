import { initDb, getSystemSetting } from '../lib/db.js';
import { cors } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await initDb();
  const value = await getSystemSetting('allow_registration');
  return res.status(200).json({ allow_registration: value === '1' });
}
