// ── Fluxo Anual — Contas a Pagar e a Receber ──────────────────────────────────
// js/pages/annual-reports.js

let _arData = null;
let _arYear = new Date().getFullYear();

// ── Color helpers ─────────────────────────────────────────────────────────────

function _arColors() {
  const s = getComputedStyle(document.documentElement);
  const g = v => s.getPropertyValue(v).trim();
  return {
    cardHeader:    g('--annual-card-header')    || '#3A5A40',
    receiver:      g('--annual-receiver')       || '#DDE7D8',
    payer:         g('--annual-payer')          || '#FAEDE7',
    overdue:       g('--annual-overdue')        || '#FDDCD4',
    saldoPos:      g('--annual-saldo-pos')      || '#2C4630',
    saldoNeg:      g('--annual-saldo-neg')      || '#C95A47',
    saldoZero:     g('--annual-saldo-zero')     || '#807B6C',
    border:        g('--annual-border')         || '#E8E2D0',
    summaryAccent: g('--annual-summary-accent') || '#D4A24C',
  };
}

function _arSC(v, c) { // saldo color
  return v > 0 ? c.saldoPos : v < 0 ? c.saldoNeg : c.saldoZero;
}

// ── Main entry ────────────────────────────────────────────────────────────────

async function renderAnnualReports(year) {
  _arYear = parseInt(year) || new Date().getFullYear();
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const data = await _api('GET', `/data/annual-reports?year=${_arYear}`);
    _arData = data;
    _arRenderPage(data);
  } catch (e) {
    content.innerHTML = `
      <div class="empty-state">
        ${icon('alert-triangle', 40)}
        <p style="color:var(--expense)">Erro ao carregar: ${_escHtml(e.message)}</p>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

// ── Page layout ───────────────────────────────────────────────────────────────

function _arRenderPage({ year, months, annual }) {
  const c = _arColors();
  const content = document.getElementById('content');

  // Inject responsive grid styles (once)
  if (!document.getElementById('ar-grid-style')) {
    const s = document.createElement('style');
    s.id = 'ar-grid-style';
    s.textContent = `
      .ar-month-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
      @media(max-width:900px){ .ar-month-grid { grid-template-columns:repeat(2,1fr); } }
      @media(max-width:560px){ .ar-month-grid { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(s);
  }

  content.innerHTML = `
    ${_arHeader(year, c)}
    ${_arSummaryRow(annual, c)}
    <div class="ar-month-grid">
      ${months.map((m, i) => _arMonthCard(m, MONTHS[i], c)).join('')}
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Header ────────────────────────────────────────────────────────────────────

function _arHeader(year, c) {
  const curYear = new Date().getFullYear();
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;
      flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <h2 style="font-size:1.2rem;font-weight:700;color:var(--text);margin:0;
          font-family:var(--font-display);letter-spacing:-.02em">
          Fluxo Anual &mdash; Contas a Pagar e a Receber
        </h2>
        <p style="font-size:.82rem;color:var(--text-muted);margin:4px 0 0">
          Visão consolidada mês a mês &middot; ${year}
        </p>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-ghost"
          onclick="renderAnnualReports(${year - 1})"
          aria-label="Ano anterior" title="Ano anterior">
          ${icon('chevron-left', 16)}
        </button>
        <span style="font-size:1rem;font-weight:700;color:var(--text);
          min-width:52px;text-align:center">${year}</span>
        <button class="btn btn-sm btn-ghost"
          onclick="renderAnnualReports(${year + 1})"
          aria-label="Próximo ano" title="Próximo ano">
          ${icon('chevron-right', 16)}
        </button>
        ${year !== curYear ? `
          <button class="btn btn-sm btn-secondary"
            onclick="renderAnnualReports(${curYear})">
            ${icon('calendar', 13)} Hoje
          </button>` : ''}
      </div>
    </div>`;
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function _arSummaryRow(annual, c) {
  const card = (label, value, bg, textColor, iname) => `
    <div style="background:${bg};border:1px solid ${c.border};
      border-radius:var(--r-lg);padding:14px 16px;min-width:0">
      <div style="display:flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;
        color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">
        ${icon(iname, 12)} ${label}
      </div>
      <div style="font-size:1.05rem;font-weight:700;color:${textColor};letter-spacing:-.01em">
        ${fmt(value)}
      </div>
    </div>`;

  const balCard = (label, value, iname) => `
    <div style="background:var(--surface);border:2px solid ${_arSC(value, c)};
      border-radius:var(--r-lg);padding:14px 16px;min-width:0">
      <div style="display:flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;
        color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">
        ${icon(iname, 12)} ${label}
      </div>
      <div style="font-size:1.05rem;font-weight:700;color:${_arSC(value, c)};letter-spacing:-.01em">
        ${fmt(value)}
      </div>
    </div>`;

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:10px;margin-bottom:24px">
      ${card('Total a Receber',  annual.a_receber,    c.receiver, c.saldoPos, 'arrow-down-circle')}
      ${card('Total a Pagar',    annual.a_pagar,      c.payer,    c.saldoNeg, 'arrow-up-circle')}
      ${card('Receb. Atrasados', annual.rec_atrasado, c.overdue,
             annual.rec_atrasado > 0 ? c.saldoNeg : c.saldoZero, 'clock')}
      ${card('Pagam. Atrasados', annual.pag_atrasado, c.overdue,
             annual.pag_atrasado > 0 ? c.saldoNeg : c.saldoZero, 'clock')}
      ${balCard('Saldo Anual Previsto',  annual.saldo_previsto,    'trending-up')}
      ${balCard('Saldo c/ Atrasos',      annual.saldo_com_atrasos, 'activity')}
    </div>`;
}

// ── Month card ────────────────────────────────────────────────────────────────

function _arMonthCard(m, monthName, c) {
  const sVal   = m.saldo_com_atrasos;
  const sBg    = sVal < 0 ? c.saldoNeg : (sVal > 0 ? c.receiver : 'var(--bg-subtle)');
  const sTxtC  = sVal < 0 ? '#fff'     : _arSC(sVal, c);
  const sLblC  = sVal < 0 ? 'rgba(255,255,255,.72)' : 'var(--text-muted)';

  const cell = (bg, label, val, col, br) => `
    <div style="padding:5px 6px;text-align:center;background:${bg};
      ${br ? `border-right:1px solid ${c.border};` : ''}">
      <div style="font-size:.55rem;font-weight:700;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="font-size:.76rem;font-weight:600;color:${col}">${fmt(val)}</div>
    </div>`;

  return `
    <div style="background:var(--surface);border:1px solid ${c.border};
      border-radius:var(--r-lg);overflow:hidden;
      box-shadow:0 1px 3px rgba(41,39,32,.05)">

      <!-- Header -->
      <div style="background:${c.cardHeader};display:flex;align-items:center;
        justify-content:space-between;padding:8px 11px">
        <span style="color:#fff;font-weight:700;font-size:.82rem;
          letter-spacing:.06em;text-transform:uppercase">${monthName}</span>
        <button
          class="btn btn-icon"
          style="width:24px;height:24px;color:rgba(255,255,255,.85);
            background:rgba(255,255,255,.15);border-radius:var(--r-sm);
            padding:0;flex-shrink:0"
          onclick="_arMonthDetail(${m.month})"
          title="Detalhes de ${monthName}"
          aria-label="Ver detalhes de ${monthName}">
          <i data-lucide="list" style="width:12px;height:12px;pointer-events:none"></i>
        </button>
      </div>

      <!-- 4 value columns -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);
        border-bottom:1px solid ${c.border}">
        ${cell(c.receiver,
               'A Receber', m.a_receber, c.saldoPos, true)}
        ${cell(c.payer,
               'A Pagar', m.a_pagar, c.saldoNeg, true)}
        ${cell(m.rec_atrasado > 0 ? c.overdue : c.receiver,
               'Rec. Atr.', m.rec_atrasado,
               m.rec_atrasado > 0 ? c.saldoNeg : c.saldoZero, true)}
        ${cell(m.pag_atrasado > 0 ? c.overdue : c.payer,
               'Pag. Atr.', m.pag_atrasado,
               m.pag_atrasado > 0 ? c.saldoNeg : c.saldoZero, false)}
      </div>

      <!-- Saldo row -->
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:7px 9px;border-right:1px solid ${c.border}">
          <div style="font-size:.6rem;color:var(--text-muted);text-transform:uppercase;
            letter-spacing:.04em;margin-bottom:2px">Saldo Previsto</div>
          <div style="font-size:.88rem;font-weight:700;color:${_arSC(m.saldo_previsto, c)}">
            ${fmt(m.saldo_previsto)}
          </div>
        </div>
        <div style="padding:7px 9px;background:${sBg};transition:background .2s">
          <div style="font-size:.6rem;color:${sLblC};text-transform:uppercase;
            letter-spacing:.04em;margin-bottom:2px">Saldo c/ Atrasos</div>
          <div style="font-size:.88rem;font-weight:700;color:${sTxtC}">
            ${fmt(sVal)}
          </div>
        </div>
      </div>
    </div>`;
}

// ── Month detail modal ────────────────────────────────────────────────────────

function _arMonthDetail(month) {
  if (!_arData) return;
  const mData = _arData.months.find(m => m.month === month);
  if (!mData) return;

  const monthName = MONTHS[month - 1];
  const c = _arColors();

  const sections = [
    { key: 'items_a_receber',    label: 'A Receber',              bg: c.receiver, col: c.saldoPos, iname: 'arrow-down-circle' },
    { key: 'items_a_pagar',      label: 'A Pagar',                bg: c.payer,    col: c.saldoNeg, iname: 'arrow-up-circle'   },
    { key: 'items_rec_atrasado', label: 'Recebimentos Atrasados', bg: c.overdue,  col: c.saldoNeg, iname: 'clock'             },
    { key: 'items_pag_atrasado', label: 'Pagamentos Atrasados',   bg: c.overdue,  col: c.saldoNeg, iname: 'clock'             },
  ];

  const renderSection = ({ key, label, bg, col, iname }) => {
    const items = mData[key] || [];
    const total = items.reduce((s, t) => s + t.amount, 0);

    return `
      <div style="background:${bg};border-radius:var(--r-md);
        padding:11px 13px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:${items.length ? '10px' : '0'}">
          ${icon(iname, 13)}
          <span style="font-size:.72rem;font-weight:700;letter-spacing:.06em;
            text-transform:uppercase;color:${col};flex:1">${label}</span>
          <span style="font-size:.8rem;font-weight:700;color:${col}">${fmt(total)}</span>
        </div>
        ${items.length === 0
          ? `<p style="font-size:.8rem;color:var(--text-muted);margin:6px 0 0">
               Nenhum lançamento neste período.</p>`
          : items.map(t => `
            <div style="background:var(--surface);border-radius:var(--r-sm);
              padding:9px 10px;margin-bottom:6px;
              box-shadow:0 1px 2px rgba(41,39,32,.06)">
              <div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">
                <div style="flex:1;min-width:0">
                  <div style="font-size:.84rem;font-weight:600;color:var(--text);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${_escHtml(t.name || '—')}
                  </div>
                  <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:5px;
                    align-items:center">
                    <span style="font-size:.7rem;padding:1px 7px;border-radius:10px;
                      font-weight:600;background:${t.category_color}22;
                      color:${t.category_color}">
                      ${_escHtml(t.category_icon)} ${_escHtml(t.category_name)}
                    </span>
                    ${t.account_name
                      ? `<span style="font-size:.7rem;color:var(--text-muted)">
                           ${icon('wallet',10)} ${_escHtml(t.account_name)}
                         </span>`
                      : ''}
                  </div>
                  <div style="margin-top:4px;font-size:.7rem;color:var(--text-muted);
                    display:flex;flex-wrap:wrap;gap:8px">
                    <span>Venc: ${fmtDate(t.due_date)}</span>
                    ${t.paid_date
                      ? `<span style="color:var(--income-text)">Pago: ${fmtDate(t.paid_date)}</span>`
                      : ''}
                  </div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:.92rem;font-weight:700;color:${col}">
                    ${fmt(t.amount)}
                  </div>
                  <div style="margin-top:3px">
                    ${statusBadge(t.status, t.due_date)}
                  </div>
                </div>
              </div>
            </div>`).join('')}
      </div>`;
  };

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:600px;width:calc(100% - 32px);
        max-height:90vh;display:flex;flex-direction:column">
        <!-- Modal header -->
        <div class="modal-header" style="flex-shrink:0;
          background:${c.cardHeader};border-radius:var(--r-lg) var(--r-lg) 0 0">
          <div class="modal-title" style="color:#fff">
            ${icon('calendar', 15)} Detalhes &mdash; ${_escHtml(monthName)} ${_arData.year}
          </div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()"
            style="color:rgba(255,255,255,.8)" aria-label="Fechar">
            ${icon('x', 16)}
          </button>
        </div>
        <!-- Modal body -->
        <div class="modal-body" style="overflow-y:auto;flex:1;padding-bottom:4px">
          ${sections.map(renderSection).join('')}
        </div>
        <!-- Modal footer -->
        <div class="modal-footer" style="flex-shrink:0">
          <button class="btn btn-secondary" onclick="closeModal()">Fechar</button>
        </div>
      </div>
    </div>
  `);
}
