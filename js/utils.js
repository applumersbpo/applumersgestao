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

function monthLabel(month, year) {
  return `${MONTHS[month - 1]} ${year}`;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function isOverdue(due_date, status) {
  if (status === 'paid') return false;
  return due_date < today();
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

function showModal(html) {
  const c = document.getElementById('modal-container');
  c.innerHTML = html;
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
