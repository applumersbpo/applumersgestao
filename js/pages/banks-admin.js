async function renderBanksAdmin() {
  const content = document.getElementById('content');
  const banks = await db.banks.toArray();

  content.innerHTML = `
    ${typeof _adminNavBar === 'function' ? _adminNavBar('banks') : ''}
    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Bancos (Admin)</div>
      <div style="display:flex;gap:8px">
        ${banks.length > 10 ? `<button class="btn btn-sm btn-outline" onclick="toggleBanksBulk()">${icon('check-square',14)} Selecionar</button>` : ''}
        <button class="btn btn-primary btn-sm" onclick="openBankModal()">
          <i data-lucide="plus" style="width:15px;height:15px"></i>
          Novo Banco
        </button>
      </div>
    </div>
    <div style="display:grid;gap:10px" id="banks-list">
      ${banks.length ? banks.map(b => bankRow(b)).join('') : `
        <div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
          <i data-lucide="landmark" style="width:40px;height:40px;opacity:.3;display:block;margin:0 auto 12px"></i>
          Nenhum banco cadastrado
        </div>
      `}
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function bankRow(b) {
  const pubIcon  = b.published ? 'eye-off'  : 'eye';
  const pubLabel = b.published ? 'Despublicar' : 'Publicar';
  const pubClass = b.published ? 'btn-warning' : 'btn-success';

  const catalogBank = (typeof findBankInCatalog === 'function')
    ? findBankInCatalog(b.name, b.code)
    : null;
  const logoUrl = b.logo_url || (catalogBank && catalogBank.logo_url) || '';
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${b.name}" style="height:28px;width:auto;object-fit:contain;border-radius:4px">`
    : `<i data-lucide="landmark" style="width:22px;height:22px"></i>`;

  return `
    <div class="transaction-item" data-id="${b.id}" style="border-radius:var(--r-lg);border:1px solid var(--border)">
      <div class="t-icon" style="background:var(--primary-50);color:var(--primary-600);font-size:1.1rem">
        ${logoHtml}
      </div>
      <div class="t-info">
        <div class="t-name">
          ${b.name}
          ${b.code ? `<small style="color:var(--text-soft);font-size:.8rem;margin-left:4px">(${b.code})</small>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <span style="
            display:inline-flex;align-items:center;gap:3px;
            font-size:.75rem;font-weight:500;padding:2px 8px;border-radius:99px;
            background:${b.published ? 'var(--income-bg,#d1fae5)' : 'var(--neutral-100)'};
            color:${b.published ? 'var(--income,#059669)' : 'var(--text-muted)'}
          ">
            <i data-lucide="${b.published ? 'check-circle-2' : 'clock'}" style="width:11px;height:11px"></i>
            ${b.published ? 'Publicado' : 'Pendente'}
          </span>
        </div>
      </div>
      <div class="t-actions" style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm btn-outline" data-action="toggle-pub" data-id="${b.id}" title="${pubLabel}">
          <i data-lucide="${pubIcon}" style="width:14px;height:14px"></i>
          <span class="btn-label-hide">${pubLabel}</span>
        </button>
        <button class="btn btn-sm btn-outline" data-action="edit-bank" data-id="${b.id}" title="Editar">
          <i data-lucide="pencil" style="width:14px;height:14px"></i>
          <span class="btn-label-hide">Editar</span>
        </button>
        <button class="btn btn-sm btn-danger-outline" data-action="delete-bank" data-id="${b.id}" title="Excluir">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>
  `;
}

// ── Actions ──────────────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const { action, id } = btn.dataset;

  if (action === 'edit-bank') {
    const b = await db.banks.get(id);
    openBankModal(b);
  }

  if (action === 'toggle-pub') {
    const b = await db.banks.get(id);
    const newPub = b.published ? 0 : 1;
    await db.banks.update(id, {
      published: newPub,
      approved_by: newPub ? (pb.authStore.model?.id || '') : '',
    });
    if (newPub) {
      const accounts = await db.accounts.toArray();
      for (const a of accounts.filter(ac => ac.bank_id === id)) {
        await db.accounts.update(a.id, { bank_name: b.name });
      }
    }
    toast(newPub ? 'Banco publicado' : 'Banco despublicado', 'success');
    renderBanksAdmin();
  }

  if (action === 'delete-bank') {
    if (!confirm('Excluir este banco? Esta ação não pode ser desfeita.')) return;
    await db.banks.delete(id);
    toast('Banco excluído', 'success');
    renderBanksAdmin();
  }
});

// ── Bulk ─────────────────────────────────────────────────────────────────────
function toggleBanksBulk() {
  if (_Bulk.active) { destroyBulkMode(); return; }
  initBulkMode('banks-list', `
    <button class="btn btn-sm btn-success" onclick="bulkBanksPublish(true)">
      ${icon('eye',13)} Publicar
    </button>
    <button class="btn btn-sm btn-warning" onclick="bulkBanksPublish(false)">
      ${icon('eye-off',13)} Despublicar
    </button>
    <button class="btn btn-sm btn-danger-outline" onclick="bulkBanksDelete()">
      ${icon('trash-2',13)} Excluir
    </button>
  `);
}
async function bulkBanksPublish(pub) {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  const userId = pb.authStore.model?.id || '';
  for (const id of ids) {
    await db.banks.update(id, { published: pub ? 1 : 0, approved_by: pub ? userId : '' });
  }
  destroyBulkMode();
  toast(`${ids.length} banco(s) ${pub ? 'publicado(s)' : 'despublicado(s)'}`,'success');
  renderBanksAdmin();
}
async function bulkBanksDelete() {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  if (!confirm(`Excluir ${ids.length} banco(s)? Esta ação não pode ser desfeita.`)) return;
  for (const id of ids) await db.banks.delete(id);
  destroyBulkMode();
  toast(`${ids.length} banco(s) excluído(s)`,'success');
  renderBanksAdmin();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
async function openBankModal(data = null) {
  const isEdit = !!data;
  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">
            <i data-lucide="${isEdit ? 'pencil' : 'plus-circle'}" style="width:18px;height:18px"></i>
            ${isEdit ? 'Editar Banco' : 'Novo Banco'}
          </div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">
            <i data-lucide="x" style="width:16px;height:16px"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input id="bank-name" class="form-control" value="${data?.name || ''}" placeholder="Ex: Nubank">
          </div>
          <div class="form-group">
            <label class="form-label">Código (opcional)</label>
            <input id="bank-code" class="form-control" value="${data?.code || ''}" placeholder="Ex: 260">
          </div>
          <div class="form-group">
            <label class="form-label">Logo URL / Base64</label>
            <input id="bank-logo" class="form-control" value="${data?.logo_url || ''}" placeholder="https://...">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="bank-notes" class="form-control" rows="3">${data?.notes || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveBank('${data?.id || ''}')">
            <i data-lucide="${isEdit ? 'save' : 'plus'}" style="width:15px;height:15px"></i>
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function importBankCatalog() {
  if (typeof BANKS_CATALOG === 'undefined') {
    toast('Catálogo não disponível', 'error');
    return;
  }
  const existing = await db.banks.toArray();
  const existingNames = new Set(existing.map(b => (b.name || '').toLowerCase().trim()));
  const existingCodes = new Set(existing.map(b => b.code).filter(Boolean));

  let added = 0;
  const userId = pb.authStore.model?.id || '';

  for (const entry of BANKS_CATALOG) {
    const nameKey = entry.name.toLowerCase().trim();
    if (existingNames.has(nameKey) || (entry.code && existingCodes.has(entry.code))) continue;
    await db.banks.add({
      name:       entry.name,
      code:       entry.code,
      logo_url:   entry.logo_url || '',
      notes:      '',
      published:  1,
      user_id:    userId,
      approved_by: userId,
    });
    added++;
  }

  if (added > 0) {
    toast(`${added} banco(s) importado(s) do catálogo`, 'success');
    renderBanksAdmin();
  } else {
    toast('Todos os bancos do catálogo já existem', 'info');
  }
}

async function saveBank(id) {
  const name     = document.getElementById('bank-name').value.trim();
  const code     = document.getElementById('bank-code').value.trim();
  const logo_url = document.getElementById('bank-logo').value.trim();
  const notes    = document.getElementById('bank-notes').value.trim();
  if (!name) { toast('Informe o nome do banco', 'error'); return; }

  const record = { name, code, logo_url, notes };
  if (id) {
    await db.banks.update(id, record);
    toast('Banco atualizado', 'success');
  } else {
    await db.banks.add({ ...record, published: 0, user_id: pb.authStore.model?.id || '' });
    toast('Banco criado (aguardando aprovação)', 'success');
  }
  closeModal();
  renderBanksAdmin();
}
