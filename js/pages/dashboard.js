async function renderDashboard(month, year) {
  window._currentPeriod = { month, year };
  const content = document.getElementById('content');

  const [transactions, catsMap, accounts, banks] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year}`).toArray(),
    getCategoriesMap(),
    db.accounts.toArray(),
    db.banks.toArray()
  ]);
  const banksMapById = Object.fromEntries(banks.map(b => [b.id, b]));

  const expenses   = transactions.filter(t => t.transaction_type === 'expense');
  const generalExp = transactions.filter(t => t.transaction_type === 'general' || t.transaction_type === 'daily');
  const incomes    = transactions.filter(t => t.transaction_type === 'income');
  const instTx     = transactions.filter(t => t.transaction_type === 'installment');

  const totalIncome   = incomes.reduce((s, t) => s + (t.amount || 0), 0);
  const totalExpense  = expenses.reduce((s, t) => s + (t.amount || 0), 0);
  const totalGeneral  = generalExp.reduce((s, t) => s + (t.amount || 0), 0);
  const instTotal     = instTx.reduce((s, t) => s + (t.amount || 0), 0);
  const instPaid      = instTx.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);

  const received  = incomes.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const expPaid   = expenses.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const expPending = totalExpense - expPaid;

  const recvPct = totalIncome > 0 ? Math.round((received / totalIncome) * 100) : 0;
  const expPct  = totalExpense > 0 ? Math.round((expPaid / totalExpense) * 100) : 0;

  // Simplified: saldo = receita − despesas (as requested)
  const saldoProjetado = totalIncome - totalExpense;
  const saldoReal      = received - expPaid;

  const projClass = saldoProjetado >= 0 ? 'balance-positive' : 'balance-negative';
  const realClass  = saldoReal >= 0 ? 'balance-positive' : 'balance-negative';

  const overdue   = expenses.filter(t => isOverdue(t.due_date, t.status));
  const upcoming  = expenses.filter(t => {
    if (t.status === 'paid') return false;
    const diff = (new Date(t.due_date) - new Date()) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  const _uid = (pb.authStore.model || pb.authStore.record)?.id || 'local';
  const revenueGoal = parseFloat(localStorage.getItem(`revenue_goal_${_uid}_${year}_${month}`) || '0');
  const rawGoalPct  = revenueGoal > 0 ? (totalIncome / revenueGoal) * 100 : 0;
  const goalPct     = Math.min(Math.round(rawGoalPct), 100);
  const goalReached = revenueGoal > 0 && totalIncome >= revenueGoal;

  const PHRASES = [
    "Cada real faturado é um passo rumo à liberdade financeira.",
    "Foco, consistência e disciplina constroem impérios.",
    "O sucesso é a soma de pequenas ações repetidas todos os dias.",
    "Você está construindo algo grande. Continue.",
    "Dinheiro é resultado. Valor entregue é a causa.",
    "Grandes resultados exigem grandes comprometimentos.",
    "Hoje é uma nova chance de superar o seu próprio recorde.",
    "A meta de hoje é o mínimo de amanhã.",
    "Trabalhe enquanto eles dormem. Aprenda enquanto eles relaxam.",
    "Seu esforço de hoje é o seu legado de amanhã.",
    "Consistência bate talento quando o talento não é consistente.",
    "Cada venda é uma prova de que você está no caminho certo.",
    "Pequenos progressos diários levam a grandes resultados.",
    "A disciplina de hoje é a conquista de amanhã.",
    "Sucesso não é sorte — é comprometimento diário.",
    "Quem controla o financeiro, controla o futuro.",
    "O caminho para a riqueza começa no controle dos números.",
    "Não espere a motivação — construa o hábito.",
    "Metas sem prazo são apenas sonhos. Execute.",
    "A riqueza é construída um dia, uma decisão de cada vez.",
    "Fature mais. Gaste menos. Invista sempre.",
    "O que você mede, você gerencia. Continue monitorando.",
    "Cada obstáculo financeiro tem uma solução — encontre-a.",
    "Seu melhor mês está sempre à frente, nunca atrás.",
    "A prosperidade não vem por acaso. Ela é planejada.",
    "Cada reais guardado hoje é uma opção de escolha amanhã.",
    "Transforme pressão em combustível. Você consegue.",
    "Os números não mentem — e os seus estão melhorando.",
    "Foque no que gera resultado. Elimine o que drena energia.",
    "O sucesso financeiro é um jogo de paciência e ação.",
    "Você já chegou até aqui. Não pare agora.",
  ];
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const phrase = PHRASES[dayOfYear % PHRASES.length];

  let goalColor, goalStatus, goalBorderColor;
  if (!revenueGoal) {
    goalColor = 'var(--text-soft)';
    goalBorderColor = 'var(--border)';
    goalStatus = 'Defina sua meta de receita mensal';
  } else if (goalReached) {
    goalColor = 'var(--income-text)';
    goalBorderColor = 'var(--income)';
    goalStatus = `Meta atingida! Superou em ${fmt(totalIncome - revenueGoal)}`;
  } else if (rawGoalPct >= 50) {
    goalColor = 'var(--warning-text)';
    goalBorderColor = 'var(--warning)';
    goalStatus = `Faltam ${fmt(revenueGoal - totalIncome)} para bater a meta`;
  } else {
    goalColor = 'var(--expense)';
    goalBorderColor = 'var(--expense)';
    goalStatus = `Faltam ${fmt(revenueGoal - totalIncome)} para bater a meta`;
  }

  // Coverage simplified to consider only despesas
  const totalCommitted = totalExpense;
  const coveragePct    = totalCommitted > 0 ? Math.min(Math.round((totalIncome / totalCommitted) * 100), 100) : 100;
  const gap            = totalCommitted - totalIncome;
  const coverOk        = gap <= 0;

  // Visão por Carteiras — cruzamento receita/despesa do mês por conta
  const accountsHTML = (() => {
    if (!accounts || accounts.length === 0) return '';
    const EXP_TYPES = ['expense', 'general', 'daily', 'installment'];
    const cards = accounts.map(acc => {
      const accTxs = transactions.filter(t => t.account_id === acc.id);
      const accIncome  = accTxs.filter(t => t.transaction_type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
      const accExpense = accTxs.filter(t => EXP_TYPES.includes(t.transaction_type)).reduce((s, t) => s + (t.amount || 0), 0);
      const accNet     = accIncome - accExpense;
      const netColor   = accNet >= 0 ? 'var(--income-text)' : 'var(--expense)';
      const bank       = banksMapById[acc.bank_id] || null;
      const catalog    = (typeof findBankInCatalog === 'function')
        ? findBankInCatalog(bank?.name || acc.bank_name, bank?.code || '')
        : null;
      const logoUrl = acc.logo_url || bank?.logo_url || (catalog && catalog.logo_url) || '';
      const logoHtml = logoUrl
        ? `<img src="${logoUrl}" alt="${acc.bank_name || ''}" style="width:32px;height:32px;object-fit:contain;border-radius:6px;padding:3px"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          + `<span style="display:none;width:32px;height:32px;border-radius:8px;background:var(--primary-100);color:var(--primary-700);align-items:center;justify-content:center;font-size:.85rem;font-weight:700">${(acc.bank_name || acc.name || '?')[0].toUpperCase()}</span>`
        : `<div style="width:32px;height:32px;border-radius:8px;background:var(--primary-100);color:var(--primary-700);display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700">${(acc.bank_name || acc.name || '?')[0].toUpperCase()}</div>`;
      return `
        <div style="border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;background:var(--surface)">
          <a href="#/accounts" class="acc-row acc-row-header">
            <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0">${logoHtml}</div>
            <div style="min-width:0;flex:1">
              <div style="font-size:.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${acc.name}</div>
              ${acc.bank_name ? `<div style="font-size:.72rem;color:var(--text-muted)">${acc.bank_name}</div>` : ''}
            </div>
            <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--text-soft);flex-shrink:0"></i>
          </a>
          <a href="#/income" class="acc-row acc-row-item" style="border-bottom:1px solid var(--border)">
            <span style="font-size:.78rem;color:var(--income-text);display:flex;align-items:center;gap:5px;font-weight:500">
              <i data-lucide="trending-up" style="width:11px;height:11px"></i>
              Receita
            </span>
            <span style="font-size:.85rem;font-weight:600;color:var(--income-text)">${fmt(accIncome)}</span>
          </a>
          <a href="#/expenses" class="acc-row acc-row-item" style="border-bottom:1px solid var(--border)">
            <span style="font-size:.78rem;color:var(--expense-text);display:flex;align-items:center;gap:5px;font-weight:500">
              <i data-lucide="trending-down" style="width:11px;height:11px"></i>
              Despesas
            </span>
            <span style="font-size:.85rem;font-weight:600;color:var(--expense)">${fmt(accExpense)}</span>
          </a>
          <div style="padding:9px 14px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.78rem;color:var(--text-muted);font-weight:500">Saldo do mês</span>
            <span style="font-size:.88rem;font-weight:700;color:${netColor}">${accNet >= 0 ? '+' : ''}${fmt(accNet)}</span>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px">
          <div class="section-title">Visão por Carteiras</div>
          <a href="#/accounts" class="btn btn-sm btn-ghost">Ver tudo →</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px">
          ${cards}
        </div>
      </div>`;
  })();

  content.innerHTML = `
    <!-- KPI Grid -->
    <div class="summary-grid">
      <div class="summary-card income-card">
        <div class="icon-wrap">
          <i data-lucide="trending-up" style="width:18px;height:18px"></i>
        </div>
        <div class="label">Receita</div>
        <div class="value">${fmt(totalIncome)}</div>
        <div class="sub">${fmt(received)} recebido · ${recvPct}%</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${recvPct}%;background:var(--income)"></div></div>
      </div>

      <div class="summary-card expense-card">
        <div class="icon-wrap">
          <i data-lucide="trending-down" style="width:18px;height:18px"></i>
        </div>
        <div class="label">Despesas</div>
        <div class="value">${fmt(totalExpense)}</div>
        <div class="sub">${fmt(expPaid)} pago · ${expPct}%</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${expPct}%;background:var(--expense)"></div></div>
      </div>

      <div class="summary-card ${projClass}">
        <div class="icon-wrap">
          <i data-lucide="calculator" style="width:18px;height:18px"></i>
        </div>
        <div class="label">Saldo Projetado</div>
        <div class="value">${fmt(saldoProjetado)}</div>
        <div class="sub">Receita − todas as saídas</div>
      </div>

      <div class="summary-card ${realClass}">
        <div class="icon-wrap">
          <i data-lucide="clock" style="width:18px;height:18px"></i>
        </div>
        <div class="label">Saldo Real</div>
        <div class="value">${fmt(saldoReal)}</div>
        <div class="sub">Recebido − o que saiu</div>
      </div>
    </div>

    <!-- Visão por Carteiras -->
    ${accountsHTML}

    <!-- Top categorias de despesa -->
    ${(() => {
      const EXPENSE_TYPES = ['expense', 'general', 'daily', 'installment'];
      const expTxs = transactions.filter(t => EXPENSE_TYPES.includes(t.transaction_type));
      if (expTxs.length === 0) return '';
      const catTotals = {};
      expTxs.forEach(t => {
        const key = t.category_id || 'none';
        catTotals[key] = (catTotals[key] || 0) + (t.amount || 0);
      });
      const topCats = Object.entries(catTotals)
        .map(([id, val]) => ({ cat: catsMap[id], val }))
        .sort((a, b) => b.val - a.val)
        .slice(0, 5);
      const maxVal = topCats[0]?.val || 1;
      return `
      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px">
          <div class="section-title">Top gastos por categoria</div>
          <a href="#/reports" class="btn btn-sm btn-ghost">Ver relatório →</a>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${topCats.map(({ cat, val }) => {
            const pct   = Math.round((val / maxVal) * 100);
            const color = cat?.color || '#ADA897';
            return `
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                  <span style="font-size:.85rem;font-weight:600;color:var(--text)">${cat ? (cat.icon + ' ' + cat.name) : '📦 Sem categoria'}</span>
                  <span style="font-size:.85rem;font-weight:600;color:var(--expense)">${fmt(val)}</span>
                </div>
                <div class="progress-bar" style="margin:0">
                  <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
    })()}

    <!-- Alertas inline -->
    ${totalGeneral > 0 ? `
    <div class="insight-card expense" style="margin-bottom:16px">
      <div class="insight-icon">
        <i data-lucide="receipt" style="width:16px;height:16px"></i>
      </div>
      <div class="insight-body">
        <div class="insight-heading">Gastos Gerais — ${fmt(totalGeneral)}</div>
        <div class="insight-desc">${generalExp.length} lançamento${generalExp.length !== 1 ? 's' : ''} · já incluído no Saldo</div>
      </div>
      <a href="#/expenses" class="btn btn-sm btn-ghost" style="flex-shrink:0;align-self:center">Ver</a>
    </div>` : ''}

    ${instTotal > 0 ? `
    <div class="insight-card info" style="margin-bottom:16px">
      <div class="insight-icon">
        <i data-lucide="credit-card" style="width:16px;height:16px"></i>
      </div>
      <div class="insight-body">
        <div class="insight-heading">Parcelas do Mês — ${fmt(instTotal)}</div>
        <div class="insight-desc">${fmt(instPaid)} pago · ${fmt(instTotal - instPaid)} pendente</div>
      </div>
      <a href="#/installments" class="btn btn-sm btn-ghost" style="flex-shrink:0;align-self:center">Ver</a>
    </div>` : ''}

    ${expPending > 0 ? `
    <div class="insight-card warn" style="margin-bottom:16px">
      <div class="insight-icon">
        <i data-lucide="alert-triangle" style="width:16px;height:16px"></i>
      </div>
      <div class="insight-body">
        <div class="insight-heading">Contas Pendentes — ${fmt(expPending)}</div>
        <div class="insight-desc">${expenses.filter(t => t.status !== 'paid').length} conta${expenses.filter(t => t.status !== 'paid').length !== 1 ? 's' : ''} em aberto</div>
      </div>
      <a href="#/expenses" class="btn btn-sm btn-ghost" style="flex-shrink:0;align-self:center">Ver</a>
    </div>` : ''}

    <!-- Meta de Receita -->
    <div class="card goal-revenue-card ${goalReached ? 'goal-reached' : ''}" style="margin-bottom:20px;border-color:${goalBorderColor}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="card-title">Meta de Receita</div>
          <div style="font-size:.9rem;font-weight:600;color:${goalColor};margin-top:2px">${goalStatus}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-family:var(--font-display);font-size:1.75rem;font-weight:500;color:${goalColor};line-height:1">${revenueGoal > 0 ? goalPct + '%' : '—'}</div>
            <div style="font-size:.72rem;color:var(--text-soft)">da meta</div>
          </div>
          <button onclick="openRevenueGoalModal()" class="btn btn-sm btn-ghost" style="padding:6px 8px;flex-shrink:0" title="Editar meta">
            <i data-lucide="pencil" style="width:14px;height:14px"></i>
          </button>
        </div>
      </div>
      <div class="progress-bar" style="height:8px;margin-bottom:10px">
        <div class="progress-fill ${goalReached ? 'goal-bar-celebrate' : ''}" style="width:${revenueGoal > 0 ? goalPct : 0}%;background:${goalColor}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:.78rem;color:var(--text-soft);flex-wrap:wrap;gap:4px">
        <span>Faturado: <strong style="color:var(--income-text)">${fmt(totalIncome)}</strong></span>
        <span>Meta: <strong style="color:${goalColor}">${revenueGoal > 0 ? fmt(revenueGoal) : 'Não definida'}</strong></span>
      </div>
      <div style="font-size:.8rem;color:var(--text-soft);font-style:italic;font-family:var(--font-display);border-top:1px solid var(--border);padding-top:10px;line-height:1.6">
        "${phrase}"
      </div>
      ${goalReached ? '<div class="goal-sparkles" aria-hidden="true"></div>' : ''}
    </div>

    <!-- Cobertura de Despesas -->
    <div class="card" style="margin-bottom:20px;border-color:${coverOk ? 'var(--income)' : 'var(--warning)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <div class="card-title">Cobertura de Despesas</div>
          <div style="font-size:.9rem;font-weight:600;color:${coverOk ? 'var(--income-text)' : 'var(--expense)'};margin-top:2px">
            ${coverOk
              ? `Sobra ${fmt(Math.abs(gap))} após cobrir os compromissos`
              : `Faltam ${fmt(gap)} para cobrir todas as despesas`
            }
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-display);font-size:1.75rem;font-weight:500;color:${coverOk ? 'var(--income-text)' : 'var(--expense)'};line-height:1">${coveragePct}%</div>
          <div style="font-size:.72rem;color:var(--text-soft)">do total coberto</div>
        </div>
      </div>
      <div class="progress-bar" style="height:8px">
        <div class="progress-fill" style="width:${coveragePct}%;background:${coverOk ? 'var(--income)' : 'var(--warning)'}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:.78rem;color:var(--text-soft);flex-wrap:wrap;gap:4px">
        <span>Receita: <strong style="color:var(--income-text)">${fmt(totalIncome)}</strong></span>
        <span>Compromissos: <strong style="color:var(--expense)">${fmt(totalCommitted)}</strong></span>
      </div>
    </div>

    ${overdue.length > 0 ? `
    <div class="card" style="border-color:var(--expense);margin-bottom:20px">
      <div class="section-header">
        <div class="section-title" style="color:var(--expense)">Contas Vencidas (${overdue.length})</div>
        <a href="#/expenses" class="btn btn-sm btn-ghost">Ver todas</a>
      </div>
      <div class="transaction-list">
        ${overdue.slice(0, 3).map(t => transactionRow(t, catsMap, false)).join('')}
      </div>
    </div>` : ''}

    ${upcoming.length > 0 ? `
    <div class="card" style="margin-bottom:20px">
      <div class="section-header">
        <div class="section-title">Vencem nos próximos 7 dias</div>
        <a href="#/expenses" class="btn btn-sm btn-ghost">Ver todas</a>
      </div>
      <div class="transaction-list">
        ${upcoming.slice(0, 5).map(t => transactionRow(t, catsMap, false)).join('')}
      </div>
    </div>` : ''}

    <!-- Últimas Movimentações -->
    <div class="card">
      <div class="section-header">
        <div class="section-title">Últimas Movimentações</div>
        <a href="#/expenses" class="btn btn-sm btn-ghost">Ver tudo →</a>
      </div>
      ${transactions.length === 0 ? `
        <div class="empty-state">
          <i data-lucide="file-text" style="width:40px;height:40px;opacity:.3"></i>
          <p>Nenhuma movimentação neste mês</p>
        </div>` : `
        <div class="transaction-list">
          ${transactions.slice(0, 8).map(t => transactionRow(t, catsMap, false)).join('')}
        </div>`
      }
    </div>
  `;
}

function openRevenueGoalModal() {
  const { month, year } = window._currentPeriod || {};
  const uid = (pb.authStore.model || pb.authStore.record)?.id || 'local';
  const goalKey = `revenue_goal_${uid}_${year}_${month}`;
  const current = parseFloat(localStorage.getItem(goalKey) || '0');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title">Meta de Receita</span>
        <button class="btn btn-icon btn-ghost" id="goal-modal-close" aria-label="Fechar">
          <i data-lucide="x" style="width:18px;height:18px"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Valor da meta mensal (R$)</label>
          <input id="goal-input" type="number" min="0" step="100" class="form-control" placeholder="Ex: 15000" value="${current > 0 ? current : ''}">
        </div>
        <p style="font-size:.8rem;color:var(--text-muted);margin:0">A barra fica vermelha até 50%, amarela de 50–99% e verde ao bater a meta.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="goal-modal-cancel">Cancelar</button>
        <button class="btn btn-primary" id="goal-modal-save">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const input = backdrop.querySelector('#goal-input');
  input.focus();

  backdrop.querySelector('#goal-modal-close').onclick =
  backdrop.querySelector('#goal-modal-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  backdrop.querySelector('#goal-modal-save').onclick = () => {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) {
      if (val === 0) localStorage.removeItem(goalKey);
      else localStorage.setItem(goalKey, val);
      backdrop.remove();
      if (month && year) renderDashboard(month, year);
    } else {
      input.style.borderColor = 'var(--expense)';
    }
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') backdrop.querySelector('#goal-modal-save').click(); });
}

function transactionRow(t, catsMap, showActions = true) {
  const cat = catsMap[t.category_id];
  const isExp = ['expense', 'installment', 'general', 'daily'].includes(t.transaction_type);
  const overdue = isOverdue(t.due_date, t.status);

  return `
    <div class="transaction-item" data-id="${t.id}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#f1f5f9'};color:${cat ? cat.color : '#94a3b8'}">
        ${cat ? (cat.icon || cat.name[0]) : '?'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          <span>${fmtDate(t.due_date)}</span>
          ${statusBadge(t.status, t.due_date)}
        </div>
      </div>
      <div class="t-amount ${isExp ? 'expense' : 'income'}">
        ${isExp ? '−' : '+'}${fmt(t.amount)}
      </div>
    </div>
  `;
}
