let _wealthCache = {};
let _wealthChart = null;

async function renderWealth() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
  try {
    const [summary, investments, assets] = await Promise.all([
      _api('GET', '/data/investments_summary').catch(() => ({})),
      db.investments.toArray(),
      db.assets.toArray()
    ]);
    _wealthCache = { summary: summary || {}, investments, assets };
    _renderWealthHtml(summary || {}, investments, assets);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><p>Erro ao carregar patrimônio.</p></div>`;
  }
}

function _renderWealthHtml(summary, investments, assets) {
  const content = document.getElementById('content');

  const invValue   = investments.reduce((s, i) => s + ((i.quantity || 0) * (i.current_price || 0)), 0);
  const assetsNet  = assets.reduce((s, a) => s + ((a.current_value || 0) - (a.debt_amount || 0)), 0);
  const totalDebts = assets.reduce((s, a) => s + (a.debt_amount || 0), 0);
  const netWorth   = invValue + assetsNet;

  // ── Distribuição por pilar ────────────────────────────────────────────────────
  const pilarMap = {};

  // Investimentos agrupados por classe
  investments.forEach(i => {
    const cls = i.asset_class || 'other';
    const val = (i.quantity || 0) * (i.current_price || 0);
    pilarMap[`inv_${cls}`] = (pilarMap[`inv_${cls}`] || 0) + val;
  });

  // Bens físicos agrupados por tipo
  assets.forEach(a => {
    const typ = a.asset_type || 'other';
    const val = a.current_value || 0;
    pilarMap[`ast_${typ}`] = (pilarMap[`ast_${typ}`] || 0) + val;
  });

  const pilarKeys = Object.keys(pilarMap).filter(k => pilarMap[k] > 0);
  const pilarTotal = pilarKeys.reduce((s, k) => s + pilarMap[k], 0);

  // Labels e cores dos pilares
  const _classLabels = { stock_br:'Ação BR', stock_us:'Ação EUA', fii:'FII', crypto:'Cripto', fixed_income:'Renda Fixa', fund:'Fundo', other:'Outro' };
  const _classColors = { stock_br:'#3A5A40', stock_us:'#2A7C82', fii:'#4D7549', crypto:'#D4A24C', fixed_income:'#165D62', fund:'#8A6418', other:'#ADA897' };
  const _typeLabels  = { real_estate:'Imóvel', vehicle:'Veículo', durable_good:'Bem Durável', other:'Outro' };
  const _typeColors  = { real_estate:'#3A5A40', vehicle:'#2A7C82', durable_good:'#D4A24C', other:'#8A6418' };

  function pilarLabel(k) {
    if (k.startsWith('inv_')) return _classLabels[k.slice(4)] || k.slice(4);
    return _typeLabels[k.slice(4)] || k.slice(4);
  }
  function pilarColor(k) {
    if (k.startsWith('inv_')) return _classColors[k.slice(4)] || '#888';
    return _typeColors[k.slice(4)] || '#888';
  }

  // ── Classes de investimentos para tabela ──────────────────────────────────────
  const invByClass = {};
  investments.forEach(i => {
    const cls = i.asset_class || 'other';
    if (!invByClass[cls]) invByClass[cls] = { label: _classLabels[cls] || cls, color: _classColors[cls] || '#888', items: [], value: 0 };
    invByClass[cls].items.push(i);
    invByClass[cls].value += (i.quantity || 0) * (i.current_price || 0);
  });

  content.innerHTML = `
    <div style="text-align:center;margin-bottom:24px;padding:24px 16px;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border)">
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Patrimônio Líquido Total</div>
      <div style="font-size:2.4rem;font-weight:800;font-family:'Spectral',Georgia,serif;color:var(--primary-600);line-height:1.1">${fmt(netWorth)}</div>
      <div style="font-size:.82rem;color:var(--text-muted);margin-top:6px">Atualizado em ${fmtDate(today())}</div>
    </div>

    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="summary-card income-card">
        <div class="label">Investimentos</div>
        <div class="value">${fmt(invValue)}</div>
        <div class="sub">${investments.length} ativo${investments.length !== 1 ? 's' : ''}</div>
        <a href="#/investments" style="font-size:.75rem;color:var(--income-text);margin-top:6px;display:inline-block">Ver carteira →</a>
      </div>
      <div class="summary-card">
        <div class="label">Patrimônio Físico</div>
        <div class="value">${fmt(assetsNet)}</div>
        <div class="sub">${assets.length} bem${assets.length !== 1 ? 's' : ''} (líquido)</div>
        <a href="#/assets" style="font-size:.75rem;color:var(--text-muted);margin-top:6px;display:inline-block">Ver bens →</a>
      </div>
      <div class="summary-card expense-card">
        <div class="label">Dívidas</div>
        <div class="value">${fmt(totalDebts)}</div>
        <div class="sub">vinculadas aos bens</div>
      </div>
    </div>

    ${pilarKeys.length > 0 ? `
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;margin-bottom:24px">
      <div style="min-width:220px;max-width:260px;flex-shrink:0;text-align:center">
        <canvas id="wealth-donut-chart" width="220" height="220"></canvas>
        <div id="wealth-chart-legend" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:5px 10px;justify-content:center"></div>
      </div>
      <div style="flex:1;min-width:240px">
        <div class="section-header" style="margin-bottom:12px">
          <div class="section-title">Distribuição</div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="font-size:.75rem;color:var(--text-muted)">
              <th style="text-align:left;padding:4px 8px">Categoria</th>
              <th style="text-align:right;padding:4px 8px">Valor</th>
              <th style="text-align:right;padding:4px 8px">%</th>
            </tr>
          </thead>
          <tbody>
            ${pilarKeys.sort((a,b) => pilarMap[b] - pilarMap[a]).map(k => {
              const pct = pilarTotal > 0 ? ((pilarMap[k] / pilarTotal) * 100).toFixed(1) : '0.0';
              const clr = pilarColor(k);
              return `
                <tr style="border-top:1px solid var(--border)">
                  <td style="padding:8px 8px;font-size:.85rem">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${clr};margin-right:6px;vertical-align:middle"></span>
                    ${pilarLabel(k)}
                  </td>
                  <td style="padding:8px 8px;text-align:right;font-size:.85rem;font-weight:600">${fmt(pilarMap[k])}</td>
                  <td style="padding:8px 8px;text-align:right;font-size:.85rem;color:var(--text-muted)">${pct}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--border)">
              <td style="padding:8px 8px;font-weight:700;font-size:.85rem">Total</td>
              <td style="padding:8px 8px;text-align:right;font-weight:700;font-size:.85rem">${fmt(pilarTotal)}</td>
              <td style="padding:8px 8px;text-align:right;font-size:.85rem;color:var(--text-muted)">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>` : ''}

    ${investments.length > 0 ? `
    <div class="section-header" style="margin-bottom:12px">
      <div class="section-title">Ativos Financeiros</div>
      <a href="#/investments" class="btn btn-sm btn-ghost">${icon('arrow-right', 14)} Ver tudo</a>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:24px">
      ${Object.values(invByClass).sort((a,b) => b.value - a.value).map(cls => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">
          <span style="width:10px;height:10px;border-radius:3px;background:${cls.color};flex-shrink:0;display:inline-block"></span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:.88rem">${cls.label}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">${cls.items.length} ativo${cls.items.length !== 1 ? 's' : ''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;font-size:.9rem">${fmt(cls.value)}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">${invValue > 0 ? ((cls.value / invValue) * 100).toFixed(1) : 0}%</div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    ${assets.length > 0 ? `
    <div class="section-header" style="margin-bottom:12px">
      <div class="section-title">Patrimônio Físico</div>
      <a href="#/assets" class="btn btn-sm btn-ghost">${icon('arrow-right', 14)} Ver tudo</a>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
      ${assets.map(a => {
        const _typeIcons  = { real_estate:'🏠', vehicle:'🚗', durable_good:'📦', other:'💎' };
        const _typeColorsL = { real_estate:'#3A5A40', vehicle:'#2A7C82', durable_good:'#D4A24C', other:'#8A6418' };
        const _typeLabelsL = { real_estate:'Imóvel', vehicle:'Veículo', durable_good:'Bem Durável', other:'Outro' };
        const clr   = _typeColorsL[a.asset_type] || '#888';
        const lbl   = _typeLabelsL[a.asset_type] || 'Outro';
        const ico   = a.icon || _typeIcons[a.asset_type] || '💎';
        const debt  = a.debt_amount || 0;
        const curVal = a.current_value || 0;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">
            <div style="width:32px;height:32px;border-radius:8px;background:${clr}22;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">${ico}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escHtml(a.name || '')}</div>
              <span class="badge" style="background:${clr}22;color:${clr};font-size:.68rem">${lbl}</span>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;font-size:.9rem">${fmt(curVal)}</div>
              ${debt > 0 ? `<div style="font-size:.75rem;color:var(--expense)">− ${fmt(debt)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>` : ''}

    ${(investments.length === 0 && assets.length === 0) ? `
    <div class="empty-state">
      ${icon('pie-chart', 48)}
      <p>Nenhum dado patrimonial encontrado</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px">
        <a href="#/investments" class="btn btn-primary btn-sm">${icon('trending-up',14)} Investimentos</a>
        <a href="#/assets" class="btn btn-sm btn-ghost">${icon('home',14)} Bens Físicos</a>
      </div>
    </div>` : ''}
  `;

  if (pilarKeys.length > 0) {
    _drawWealthChart(pilarKeys, pilarMap, pilarLabel, pilarColor);
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _drawWealthChart(keys, dataMap, labelFn, colorFn) {
  const canvas = document.getElementById('wealth-donut-chart');
  if (!canvas) return;
  if (_wealthChart) { _wealthChart.destroy(); _wealthChart = null; }

  const sorted = [...keys].sort((a, b) => dataMap[b] - dataMap[a]);
  const labels = sorted.map(labelFn);
  const values = sorted.map(k => dataMap[k]);
  const colors = sorted.map(colorFn);
  const total  = values.reduce((a, b) => a + b, 0);

  _wealthChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: 'var(--surface)' }] },
    options: {
      responsive: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)} (${total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0}%)`
          }
        }
      }
    }
  });

  const legend = document.getElementById('wealth-chart-legend');
  if (legend) {
    legend.innerHTML = sorted.map((k, i) => `
      <div style="display:flex;align-items:center;gap:4px;font-size:.72rem">
        <span style="width:9px;height:9px;border-radius:2px;background:${colors[i]};flex-shrink:0;display:inline-block"></span>
        <span style="color:var(--text-muted)">${labels[i]}</span>
      </div>
    `).join('');
  }
}
