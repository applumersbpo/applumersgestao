async function renderBanksAdmin() {
  const content = document.getElementById('content');
  const banks = await db.banks.toArray();

  content.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Bancos (Admin)</div>
      <button class="btn btn-primary btn-sm" onclick="openBankModal()">Novo Banco</button>
    </div>
    <div style="display:grid;gap:10px">
      ${banks.map(b => bankRow(b)).join('')}
    </div>
  `;
}

function bankRow(b) {
  return `
    <div class="transaction-item" style="border-radius:8px;border:1px solid var(--border)">
      <div class="t-icon" style="background:var(--primary-50);color:var(--primary-600);font-size:1.1rem">
        ${b.logo_url ? `<img src="${b.logo_url}" style="height:28px;object-fit:contain">` : '🏦'}
      </div>
      <div class="t-info">
        <div class="t-name">${b.name} ${b.code ? `<small style="color:var(--text-soft);font-size:.82rem">(${b.code})</small>` : ''}</div>
        <div style="font-size:.82rem;color:var(--text-muted)">${b.published ? 'Publicado' : 'Pendente'}</div>
      </div>
      <div class="t-actions" style="display:flex">
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit-bank" data-id="${b.id}">✎</button>
        <button class="btn btn-sm btn-icon" data-action="toggle-pub" data-id="${b.id}">${b.published ? 'Despublicar' : 'Publicar'}</button>
      </div>
    </div>
  `;
}

// Actions
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  if (btn.dataset.action === 'edit-bank') {
    const b = await db.banks.get(btn.dataset.id); openBankModal(b);
  }
  if (btn.dataset.action === 'toggle-pub') {
    const id = btn.dataset.id; const b = await db.banks.get(id);
    const newPub = b.published ? 0 : 1;
    await db.banks.update(id, { published: newPub, approved_by: newPub ? (pb.authStore.model?.id || '') : '' });
    toast('Atualizado'); renderBanksAdmin();
    // when admin updates bank details, propagate name/logo to accounts referencing it
    if (newPub) {
      const accounts = await db.accounts.toArray();
      for (const a of accounts.filter(ac => ac.bank_id === id)) {
        await db.accounts.update(a.id, { bank_name: b.name });
      }
    }
  }
});

async function openBankModal(data = null) {
  const isEdit = !!data;
  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Banco' : 'Novo Banco'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input id="bank-name" class="form-control" value="${data?.name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Código (opcional)</label>
            <input id="bank-code" class="form-control" value="${data?.code || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Logo URL / Base64</label>
            <input id="bank-logo" class="form-control" value="${data?.logo_url || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="bank-notes" class="form-control">${data?.notes || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveBank('${data?.id || ''}')">${isEdit ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  `);
}

async function saveBank(id) {
  const name = document.getElementById('bank-name').value.trim();
  const code = document.getElementById('bank-code').value.trim();
  const logo_url = document.getElementById('bank-logo').value.trim();
  const notes = document.getElementById('bank-notes').value.trim();
  if (!name) { toast('Informe o nome do banco', 'error'); return; }
  const record = { name, code, logo_url, notes };
  if (id) {
    await db.banks.update(id, record);
    toast('Banco atualizado', 'success');
  } else {
    // newly added banks by user are unpublished by default
    const newId = await db.banks.add({ ...record, published: 0, user_id: pb.authStore.model?.id || '' });
    toast('Banco criado (aguardando aprovação)', 'success');
  }
  closeModal(); renderBanksAdmin();
}
