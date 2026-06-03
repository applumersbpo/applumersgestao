async function renderAccounts() {
  const content = document.getElementById('content');
  const accounts = await db.accounts.toArray();
  const banks    = await db.banks.toArray();
  const banksMap = Object.fromEntries(banks.map(b => [b.id, b]));

  async function calcBalance(acc) {
    const txs = await db.transactions.filter(`account_id = '${acc.id}'`).toArray();
    const sum  = txs
      .filter(t => t.cash_date && t.cash_date <= new Date().toISOString().split('T')[0])
      .reduce((s, t) => s + (t.transaction_type === 'income' ? (t.amount || 0) : -(t.amount || 0)), 0);
    return (acc.initial_balance || 0) + sum;
  }

  const rows = await Promise.all(accounts.map(async a => {
    const bal  = await calcBalance(a);
    const bank = banksMap[a.bank_id] || null;
    return accountRow(a, bal, bank);
  }));

  content.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Contas Bancárias</div>
      <div style="display:flex;gap:8px">
        ${accounts.length > 10 ? `<button class="btn btn-sm btn-outline" onclick="toggleAccBulk()">${icon('check-square',14)} Selecionar</button>` : ''}
        <button class="btn btn-primary btn-sm" onclick="openAccountModal()">${icon('plus', 15)} Nova Conta</button>
      </div>
    </div>
    <div style="display:grid;gap:12px" id="accounts-list">
      ${rows.join('\n') || `
        <div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
          ${icon('landmark', 40)}
          <p style="margin-top:12px">Nenhuma conta cadastrada</p>
        </div>`}
    </div>
  `;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _bankLogoHtml(bank, bankName, size = 28) {
  // 1. Logo URL salvo no banco local
  const savedUrl = bank?.logo_url || '';
  // 2. Fallback: catálogo CDN pelo nome/código
  const catalogEntry = (typeof findBankInCatalog === 'function')
    ? findBankInCatalog(bank?.name || bankName, bank?.code || '')
    : null;
  const url = savedUrl || (catalogEntry && catalogEntry.logo_url) || '';
  if (url) {
    return `<img src="${url}" alt="${bank?.name || bankName || ''}"
              style="height:${size}px;width:auto;max-width:${size * 2.5}px;object-fit:contain;border-radius:4px"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <span style="display:none;font-weight:700;font-size:${Math.round(size * 0.55)}px">${(bank?.name || bankName || '?')[0].toUpperCase()}</span>`;
  }
  if (bank?.name || bankName) {
    return `<span style="font-weight:700;font-size:${Math.round(size * 0.55)}px">${(bank?.name || bankName)[0].toUpperCase()}</span>`;
  }
  return icon('building-2', size);
}

function accountRow(a, balance, bank) {
  const logoHtml = _bankLogoHtml(bank, a.bank_name, 28);
  const bankLabel = a.bank_name || bank?.name || '';
  const balColor  = balance >= 0 ? 'var(--income)' : 'var(--expense)';

  return `
    <div class="transaction-item" style="border-radius:10px;border:1px solid var(--border);padding:14px 16px">
      <div class="t-icon" style="background:var(--surface-2,#f4f4f5);color:var(--primary-600);display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;flex-shrink:0;overflow:hidden">
        ${logoHtml}
      </div>
      <div class="t-info" style="flex:1;min-width:0">
        <div class="t-name" style="font-weight:600">${a.name}</div>
        <div style="font-size:.82rem;color:var(--text-muted)">${bankLabel}</div>
        <div style="font-size:.88rem;font-weight:600;color:${balColor};margin-top:2px">${fmt(balance)}</div>
      </div>
      <div class="t-actions" style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm btn-outline" data-action="edit-acc" data-id="${a.id}" title="Editar">
          ${icon('pencil', 14)}
          <span class="btn-label-hide">Editar</span>
        </button>
        <button class="btn btn-sm btn-danger-outline" data-action="delete-acc" data-id="${a.id}" title="Excluir">
          ${icon('trash-2', 14)}
        </button>
      </div>
    </div>
  `;
}

// ── Actions ───────────────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'edit-acc') {
    const acc = await db.accounts.get(id);
    openAccountModal(acc);
  }
  if (action === 'delete-acc') {
    const used = await db.transactions.filter(`account_id = '${id}'`).count();
    if (used > 0) { toast('Esta conta possui transações. Remova-as antes.', 'error'); return; }
    if (!confirm('Excluir esta conta?')) return;
    await db.accounts.delete(id);
    toast('Conta excluída');
    renderAccounts();
  }

  // Bank picker inside modal
  if (action === 'pick-bank') {
    const bankId   = btn.dataset.bankId;
    const bankName = btn.dataset.bankName;
    const bankCode = btn.dataset.bankCode || '';
    const logoUrl  = btn.dataset.logoUrl  || '';

    document.getElementById('acc-bank-id').value    = bankId;
    document.getElementById('acc-bank-name').value  = bankName;
    document.getElementById('acc-bank-logo').value  = logoUrl;

    // Update preview
    const preview = document.getElementById('acc-bank-preview');
    if (preview) {
      const catalogEntry = (typeof findBankInCatalog === 'function')
        ? findBankInCatalog(bankName, bankCode)
        : null;
      const url = logoUrl || (catalogEntry && catalogEntry.logo_url) || '';
      preview.innerHTML = url
        ? `<img src="${url}" alt="${bankName}" style="height:28px;width:auto;object-fit:contain;border-radius:4px;margin-right:8px">
           <span style="font-weight:600">${bankName}</span>`
        : `<span style="font-weight:700;font-size:1.1rem;margin-right:8px">${bankName[0]}</span>
           <span style="font-weight:600">${bankName}</span>`;
    }

    // Close dropdown
    const dropdown = document.getElementById('acc-bank-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }
});

// ── Modal ─────────────────────────────────────────────────────────────────────
async function openAccountModal(data = null) {
  const isEdit = !!data;
  const banks  = await db.banks.toArray();

  // Resolve logo for each bank (catalog fallback)
  function bankEntryLogo(b) {
    if (b.logo_url) return b.logo_url;
    if (typeof findBankInCatalog === 'function') {
      const c = findBankInCatalog(b.name, b.code);
      return c ? c.logo_url : '';
    }
    return '';
  }

  const bankOptions = banks.map(b => {
    const logoUrl = bankEntryLogo(b);
    const logoImg = logoUrl
      ? `<img src="${logoUrl}" alt="${b.name}" style="height:22px;width:auto;max-width:52px;object-fit:contain;border-radius:3px;flex-shrink:0"
              onerror="this.style.display='none'">`
      : `<span style="font-weight:700;font-size:.9rem;width:22px;text-align:center;flex-shrink:0">${b.name[0]}</span>`;
    return `
      <div class="bank-pick-item" data-action="pick-bank"
           data-bank-id="${b.id}" data-bank-name="${b.name}"
           data-bank-code="${b.code || ''}" data-logo-url="${logoUrl}"
           style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-radius:6px;transition:background .12s">
        ${logoImg}
        <span style="font-size:.9rem">${b.name}</span>
        ${b.code ? `<span style="font-size:.75rem;color:var(--text-muted);margin-left:auto">${b.code}</span>` : ''}
      </div>`;
  }).join('');

  // Preview for currently selected bank
  let previewHtml = `<span style="color:var(--text-muted);font-size:.9rem">Selecione o banco</span>`;
  if (data?.bank_id) {
    const selBank = banks.find(b => b.id === data.bank_id);
    if (selBank) {
      const url = bankEntryLogo(selBank);
      previewHtml = url
        ? `<img src="${url}" alt="${selBank.name}" style="height:28px;width:auto;object-fit:contain;border-radius:4px;margin-right:8px">
           <span style="font-weight:600">${selBank.name}</span>`
        : `<span style="font-weight:700;font-size:1.1rem;margin-right:8px">${selBank.name[0]}</span>
           <span style="font-weight:600">${selBank.name}</span>`;
    }
  }

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${icon(isEdit ? 'pencil' : 'plus-circle', 18)} ${isEdit ? 'Editar Conta' : 'Nova Conta'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">

          <div class="form-group">
            <label class="form-label">Nome da conta</label>
            <input id="acc-name" class="form-control" value="${data?.name || ''}" placeholder="Ex: Conta Corrente, Nubank...">
          </div>

          <div class="form-group">
            <label class="form-label">Banco</label>
            <input type="hidden" id="acc-bank-id"   value="${data?.bank_id   || ''}">
            <input type="hidden" id="acc-bank-name" value="${data?.bank_name || ''}">
            <input type="hidden" id="acc-bank-logo" value="${data?.logo_url  || ''}">

            <div style="position:relative">
              <!-- Trigger -->
              <div id="acc-bank-trigger" onclick="toggleBankDropdown()"
                   style="display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;background:var(--surface);min-height:42px">
                <div id="acc-bank-preview" style="display:flex;align-items:center;flex:1">
                  ${previewHtml}
                </div>
                ${icon('chevron-down', 14)}
              </div>
              <!-- Dropdown -->
              <div id="acc-bank-dropdown" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
                   background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);
                   box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:100;max-height:260px;overflow:hidden;
                   display:flex;flex-direction:column">
                <div style="padding:8px;border-bottom:1px solid var(--border)">
                  <input id="acc-bank-search" class="form-control" placeholder="Buscar banco..." oninput="filterBankPicker(this.value)"
                         style="font-size:.85rem;padding:7px 10px">
                </div>
                <div id="acc-bank-list" style="overflow-y:auto;max-height:200px;padding:4px">
                  ${banks.length ? bankOptions : '<p style="padding:12px;color:var(--text-muted);font-size:.85rem">Nenhum banco cadastrado. Cadastre em #/banks.</p>'}
                </div>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Tipo</label>
              <select id="acc-type" class="form-control">
                <option value="checking" ${data?.type === 'checking' ? 'selected' : ''}>Conta Corrente</option>
                <option value="savings"  ${data?.type === 'savings'  ? 'selected' : ''}>Poupança</option>
              </select>
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Moeda</label>
              <input id="acc-currency" class="form-control" value="${data?.currency || 'BRL'}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Saldo inicial (R$)</label>
            <input id="acc-initial" class="form-control" type="number" step="0.01" value="${data?.initial_balance || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">Data do saldo inicial</label>
            <input id="acc-initial-date" class="form-control" type="date" value="${data?.initial_balance_date || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="acc-notes" class="form-control">${data?.notes || ''}</textarea>
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveAccount('${data?.id || ''}')">
            ${icon(isEdit ? 'save' : 'plus', 15)} ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);

  // Close dropdown when clicking outside
  setTimeout(() => {
    document.addEventListener('click', _closeBankDropdownOnOutside);
  }, 0);
}

function toggleBankDropdown() {
  const dd = document.getElementById('acc-bank-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none' && dd.style.display !== '';
  dd.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    const search = document.getElementById('acc-bank-search');
    if (search) { search.value = ''; filterBankPicker(''); search.focus(); }
  }
}

function _closeBankDropdownOnOutside(e) {
  const trigger  = document.getElementById('acc-bank-trigger');
  const dropdown = document.getElementById('acc-bank-dropdown');
  if (!dropdown || !trigger) { document.removeEventListener('click', _closeBankDropdownOnOutside); return; }
  if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
}

function filterBankPicker(q) {
  const list  = document.getElementById('acc-bank-list');
  if (!list) return;
  const items = list.querySelectorAll('.bank-pick-item');
  const lower = q.toLowerCase().trim();
  items.forEach(item => {
    const name = (item.dataset.bankName || '').toLowerCase();
    const code = (item.dataset.bankCode || '').toLowerCase();
    item.style.display = (!lower || name.includes(lower) || code.includes(lower)) ? '' : 'none';
  });
}

// ── Bulk ──────────────────────────────────────────────────────────────────────
function toggleAccBulk() {
  if (_Bulk.active) { destroyBulkMode(); return; }
  initBulkMode('accounts-list', `
    <button class="btn btn-sm btn-danger-outline" onclick="bulkAccDelete()">
      ${icon('trash-2',13)} Excluir
    </button>
  `);
}
async function bulkAccDelete() {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  for (const id of ids) {
    const used = await db.transactions.filter(`account_id = '${id}'`).count();
    if (used > 0) { toast('Uma ou mais contas possuem transações e não podem ser excluídas','error'); return; }
  }
  if (!confirm(`Excluir ${ids.length} conta(s)?`)) return;
  for (const id of ids) await db.accounts.delete(id);
  destroyBulkMode();
  toast(`${ids.length} conta(s) excluída(s)`,'success');
  renderAccounts();
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveAccount(id) {
  const name                = document.getElementById('acc-name').value.trim();
  const bank_id             = document.getElementById('acc-bank-id').value   || '';
  const bank_name           = document.getElementById('acc-bank-name').value || '';
  const logo_url            = document.getElementById('acc-bank-logo').value || '';
  const type                = document.getElementById('acc-type').value;
  const currency            = document.getElementById('acc-currency').value.trim() || 'BRL';
  const initial_balance     = parseFloat(document.getElementById('acc-initial').value) || 0;
  const initial_balance_date= document.getElementById('acc-initial-date').value || '';
  const notes               = document.getElementById('acc-notes').value || '';

  if (!name) { toast('Informe o nome da conta', 'error'); return; }

  const record = { name, bank_id, bank_name, logo_url, type, currency, initial_balance, initial_balance_date, notes };

  if (id) {
    await db.accounts.update(id, record);
    toast('Conta atualizada', 'success');
  } else {
    await db.accounts.add(record);
    toast('Conta criada', 'success');
  }
  document.removeEventListener('click', _closeBankDropdownOnOutside);
  closeModal();
  renderAccounts();
}
