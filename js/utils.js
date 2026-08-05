const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function fmt(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function parseBRNumber(str) {
  if (str === null || str === undefined || str === '') return 0;
  const s = String(str).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  const parts = s.split('.');
  if (parts.length > 1 && parts[parts.length - 1].length === 3) {
    return parseFloat(s.replace(/\./g, '')) || 0;
  }
  return parseFloat(s) || 0;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} | ${hh}:${min}`;
}

function monthLabel(month, year) {
  return `${MONTHS[month - 1]} ${year}`;
}

function today() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().split('T')[0];
}

function isOverdue(due_date, status) {
  if (status === 'paid') return false;
  return due_date < today();
}

/** Dias inteiros até o vencimento, sem efeito de fuso. 0=hoje, 1=amanhã, <0=vencida. */
function diasAteVencer(due_date) {
  if (!due_date) return null;
  return Math.round((Date.parse(due_date) - Date.parse(today())) / 86400000);
}

/** Rótulo de contagem regressiva: "vence hoje", "vence amanhã", "vence em N dias", "vencida". */
function labelVencimento(due_date) {
  const d = diasAteVencer(due_date);
  if (d === null) return '';
  if (d < 0)  return 'vencida';
  if (d === 0) return 'vence hoje';
  if (d === 1) return 'vence amanhã';
  return `vence em ${d} dias`;
}

function statusBadge(status, due_date) {
  if (status === 'paid') return '<span class="badge badge-paid">Pago</span>';
  if (isOverdue(due_date, status)) return '<span class="badge badge-overdue">Vencido</span>';
  return '<span class="badge badge-pending">Pendente</span>';
}

function kindBadge(kind) {
  return kind === 'fixed'
    ? '<span class="badge badge-fixed">Fixo</span>'
    : '<span class="badge badge-variable">Variável</span>';
}

function txTypeBadge(t) {
  if (t.transaction_type === 'installment')
    return '<span class="badge badge-installment">Parcelado</span>';
  if (t.template_id)
    return '<span class="badge badge-recurring">Recorrente</span>';
  return '';
}

// Badge indicando que o lançamento foi registrado pelo assistente via WhatsApp.
function waSourceBadge() {
  return '<span class="badge" style="background:#dcf8c6;color:#128c7e;margin-left:6px;font-size:.7rem;white-space:nowrap">WhatsApp</span>';
}

function catTag(cat) {
  if (!cat) return '';
  return `<span class="cat-tag" style="background:${cat.color}22;color:${cat.color}">${cat.icon || ''} ${cat.name}</span>`;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/** Gera HTML de ícone Lucide. Exemplo: icon('trash-2', 14) */
function icon(name, size = 16) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;flex-shrink:0;display:inline-flex"></i>`;
}

function showModal(html) {
  const c = document.getElementById('modal-container');
  c.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
  const backdrop = c.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', escHandler);
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
  document.removeEventListener('keydown', escHandler);
}

function escHandler(e) {
  if (e.key === 'Escape') closeModal();
}

/**
 * Modal de confirmação de exclusão no padrão Lumers Flow.
 * Detecta parcelamento (installment) e recorrência (template) e oferece
 * "Excluir apenas esta" vs "Excluir toda a série". Para lançamentos avulsos,
 * mostra uma confirmação simples. Substitui o confirm() nativo do navegador.
 * @param {object} t transação a excluir
 * @param {Function} onDeleted callback chamado após a exclusão bem-sucedida
 */
async function confirmDeleteTx(t, onDeleted) {
  const isInstallment = t.transaction_type === 'installment' && !!t.template_id;
  const isRecurring   = !!t.template_id && t.transaction_type !== 'installment';
  const isSeries      = isInstallment || isRecurring;
  const kindLabel     = t.transaction_type === 'income' ? 'receita' : 'despesa';
  const seriesLabel   = isInstallment ? 'parcelamento' : 'recorrência';

  const body = isSeries ? `
    <p style="margin:0 0 6px;color:var(--text)">Esta ${kindLabel} faz parte de um <strong>${seriesLabel}</strong>.</p>
    <p style="margin:0;color:var(--text-muted);font-size:.9rem">O que você deseja excluir?</p>
  ` : `
    <p style="margin:0;color:var(--text)">Tem certeza que deseja excluir <strong>${escapeHtml(t.name || 'este lançamento')}</strong>?</p>
  `;

  const footer = isSeries ? `
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-danger-outline" id="del-only-one">Excluir apenas esta</button>
    <button class="btn btn-danger" id="del-whole-series">Excluir todo o ${seriesLabel}</button>
  ` : `
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-danger" id="del-single">Excluir</button>
  `;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <div class="modal-title" style="display:flex;align-items:center;gap:8px">${icon('trash-2', 18)} Excluir ${kindLabel}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:8px">${footer}</div>
      </div>
    </div>
  `);

  if (isSeries) {
    document.getElementById('del-only-one').onclick = async () => {
      await _skipSeriesMonth(t, isInstallment);
      await db.transactions.delete(t.id);
      closeModal(); toast('Lançamento excluído'); onDeleted?.();
    };
    document.getElementById('del-whole-series').onclick = async () => {
      await _deleteWholeSeries(t, isInstallment);
      closeModal(); toast(`${isInstallment ? 'Parcelamento' : 'Recorrência'} excluído`); onDeleted?.();
    };
  } else {
    document.getElementById('del-single').onclick = async () => {
      await db.transactions.delete(t.id);
      closeModal(); toast('Excluído'); onDeleted?.();
    };
  }
}

// Marca o mês desta ocorrência como "pulado" no pai (parcelamento/recorrência),
// evitando que a regeneração automática recrie a linha excluída.
async function _skipSeriesMonth(t, isInstallment) {
  const coll = isInstallment ? db.installments : db.templates;
  const parent = await coll.get(t.template_id);
  if (!parent) return;
  const set = new Set(String(parent.skip_months || '').split(',').map(s => s.trim()).filter(Boolean));
  set.add(`${t.month}-${t.year}`);
  await coll.update(t.template_id, { skip_months: [...set].join(',') });
  if (typeof _generatedMonths !== 'undefined') _generatedMonths.delete(`${t.year}-${t.month}`);
}

// Exclui o pai (parcelamento/recorrência) + todas as ocorrências materializadas,
// impedindo a regeneração futura.
async function _deleteWholeSeries(t, isInstallment) {
  const filter = isInstallment
    ? `template_id = '${t.template_id}' && transaction_type = 'installment'`
    : `template_id = '${t.template_id}'`;
  const rows = await db.transactions.filter(filter).toArray();
  for (const r of rows) await db.transactions.delete(r.id);
  const coll = isInstallment ? db.installments : db.templates;
  try { await coll.delete(t.template_id); } catch {}
  if (typeof _generatedMonths !== 'undefined') _generatedMonths.clear();
}

/** Escapa caracteres HTML para evitar injeção. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Faz parse do CHANGELOG.md em uma lista de versões com suas categorias/itens. */
function parseChangelog(text) {
  const lines = text.split(/\r?\n/);
  const versions = [];
  let curVersion = null;
  let curCategory = null;

  for (const raw of lines) {
    const line = raw.trim();
    // Para ao atingir a seção de regras (não renderizar daqui em diante)
    if (/^##\s+Regra de Versionamento/i.test(line)) break;

    const verMatch = line.match(/^##\s+\[([^\]]+)\]\s*[—–-]\s*(.+)$/);
    if (verMatch) {
      curVersion = { version: verMatch[1].trim(), date: verMatch[2].trim(), categories: [] };
      versions.push(curVersion);
      curCategory = null;
      continue;
    }
    if (!curVersion) continue;

    const catMatch = line.match(/^###\s+(.+)$/);
    if (catMatch) {
      curCategory = { name: catMatch[1].trim(), items: [] };
      curVersion.categories.push(curCategory);
      continue;
    }

    const itemMatch = line.match(/^-\s+(.+)$/);
    if (itemMatch && curCategory) {
      curCategory.items.push(itemMatch[1].trim());
    }
  }
  return versions;
}

/** Abre um modal com o histórico de versões lido de /CHANGELOG.md. */
function openChangelogModal() {
  const bodyId = 'changelog-modal-body';
  showModal(`
    <div class="modal-backdrop"><div class="modal" style="max-width:560px">
      <div class="modal-header">
        <div class="modal-title">Histórico de versões</div>
        <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
      </div>
      <div class="modal-body" id="${bodyId}" style="max-height:80vh;overflow-y:auto">
        <p style="text-align:center;color:var(--text-muted);padding:20px 0">Carregando...</p>
      </div>
    </div></div>
  `);

  const colors = {
    'Adicionado': { bg: 'var(--income-light)',  fg: 'var(--income-text)' },
    'Melhorado':  { bg: 'var(--info-light)',    fg: 'var(--info-text)' },
    'Corrigido':  { bg: 'var(--warning-light)', fg: 'var(--warning-text)' },
    'Removido':   { bg: 'var(--expense-light)', fg: 'var(--expense-text)' },
  };

  fetch('/CHANGELOG.md')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(text => {
      const body = document.getElementById(bodyId);
      if (!body) return;
      const versions = parseChangelog(text);
      if (!versions.length) {
        body.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px 0">Nenhuma versão registrada.</p>`;
        return;
      }
      const html = versions.map(v => {
        const cats = v.categories.map(c => {
          const col = colors[c.name] || { bg: 'var(--surface-2,#f0f0f0)', fg: 'var(--text)' };
          const items = c.items.map(it => `<li style="margin:2px 0;line-height:1.45">${escapeHtml(it)}</li>`).join('');
          return `
            <div style="margin-top:10px">
              <span style="display:inline-block;font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:999px;background:${col.bg};color:${col.fg}">${escapeHtml(c.name)}</span>
              <ul style="margin:6px 0 0;padding-left:20px;font-size:.85rem;color:var(--text)">${items}</ul>
            </div>`;
        }).join('');
        return `
          <div style="border:1px solid var(--border,#e5e5e5);border-radius:var(--r-md,8px);padding:14px 16px;margin-bottom:14px;background:var(--surface,#fff)">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
              <strong style="font-size:1rem;color:var(--primary,#3A5A40)">${escapeHtml(v.version)}</strong>
              <span style="font-size:.78rem;color:var(--text-muted)">${escapeHtml(v.date)}</span>
            </div>
            ${cats}
          </div>`;
      }).join('');
      body.innerHTML = html;
    })
    .catch(() => {
      const body = document.getElementById(bodyId);
      if (body) {
        body.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px 0">Não foi possível carregar o histórico de versões.</p>`;
      }
    });
}

let _catsCache = null;
async function getCategoriesMap() {
  if (_catsCache) return _catsCache;
  const cats = await db.categories.toArray();
  _catsCache = Object.fromEntries(cats.map(c => [c.id, c]));
  return _catsCache;
}
function clearCatsCache() { _catsCache = null; }

const COLORS = [
  '#3A5A40','#C95A47','#D4A24C','#2A7C82','#165D62',
  '#4D7549','#A2AF8B','#8E3A30','#8A6418','#5D594E'
];

function colorPicker(selected, name = 'color') {
  return `<div class="color-options">${COLORS.map(c =>
    `<div class="color-dot ${c === selected ? 'selected' : ''}" style="background:${c}" data-color="${c}" data-name="${name}"></div>`
  ).join('')}</div>`;
}

// ── Bulk Selection ────────────────────────────────────────────────────────────
const _Bulk = {
  active: false,
  ids: new Set(),
  listId: null,
};

function initBulkMode(listId, actionButtons) {
  const list = document.getElementById(listId);
  if (!list) return;
  _Bulk.active = true;
  _Bulk.ids.clear();
  _Bulk.listId = listId;

  list.querySelectorAll('[data-id]').forEach(row => {
    if (row.querySelector('.bulk-cb-wrap')) return;
    const id = row.dataset.id;
    const wrap = document.createElement('label');
    wrap.className = 'bulk-cb-wrap';
    wrap.innerHTML = `<input type="checkbox" class="bulk-cb" data-id="${id}">`;
    wrap.addEventListener('click', e => { e.stopPropagation(); _bulkToggle(id); });
    row.insertBefore(wrap, row.firstChild);
  });

  let bar = document.getElementById('bulk-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulk-bar';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <label class="bulk-bar-sel-all">
      <input type="checkbox" id="bulk-cb-all" onchange="_bulkToggleAll(this.checked)">
      <span id="bulk-count-label">0 selecionados</span>
    </label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${actionButtons}
      <button class="btn btn-sm btn-ghost" onclick="destroyBulkMode()">Cancelar</button>
    </div>
  `;
  _bulkUpdateUI();
}

function _bulkToggle(id) {
  if (_Bulk.ids.has(id)) _Bulk.ids.delete(id);
  else _Bulk.ids.add(id);
  _bulkUpdateUI();
}

function _bulkToggleAll(checked) {
  const list = document.getElementById(_Bulk.listId);
  if (!list) return;
  list.querySelectorAll('[data-id]').forEach(row => {
    if (checked) _Bulk.ids.add(row.dataset.id);
    else _Bulk.ids.delete(row.dataset.id);
  });
  _bulkUpdateUI();
}

function _bulkUpdateUI() {
  const n = _Bulk.ids.size;
  const label = document.getElementById('bulk-count-label');
  if (label) label.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
  const allCb = document.getElementById('bulk-cb-all');
  const list = document.getElementById(_Bulk.listId);
  if (list) {
    const rows = list.querySelectorAll('[data-id]');
    const total = rows.length;
    rows.forEach(row => {
      const cb = row.querySelector('.bulk-cb');
      if (cb) cb.checked = _Bulk.ids.has(row.dataset.id);
      row.classList.toggle('bulk-selected', _Bulk.ids.has(row.dataset.id));
    });
    if (allCb) {
      allCb.checked = n > 0 && n === total;
      allCb.indeterminate = n > 0 && n < total;
    }
  }
}

function destroyBulkMode() {
  const list = document.getElementById(_Bulk.listId);
  if (list) {
    list.querySelectorAll('.bulk-cb-wrap').forEach(el => el.remove());
    list.querySelectorAll('[data-id]').forEach(row => row.classList.remove('bulk-selected'));
  }
  document.getElementById('bulk-bar')?.remove();
  _Bulk.active = false;
  _Bulk.ids.clear();
  _Bulk.listId = null;
}

function bindColorPicker(container, inputId) {
  container.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      container.querySelectorAll(`.color-dot[data-name="${dot.dataset.name}"]`).forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
      if (inputId) {
        const inp = container.querySelector(`#${inputId}`);
        if (inp) inp.value = dot.dataset.color;
      }
    });
  });
}

// Invalida o cache de "próximas contas" (estado vive em notifications.js).
// Definida em utils.js (carregado cedo) para uso compartilhado por expenses/income/bills (F-211).
function clearUpcomingCache() { _upcomingCache = null; }

// Modal compartilhado (despesa e receita) para confirmar data e valor ao marcar pago/recebido.
// Vive em utils.js (carregado antes de income.js/expenses.js) para evitar acoplamento frágil (F-211).
function openPayDateModal(tx, type, onDone) {
  const isExpense = type === 'expense';
  const t = today();
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <div class="modal-title">${isExpense ? 'Confirmar pagamento' : 'Confirmar recebimento'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">${isExpense ? 'Data do pagamento' : 'Data do recebimento'}</label>
            <input id="paydate-date" type="date" class="form-control" max="${t}" value="${t}">
          </div>
          <div class="form-group">
            <label class="form-label">${isExpense ? 'Valor pago' : 'Valor recebido'} (R$)</label>
            <input id="paydate-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${tx?.amount != null ? tx.amount : ''}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="paydate-confirm">Confirmar</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById('paydate-confirm').addEventListener('click', async () => {
    const dateVal = document.getElementById('paydate-date').value;
    if (!dateVal) { toast('Informe a data', 'error'); return; }
    if (dateVal > today()) { toast('Não é possível registrar um pagamento/recebimento com data superior à data de hoje.', 'error'); return; }
    // F-210: lê o input CRU para distinguir "vazio" (não-informado → usa amount) de
    // "0"/"0,00" digitado explicitamente (R$0 real). parseBRNumber('') e parseBRNumber('0')
    // retornam ambos 0, então o teste `amountVal > 0` mascarava o R$0 real — corrigido
    // lendo a string crua, alinhado à semântica dos saves de expenses.js/income.js.
    const paidAmountRaw = document.getElementById('paydate-amount').value.trim();
    const paid_amount = paidAmountRaw === '' ? (tx?.amount || 0) : parseBRNumber(paidAmountRaw);
    const upd = { status: 'paid', cash_date: dateVal, paid_date: dateVal, paid_amount };
    await db.transactions.update(tx.id, upd);
    clearUpcomingCache();
    closeModal();
    if (onDone) onDone(upd);
  });
}
