let reportChart = null;
let catChart = null;
let cashChart = null;
let compCaixaChart = null;
let _reportData = null; // cached for export
let _compCaixaData = null; // { year, competencia:[], caixa:[] } for Competência × Caixa tab
let _compCaixaRegime = 'competencia'; // current view of the Competência × Caixa tab

async function renderReports(month, year) {
  const content = document.getElementById('content');

  const [allTransactions, catsMap, accounts] = await Promise.all([
    db.transactions.filter(`year = ${year}`).toArray(),
    getCategoriesMap(),
    db.accounts.toArray()
  ]);

  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];
  const isIncome  = t => t.transaction_type === 'income';
  const isExpense = t => EXPENSE_TYPES.includes(t.transaction_type);

  // ── Regime helpers ──────────────────────────────────────────────────────────
  const parseYMD = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  };
  // Caixa (regime de caixa): valor efetivamente pago/recebido e data do pagamento
  const cashValue = t => (t.paid_amount || t.amount || 0);
  const cashYMD   = t => parseYMD(t.cash_date || t.paid_date);
  const cashMonth = t => { const p = cashYMD(t); return p ? p.month : null; };
  const cashYear  = t => { const p = cashYMD(t); return p ? p.year : null; };
  // Competência: data de competência (fallback t.month/due_date)
  const compMonth = t => { const p = parseYMD(t.competence_date); return p ? p.month : (t.month || null); };
  const isPaid    = t => t.status === 'paid';

  // ── Regime de COMPETÊNCIA (Visão Geral e Por Categoria) — todos os lançamentos
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const txs = allTransactions.filter(t => compMonth(t) === m);
    const income  = txs.filter(isIncome).reduce((s, t) => s + (t.amount || 0), 0);
    const expense = txs.filter(isExpense).reduce((s, t) => s + (t.amount || 0), 0);
    return { month: m, income, expense, balance: income - expense };
  });

  const currentTxs  = allTransactions.filter(t => compMonth(t) === month);
  const expenseTxs  = currentTxs.filter(isExpense);
  const totalExp    = expenseTxs.reduce((s, t) => s + (t.amount || 0), 0);
  const totalInc    = currentTxs.filter(isIncome).reduce((s, t) => s + (t.amount || 0), 0);

  const catTotals = {};
  expenseTxs.forEach(t => {
    const key = t.category_id || 'none';
    catTotals[key] = (catTotals[key] || 0) + (t.amount || 0);
  });

  const catEntries = Object.entries(catTotals)
    .map(([id, val]) => ({ cat: catsMap[id], val }))
    .sort((a, b) => b.val - a.val);

  // ── Regime de CAIXA (Fluxo de Caixa) — SOMENTE realizado (status==='paid'),
  // alocado por mês/ano do pagamento/recebimento (cash_date||paid_date)
  const cashMonthly = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const txs = allTransactions.filter(t => isPaid(t) && cashYear(t) === year && cashMonth(t) === m);
    const income  = txs.filter(isIncome).reduce((s, t) => s + cashValue(t), 0);
    const expense = txs.filter(isExpense).reduce((s, t) => s + cashValue(t), 0);
    return { month: m, income, expense, balance: income - expense };
  });

  const cashCurrent = allTransactions.filter(t => isPaid(t) && cashYear(t) === year && cashMonth(t) === month);
  const cashTotalInc = cashCurrent.filter(isIncome).reduce((s, t) => s + cashValue(t), 0);
  const cashTotalExp = cashCurrent.filter(isExpense).reduce((s, t) => s + cashValue(t), 0);

  // Saldo acumulado (regime de caixa)
  let running = 0;
  const cashFlowData = cashMonthly.map(d => {
    running += d.balance;
    return { ...d, cumulative: running };
  });

  // Cache for export (inclui ambos os regimes)
  _reportData = { month, year, allTransactions, catsMap, accounts, monthlyData, cashMonthly };
  // Cache for Competência × Caixa tab
  _compCaixaData = { year, competencia: monthlyData, caixa: cashMonthly };
  _compCaixaRegime = 'competencia';

  // Account breakdown for month — regime de CAIXA (somente realizado)
  const accBreakdown = accounts.map(acc => {
    const accTxs = cashCurrent.filter(t => t.account_id === acc.id);
    const inc = accTxs.filter(isIncome).reduce((s, t) => s + cashValue(t), 0);
    const exp = accTxs.filter(isExpense).reduce((s, t) => s + cashValue(t), 0);
    return { ...acc, inc, exp, net: inc - exp };
  }).filter(a => a.inc > 0 || a.exp > 0);

  content.innerHTML = `
    <div class="tabs" style="margin-bottom:20px">
      <div class="tab active" data-tab="overview"   onclick="switchReportTab('overview')">Visão Geral</div>
      <div class="tab"        data-tab="categories" onclick="switchReportTab('categories')">Por Categoria</div>
      <div class="tab"        data-tab="cashflow"   onclick="switchReportTab('cashflow')">Fluxo de Caixa</div>
      <div class="tab"        data-tab="compcaixa"  onclick="switchReportTab('compcaixa')">Competência × Caixa</div>
    </div>

    <!-- ── TAB: Visão Geral ── -->
    <div id="tab-overview">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-sm btn-outline" onclick="exportReportExcel()">
          ${icon('download', 14)} Exportar Excel
        </button>
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="section-header">
          <div class="section-title">Receita vs Despesa — ${year} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(competência)</span></div>
        </div>
        <div class="chart-container">
          <canvas id="main-chart"></canvas>
        </div>
      </div>

      <div class="summary-grid">
        ${monthlyData.map(d => `
          <div class="summary-card" style="${d.month === month ? 'border-color:var(--primary-600);box-shadow:0 0 0 2px var(--primary-100)' : ''}">
            <div class="label">${MONTHS[d.month - 1]}</div>
            <div style="font-size:.85rem;color:var(--income-text);font-weight:600">${fmt(d.income)}</div>
            <div style="font-size:.85rem;color:var(--expense);font-weight:600">${fmt(d.expense)}</div>
            <div style="font-size:.75rem;color:${d.balance >= 0 ? 'var(--income-text)' : 'var(--expense)'};margin-top:2px">
              ${d.balance >= 0 ? '+' : ''}${fmt(d.balance)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- ── TAB: Por Categoria ── -->
    <div id="tab-categories" style="display:none">
      <div class="card" style="margin-bottom:24px">
        <div class="section-header">
          <div class="section-title">Despesas por Categoria — ${MONTHS[month - 1]} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(competência)</span></div>
        </div>
        <div class="chart-container" style="height:240px">
          <canvas id="cat-chart"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Detalhamento</div>
        ${catEntries.length === 0 ? '<div class="empty-state" style="padding:24px"><p>Sem dados de despesa para este mês</p></div>' : `
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
          ${catEntries.map(({ cat, val }) => {
            const pct   = totalExp > 0 ? Math.round((val / totalExp) * 100) : 0;
            const color = cat?.color || '#ADA897';
            return `
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <span style="font-size:.875rem;font-weight:600;color:var(--text)">${cat ? (cat.icon + ' ' + cat.name) : 'Sem categoria'}</span>
                  <span style="font-size:.875rem;font-weight:600;color:var(--expense)">${fmt(val)} <span style="color:var(--text-soft);font-weight:400;font-size:.8rem">${pct}%</span></span>
                </div>
                <div class="progress-bar" style="margin-top:0">
                  <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>`}
      </div>
    </div>

    <!-- ── TAB: Fluxo de Caixa (regime de CAIXA — somente realizado) ── -->
    <div id="tab-cashflow" style="display:none">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-sm btn-outline" onclick="exportReportExcel('caixa')">
          ${icon('download', 14)} Exportar Excel
        </button>
      </div>
      <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
        <div class="summary-card income-card">
          <div class="label">Receita recebida no mês</div>
          <div class="value">${fmt(cashTotalInc)}</div>
        </div>
        <div class="summary-card expense-card">
          <div class="label">Despesa paga no mês</div>
          <div class="value">${fmt(cashTotalExp)}</div>
        </div>
        <div class="summary-card ${cashTotalInc - cashTotalExp >= 0 ? 'balance-positive' : 'balance-negative'}">
          <div class="label">Saldo do mês (caixa)</div>
          <div class="value">${fmt(cashTotalInc - cashTotalExp)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px">
          <div class="section-title">Saldo Acumulado — ${year} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(caixa — realizado)</span></div>
        </div>
        <div class="chart-container">
          <canvas id="cash-chart"></canvas>
        </div>
      </div>

      ${accBreakdown.length > 0 ? `
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Por Conta — ${MONTHS[month - 1]} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(caixa — realizado)</span></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${accBreakdown.map(a => {
            const netColor = a.net >= 0 ? 'var(--income-text)' : 'var(--expense)';
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-subtle);border-radius:var(--r-md)">
                <div style="font-weight:600;font-size:.9rem">${a.name}${a.bank_name ? ` <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">· ${a.bank_name}</span>` : ''}</div>
                <div style="display:flex;gap:16px;align-items:center">
                  <span style="font-size:.82rem;color:var(--income-text)">+${fmt(a.inc)}</span>
                  <span style="font-size:.82rem;color:var(--expense)">−${fmt(a.exp)}</span>
                  <span style="font-size:.88rem;font-weight:700;color:${netColor}">${a.net >= 0 ? '+' : ''}${fmt(a.net)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- ── TAB: Competência × Caixa ── -->
    <div id="tab-compcaixa" style="display:none">
      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px;flex-wrap:wrap;gap:12px">
          <div class="section-title">Competência × Caixa — ${year}</div>
          <div style="display:inline-flex;gap:4px;background:var(--bg-subtle);padding:4px;border-radius:var(--r-md)">
            <button class="btn btn-sm cc-toggle" data-ccview="competencia" onclick="switchCompCaixaView('competencia')" style="border:none">Competência</button>
            <button class="btn btn-sm cc-toggle" data-ccview="caixa" onclick="switchCompCaixaView('caixa')" style="border:none">Caixa (Pagamento/Recebimento)</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
          <div id="compcaixa-hint" style="font-size:.82rem;color:var(--text-muted)"></div>
          <button class="btn btn-sm btn-outline" onclick="exportCompCaixa()">
            ${icon('download', 14)} Exportar Excel
          </button>
        </div>
        <div class="chart-container" style="margin-bottom:20px">
          <canvas id="compcaixa-chart"></canvas>
        </div>
        <div class="summary-grid" id="compcaixa-summary"></div>
      </div>
    </div>
  `;

  renderMainChart(monthlyData, month);
  renderCatChart(catEntries, totalExp);
  renderCashChart(cashFlowData, month);
  renderCompCaixaView(_compCaixaRegime);
}

function renderMainChart(data, currentMonth) {
  if (reportChart) { reportChart.destroy(); reportChart = null; }
  const ctx = document.getElementById('main-chart')?.getContext('2d');
  if (!ctx) return;

  reportChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Receita',
          data: data.map(d => d.income),
          backgroundColor: 'rgba(58,90,64,.18)',
          borderColor: '#3A5A40',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Despesa',
          data: data.map(d => d.expense),
          backgroundColor: 'rgba(201,90,71,.18)',
          borderColor: '#C95A47',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true,
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 } }
        }
      }
    }
  });
}

function renderCatChart(entries, total) {
  if (catChart) { catChart.destroy(); catChart = null; }
  const ctx = document.getElementById('cat-chart')?.getContext('2d');
  if (!ctx || entries.length === 0) return;

  catChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e.cat ? e.cat.name : 'Outros'),
      datasets: [{
        data: entries.map(e => e.val),
        backgroundColor: entries.map(e => e.cat?.color || '#ADA897'),
        borderWidth: 2, borderColor: '#FFFFFF', hoverOffset: 8, hoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true, padding: 10,
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.parsed)} (${total > 0 ? Math.round(ctx.parsed / total * 100) : 0}%)`
          },
          titleFont: { family: "'Onest', system-ui, sans-serif" },
          bodyFont:  { family: "'Onest', system-ui, sans-serif" },
        }
      },
      cutout: '68%'
    }
  });
}

function renderCashChart(data, currentMonth) {
  if (cashChart) { cashChart.destroy(); cashChart = null; }
  const ctx = document.getElementById('cash-chart')?.getContext('2d');
  if (!ctx) return;

  const colors = data.map(d => d.cumulative >= 0 ? 'rgba(58,90,64,.7)' : 'rgba(201,90,71,.7)');

  cashChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Saldo acumulado',
          data: data.map(d => d.cumulative),
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('.7', '1')),
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          type: 'line',
          label: 'Resultado mensal',
          data: data.map(d => d.balance),
          borderColor: '#D4A24C',
          backgroundColor: 'rgba(212,162,76,.12)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          fill: false,
          yAxisID: 'y2',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true,
          }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          titleFont: { family: "'Onest', system-ui, sans-serif" },
          bodyFont:  { family: "'Onest', system-ui, sans-serif" },
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        y2: {
          position: 'right',
          ticks: {
            callback: v => 'R$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#D4A24C', font: { family: "'Onest', system-ui, sans-serif", size: 10 }
          },
          grid: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 } }
        }
      }
    }
  });
}

function switchReportTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tab-overview').style.display   = tab === 'overview'   ? '' : 'none';
  document.getElementById('tab-categories').style.display = tab === 'categories' ? '' : 'none';
  document.getElementById('tab-cashflow').style.display   = tab === 'cashflow'   ? '' : 'none';
  document.getElementById('tab-compcaixa').style.display  = tab === 'compcaixa'  ? '' : 'none';

  if (tab === 'categories') setTimeout(() => catChart?.resize(), 10);
  if (tab === 'cashflow')   setTimeout(() => cashChart?.resize(), 10);
  if (tab === 'compcaixa')  setTimeout(() => compCaixaChart?.resize(), 10);
}

// ── Competência × Caixa ───────────────────────────────────────────────────────

function switchCompCaixaView(regime) {
  _compCaixaRegime = regime;
  renderCompCaixaView(regime);
}

function renderCompCaixaView(regime) {
  if (!_compCaixaData) return;
  const data = _compCaixaData[regime] || [];

  // Toggle button states
  document.querySelectorAll('[data-ccview]').forEach(b => {
    const on = b.dataset.ccview === regime;
    b.style.background = on ? 'var(--primary-600)' : 'transparent';
    b.style.color      = on ? '#fff' : 'var(--text)';
    b.style.fontWeight = on ? '600' : '500';
  });

  const hint = document.getElementById('compcaixa-hint');
  if (hint) {
    hint.textContent = regime === 'caixa'
      ? 'Regime de caixa: somente lançamentos realizados (pagos/recebidos), por data de pagamento/recebimento.'
      : 'Regime de competência: todos os lançamentos (pagos e pendentes), por data de competência.';
  }

  const summary = document.getElementById('compcaixa-summary');
  if (summary) {
    summary.innerHTML = data.map(d => `
      <div class="summary-card">
        <div class="label">${MONTHS[d.month - 1]}</div>
        <div style="font-size:.85rem;color:var(--income-text);font-weight:600">${fmt(d.income)}</div>
        <div style="font-size:.85rem;color:var(--expense);font-weight:600">${fmt(d.expense)}</div>
        <div style="font-size:.75rem;color:${d.balance >= 0 ? 'var(--income-text)' : 'var(--expense)'};margin-top:2px">
          ${d.balance >= 0 ? '+' : ''}${fmt(d.balance)}
        </div>
      </div>
    `).join('');
  }

  renderCompCaixaChart(data);
}

function renderCompCaixaChart(data) {
  if (compCaixaChart) { compCaixaChart.destroy(); compCaixaChart = null; }
  const ctx = document.getElementById('compcaixa-chart')?.getContext('2d');
  if (!ctx) return;

  compCaixaChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Receita',
          data: data.map(d => d.income),
          backgroundColor: 'rgba(58,90,64,.18)',
          borderColor: '#3A5A40',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Despesa',
          data: data.map(d => d.expense),
          backgroundColor: 'rgba(201,90,71,.18)',
          borderColor: '#C95A47',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          type: 'line',
          label: 'Saldo',
          data: data.map(d => d.balance),
          borderColor: '#D4A24C',
          backgroundColor: 'rgba(212,162,76,.12)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true,
          }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          titleFont: { family: "'Onest', system-ui, sans-serif" },
          bodyFont:  { family: "'Onest', system-ui, sans-serif" },
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 } }
        }
      }
    }
  });
}

// ── Excel Export ──────────────────────────────────────────────────────────────

function exportReportExcel(regime = 'competencia') {
  if (!_reportData || typeof XLSX === 'undefined') {
    toast('Dados não disponíveis para exportar', 'error');
    return;
  }
  const { month, year, allTransactions, catsMap, accounts } = _reportData;
  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];
  const isIncome  = t => t.transaction_type === 'income';
  const isExpense = t => EXPENSE_TYPES.includes(t.transaction_type);
  const accMap = Object.fromEntries(accounts.map(a => [a.id, a]));

  const parseYMD = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  };

  const isCaixa = regime === 'caixa';
  let monthTxs, dateOf, valueOf, resumoRows, regimeLabel;

  if (isCaixa) {
    // Regime de CAIXA: somente realizado, por data de pagamento/recebimento
    const cashYMD = t => parseYMD(t.cash_date || t.paid_date);
    monthTxs = allTransactions.filter(t => {
      const p = cashYMD(t);
      return t.status === 'paid' && p && p.year === year && p.month === month;
    });
    dateOf  = t => t.cash_date || t.paid_date || '';
    valueOf = t => (t.paid_amount || t.amount || 0);
    resumoRows = (_reportData.cashMonthly || []).map(d => ({
      'Mês':     MONTHS[d.month - 1],
      'Receita': d.income,
      'Despesa': d.expense,
      'Saldo':   d.balance,
    }));
    regimeLabel = 'Caixa';
  } else {
    // Regime de COMPETÊNCIA: todos os lançamentos, por data de competência
    const compMonth = t => { const p = parseYMD(t.competence_date); return p ? p.month : (t.month || null); };
    monthTxs = allTransactions.filter(t => compMonth(t) === month);
    dateOf  = t => t.competence_date || t.due_date || '';
    valueOf = t => (t.amount || 0);
    resumoRows = _reportData.monthlyData.map(d => ({
      'Mês':     MONTHS[d.month - 1],
      'Receita': d.income,
      'Despesa': d.expense,
      'Saldo':   d.balance,
    }));
    regimeLabel = 'Competencia';
  }

  const incRows = monthTxs.filter(isIncome).map(t => ({
    'Data':       dateOf(t),
    'Descrição':  t.name,
    'Categoria':  catsMap[t.category_id]?.name || 'Sem categoria',
    'Conta':      accMap[t.account_id]?.name || '',
    'Valor':      valueOf(t),
    'Status':     t.status === 'paid' ? 'Recebido' : 'Pendente',
    'Observação': t.notes || '',
  }));

  const expRows = monthTxs.filter(isExpense).map(t => ({
    'Data':       dateOf(t),
    'Descrição':  t.name,
    'Categoria':  catsMap[t.category_id]?.name || 'Sem categoria',
    'Conta':      accMap[t.account_id]?.name || '',
    'Valor':      valueOf(t),
    'Status':     t.status === 'paid' ? 'Pago' : 'Pendente',
    'Observação': t.notes || '',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incRows),    'Receitas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows),    'Despesas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), 'Resumo Anual');

  const filename = `Lumers_${regimeLabel}_${year}_${String(month).padStart(2, '0')}_${MONTHS[month - 1]}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast(`Exportado: ${filename}`, 'success');
}

function exportCompCaixa() {
  exportReportExcel(_compCaixaRegime);
}
