let reportChart = null;
let catChart = null;
let cashChart = null;
let _reportData = null; // cached for export

async function renderReports(month, year) {
  const content = document.getElementById('content');

  const [allTransactions, catsMap, accounts] = await Promise.all([
    db.transactions.filter(`year = ${year}`).toArray(),
    getCategoriesMap(),
    db.accounts.toArray()
  ]);

  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];

  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const txs = allTransactions.filter(t => t.month === m);
    const income  = txs.filter(t => t.transaction_type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
    const expense = txs.filter(t => EXPENSE_TYPES.includes(t.transaction_type)).reduce((s, t) => s + (t.amount || 0), 0);
    return { month: m, income, expense, balance: income - expense };
  });

  const currentTxs  = allTransactions.filter(t => t.month === month);
  const expenseTxs  = currentTxs.filter(t => EXPENSE_TYPES.includes(t.transaction_type));
  const totalExp    = expenseTxs.reduce((s, t) => s + (t.amount || 0), 0);
  const totalInc    = currentTxs.filter(t => t.transaction_type === 'income').reduce((s, t) => s + (t.amount || 0), 0);

  const catTotals = {};
  expenseTxs.forEach(t => {
    const key = t.category_id || 'none';
    catTotals[key] = (catTotals[key] || 0) + (t.amount || 0);
  });

  const catEntries = Object.entries(catTotals)
    .map(([id, val]) => ({ cat: catsMap[id], val }))
    .sort((a, b) => b.val - a.val);

  // Acumulate balances for cash flow chart
  let running = 0;
  const cashFlowData = monthlyData.map(d => {
    running += d.balance;
    return { ...d, cumulative: running };
  });

  // Cache for export
  _reportData = { month, year, allTransactions, catsMap, accounts, monthlyData };

  // Account breakdown for month
  const accBreakdown = accounts.map(acc => {
    const accTxs = currentTxs.filter(t => t.account_id === acc.id);
    const inc = accTxs.filter(t => t.transaction_type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
    const exp = accTxs.filter(t => EXPENSE_TYPES.includes(t.transaction_type)).reduce((s, t) => s + (t.amount || 0), 0);
    return { ...acc, inc, exp, net: inc - exp };
  }).filter(a => a.inc > 0 || a.exp > 0);

  content.innerHTML = `
    <div class="tabs" style="margin-bottom:20px">
      <div class="tab active" data-tab="overview"   onclick="switchReportTab('overview')">Visão Geral</div>
      <div class="tab"        data-tab="categories" onclick="switchReportTab('categories')">Por Categoria</div>
      <div class="tab"        data-tab="cashflow"   onclick="switchReportTab('cashflow')">Fluxo de Caixa</div>
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
          <div class="section-title">Receita vs Despesa — ${year}</div>
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
          <div class="section-title">Despesas por Categoria — ${MONTHS[month - 1]}</div>
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

    <!-- ── TAB: Fluxo de Caixa ── -->
    <div id="tab-cashflow" style="display:none">
      <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
        <div class="summary-card income-card">
          <div class="label">Receita do mês</div>
          <div class="value">${fmt(totalInc)}</div>
        </div>
        <div class="summary-card expense-card">
          <div class="label">Despesa do mês</div>
          <div class="value">${fmt(totalExp)}</div>
        </div>
        <div class="summary-card ${totalInc - totalExp >= 0 ? 'balance-positive' : 'balance-negative'}">
          <div class="label">Saldo do mês</div>
          <div class="value">${fmt(totalInc - totalExp)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px">
          <div class="section-title">Saldo Acumulado — ${year}</div>
        </div>
        <div class="chart-container">
          <canvas id="cash-chart"></canvas>
        </div>
      </div>

      ${accBreakdown.length > 0 ? `
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Por Conta — ${MONTHS[month - 1]}</div>
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
  `;

  renderMainChart(monthlyData, month);
  renderCatChart(catEntries, totalExp);
  renderCashChart(cashFlowData, month);
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

  if (tab === 'categories') setTimeout(() => catChart?.resize(), 10);
  if (tab === 'cashflow')   setTimeout(() => cashChart?.resize(), 10);
}

// ── Excel Export ──────────────────────────────────────────────────────────────

function exportReportExcel() {
  if (!_reportData || typeof XLSX === 'undefined') {
    toast('Dados não disponíveis para exportar', 'error');
    return;
  }
  const { month, year, allTransactions, catsMap, accounts } = _reportData;
  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];
  const accMap = Object.fromEntries(accounts.map(a => [a.id, a]));

  const monthTxs = allTransactions.filter(t => t.month === month);

  const incRows = monthTxs
    .filter(t => t.transaction_type === 'income')
    .map(t => ({
      'Data':       t.due_date,
      'Descrição':  t.name,
      'Categoria':  catsMap[t.category_id]?.name || 'Sem categoria',
      'Conta':      accMap[t.account_id]?.name || '',
      'Valor':      t.amount,
      'Status':     t.status === 'paid' ? 'Recebido' : 'Pendente',
      'Observação': t.notes || '',
    }));

  const expRows = monthTxs
    .filter(t => EXPENSE_TYPES.includes(t.transaction_type))
    .map(t => ({
      'Data':       t.due_date,
      'Descrição':  t.name,
      'Categoria':  catsMap[t.category_id]?.name || 'Sem categoria',
      'Conta':      accMap[t.account_id]?.name || '',
      'Valor':      t.amount,
      'Status':     t.status === 'paid' ? 'Pago' : 'Pendente',
      'Observação': t.notes || '',
    }));

  const resumoRows = _reportData.monthlyData.map(d => ({
    'Mês':     MONTHS[d.month - 1],
    'Receita': d.income,
    'Despesa': d.expense,
    'Saldo':   d.balance,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incRows),    'Receitas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows),    'Despesas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), 'Resumo Anual');

  const filename = `Lumers_${year}_${String(month).padStart(2, '0')}_${MONTHS[month - 1]}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast(`Exportado: ${filename}`, 'success');
}
