async function renderAdmin() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const [users, plans] = await Promise.all([
      pb.collection('users').getFullList({ fields: 'id,email,name,phone' }),
      pb.collection('user_plans').getFullList(),
    ]);

    const planByEmail = {};
    plans.forEach(p => { planByEmail[p.email] = p; });

    const comWpp    = users.filter(u => u.phone).length;
    const totalFees = plans.reduce((s, p) => s + (p.monthly_fee || 0), 0);
    // enriquece users com nome do user_plans
    users.forEach(u => { u._name = planByEmail[u.email]?.name || u.name || ''; });

    content.innerHTML = `
      <div class="summary-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:20px">
        <div class="summary-card">
          <div class="label">Total de usuários</div>
          <div class="value">${users.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">MRR</div>
          <div class="value">${fmt(totalFees)}</div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div class="card-title">Usuários</div>
          <span style="font-size:.8rem;color:var(--text-muted)">💬 ${comWpp} com WhatsApp</span>
        </div>
        ${users.length === 0
          ? '<p style="color:var(--text-muted);font-size:.9rem">Nenhum usuário cadastrado ainda.</p>'
          : `<div style="display:flex;flex-direction:column;gap:8px">
              ${users.map(u => adminUserRow(u, planByEmail[u.email])).join('')}
             </div>`
        }
      </div>
    `;
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

function adminUserRow(u, plan) {
  const displayName = u._name || u.name || u.email.split('@')[0];
  const initials = displayName[0].toUpperCase();
  const phone    = u.phone || '';
  const phoneFormatted = phone
    ? `+${phone.slice(0,2)} (${phone.slice(2,4)}) ${phone.slice(4,9)}-${phone.slice(9)}`
    : '—';
  return `
    <div class="transaction-item" style="gap:12px">
      <div class="t-icon" style="background:var(--primary-light);color:var(--primary);font-size:1rem;font-weight:700">
        ${initials}
      </div>
      <div class="t-info" style="min-width:0">
        <div class="t-name">${displayName || '—'}</div>
        <div class="t-meta">
          <span>${u.email}</span>
          <span style="color:${phone ? 'var(--income)' : 'var(--text-muted)'}">
            ${phone ? '💬' : '○'} ${phoneFormatted}
          </span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span style="font-size:.8rem;color:var(--text-muted)">R$</span>
        <input type="number" class="form-control" style="width:100px;text-align:right;padding:6px 10px"
          value="${plan?.monthly_fee || 0}" min="0" step="0.01" placeholder="0,00"
          onchange="updateUserFee('${u.email}', this.value)">
        ${phone ? `<button
          id="wpp-test-${u.id}"
          onclick="testWhatsApp('${u.id}', this)"
          style="background:none;border:none;cursor:pointer;padding:6px;color:var(--income);font-size:1.1rem;line-height:1"
          title="Testar conexão WhatsApp"
        >✅</button>` : ''}
        <button
          onclick="deleteAdminUser('${u.id}', '${u.email}')"
          style="background:none;border:none;cursor:pointer;padding:6px;color:var(--expense);font-size:1.1rem;line-height:1"
          title="Deletar usuário"
        >🗑</button>
      </div>
    </div>
  `;
}

async function deleteAdminUser(userId, email) {
  if (!confirm(`Deletar usuário ${email}?\n\nEsta ação é irreversível.`)) return;
  try {
    await pb.collection('users').delete(userId);
    try {
      const plans = await pb.collection('user_plans').getFullList({ filter: `email = "${email}"` });
      if (plans.length) await pb.collection('user_plans').delete(plans[0].id);
    } catch(_) {}
    toast('Usuário deletado!', 'success');
    renderAdmin();
  } catch(e) {
    toast('Erro ao deletar: ' + e.message, 'error');
  }
}

async function testWhatsApp(userId, btn) {
  const original = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const res = await _api('POST', `/admin/users/${userId}`, { action: 'test-whatsapp' });
    toast(`✅ Mensagem de teste enviada para ${res.phone}`, 'success');
    btn.textContent = '✅';
  } catch(e) {
    toast('Erro ao enviar teste: ' + (e.message || 'falha'), 'error');
    btn.textContent = original;
  } finally {
    btn.disabled = false;
  }
}

async function updateUserFee(email, value) {
  const fee = parseFloat(value) || 0;
  try {
    const plans = await pb.collection('user_plans').getFullList({ filter: `email = "${email}"` });
    if (plans.length) {
      await pb.collection('user_plans').update(plans[0].id, { monthly_fee: fee });
    } else {
      await pb.collection('user_plans').create({ email, monthly_fee: fee, active: true });
    }
    toast('Valor atualizado!', 'success');
  } catch(e) {
    toast('Erro ao salvar', 'error');
  }
}
