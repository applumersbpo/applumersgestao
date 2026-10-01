let _upcomingCache = null;
let _upcomingTs    = 0;

// clearUpcomingCache foi movida para js/utils.js (carregado antes) — ver F-211.

async function getUpcomingBills() {
  const now = Date.now();
  if (_upcomingCache !== null && now - _upcomingTs < 120000) return _upcomingCache;

  const todayStr = today();
  // Janela rolante: de hoje até 30 dias à frente (cobre "este mês" e vencimentos
  // que caem no mês seguinte dentro de ~2 semanas — antes só olhava o mês-calendário).
  const cutoff = new Date(todayStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() + 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    const pending = await db.transactions
      .filter(`transaction_type = 'expense' && status = 'pending'`)
      .toArray();
    // Despesas pendentes que vencem nos próximos 30 dias e ainda não venceram.
    _upcomingCache = pending
      .filter(t => t.due_date && t.due_date >= todayStr && t.due_date <= cutoffStr)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
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

// Marca o lembrete como visto/fechado hoje: não reabre até o dia seguinte.
function dismissUpcomingAlert() {
  try { localStorage.setItem('upcoming_alert_dismissed', today()); } catch {}
  const el = document.getElementById('upcoming-alert');
  if (el) el.remove();
}

async function injectUpcomingAlert() {
  const existing = document.getElementById('upcoming-alert');
  if (existing) existing.remove();

  // Uma vez por dia: se já foi visto/fechado hoje, só reabre amanhã.
  try { if (localStorage.getItem('upcoming_alert_dismissed') === today()) return; } catch {}

  const bills = await getUpcomingBills();
  if (bills.length === 0) return;

  const MAX = 6;
  const lines = [
    `<strong>${bills.length} conta(s) a vencer nos próximos 30 dias:</strong>`,
    ...bills.slice(0, MAX).map(b => `${b.name} — ${labelVencimento(b.due_date)}`),
    ...(bills.length > MAX ? [`<em>…e mais ${bills.length - MAX}</em>`] : []),
  ];

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
        <a href="#/expenses" onclick="dismissUpcomingAlert()" style="color:var(--warning);margin-left:8px;font-weight:600">Ver contas →</a>
      </div>
    </div>
    <button onclick="dismissUpcomingAlert()"
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
