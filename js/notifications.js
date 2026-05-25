let _upcomingCache = null;
let _upcomingTs    = 0;

function clearUpcomingCache() { _upcomingCache = null; }

async function getUpcomingBills() {
  const now = Date.now();
  if (_upcomingCache !== null && now - _upcomingTs < 120000) return _upcomingCache;

  const today = new Date();
  const in3   = new Date(today.getTime() + 3 * 86400000);
  const tStr  = today.toISOString().split('T')[0];
  const i3Str = in3.toISOString().split('T')[0];

  try {
    _upcomingCache = await db.transactions
      .filter(`transaction_type = 'expense' && status = 'pending' && due_date >= '${tStr}' && due_date <= '${i3Str}'`)
      .toArray();
    _upcomingTs = now;
    return _upcomingCache;
  } catch {
    return [];
  }
}

async function requestAndNotify() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'denied') return;

  const today = new Date().toISOString().split('T')[0];
  if (localStorage.getItem('last_notify') === today) return;

  const bills = await getUpcomingBills();
  if (bills.length === 0) return;

  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
  }

  localStorage.setItem('last_notify', today);
  const reg = await navigator.serviceWorker.ready;

  if (bills.length === 1) {
    reg.showNotification('Conta vencendo em breve', {
      body:  `${bills[0].name} — ${fmtDate(bills[0].due_date)}`,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });
  } else {
    reg.showNotification(`${bills.length} contas vencendo em breve`, {
      body:  bills.slice(0, 3).map(b => b.name).join(' · '),
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });
  }
}

async function injectUpcomingAlert() {
  const existing = document.getElementById('upcoming-alert');
  if (existing) existing.remove();

  const bills = await getUpcomingBills();
  if (bills.length === 0) return;

  const today = new Date().toISOString().split('T')[0];
  const overdue  = bills.filter(b => b.due_date < today);
  const upcoming = bills.filter(b => b.due_date >= today);

  const lines = [];
  if (overdue.length)  lines.push(`<strong>${overdue.length} vencida(s):</strong> ${overdue.map(b => b.name).join(', ')}`);
  if (upcoming.length) lines.push(`<strong>${upcoming.length} vence(m) em até 3 dias:</strong> ${upcoming.map(b => b.name).join(', ')}`);

  const alert = document.createElement('div');
  alert.id = 'upcoming-alert';
  alert.style.cssText = `
    display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
    background:rgba(212,162,76,.08);border:1px solid rgba(212,162,76,.25);border-radius:var(--radius);
    padding:12px 16px;margin-bottom:16px;
  `;
  alert.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start;flex:1;min-width:0">
      <span style="font-size:1.1rem;flex-shrink:0">⚠️</span>
      <div style="font-size:.85rem;color:var(--text);line-height:1.5">
        ${lines.join('<br>')}
        <a href="#/bills" style="color:var(--warning);margin-left:8px;font-weight:600">Ver contas →</a>
      </div>
    </div>
    <button onclick="document.getElementById('upcoming-alert').remove()"
      style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;padding:0;line-height:1">✕</button>
  `;

  const content = document.getElementById('content');
  if (content) content.prepend(alert);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
