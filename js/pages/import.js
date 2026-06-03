function renderImport() {
  const content = document.getElementById('content');

  content.innerHTML = `
    <div id="import-tab-sheet">
      <div class="card" style="margin-bottom:20px;background:var(--primary-light);border-color:var(--primary)">
        <p style="font-size:.88rem;color:var(--primary-dark)">
          <strong>Como importar:</strong> Faça upload de um arquivo <strong>.xlsx</strong> ou <strong>.csv</strong>.
          O app vai ler as colunas e você mapeia cada uma para o campo correto antes de confirmar.
        </p>
      </div>

      <div class="card" style="margin-bottom:24px">
        <div class="section-title" style="margin-bottom:16px">Upload da Planilha</div>
        <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
          <i data-lucide="upload" style="width:48px;height:48px;opacity:.4"></i>
          <p>Arraste o arquivo aqui ou <strong>clique para selecionar</strong></p>
          <p style="font-size:.78rem;margin-top:4px;color:var(--text-light)">.xlsx, .xls, .csv</p>
        </div>
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleFileSelect(this)">
      </div>
      <div id="import-preview"></div>
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
  const zone = document.getElementById('drop-zone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) processImportFile(file);
    });
  }
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length < 2) { toast('Planilha vazia ou sem dados', 'error'); return; }

      const headers = rows[0].map(h => String(h).trim());
      const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''));

      showImportMapper(headers, dataRows);
    } catch (err) {
      toast('Erro ao ler o arquivo. Verifique o formato.', 'error');
    }
  };
  reader.readAsBinaryString(file);
}

async function showImportMapper(headers, rows) {
  const preview = document.getElementById('import-preview');
  const cats = await db.categories.toArray();

  const fields = [
    { value: '',             label: '— Ignorar —' },
    { value: 'name',         label: 'Nome / Descrição *' },
    { value: 'amount',       label: 'Valor *' },
    { value: 'due_date',     label: 'Data' },
    { value: 'category',     label: 'Categoria (nome)' },
    { value: 'kind',         label: 'Tipo (fixo/variável)' },
    { value: 'status',       label: 'Status (pago/pendente)' },
    { value: 'notes',        label: 'Observações' },
  ];

  const autoMap = headers.map(h => {
    const hl = h.toLowerCase();
    if (/nome|descri|title/i.test(hl))      return 'name';
    if (/valor|value|amount|preço/i.test(hl)) return 'amount';
    if (/data|date|venc/i.test(hl))          return 'due_date';
    if (/categ/i.test(hl))                   return 'category';
    if (/tipo|kind|fixo/i.test(hl))          return 'kind';
    if (/status|pago|paid/i.test(hl))        return 'status';
    if (/obs|note/i.test(hl))               return 'notes';
    return '';
  });

  preview.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="section-title" style="margin-bottom:16px">Mapeamento de Colunas</div>
      <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:16px">
        ${rows.length} linha(s) encontrada(s). Associe cada coluna da planilha ao campo do app.
      </p>
      <div style="display:grid;gap:10px">
        ${headers.map((h, i) => `
          <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px">
            <div style="font-size:.85rem;font-weight:600;background:var(--bg);padding:8px 12px;border-radius:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h || `Coluna ${i + 1}`}</div>
            <i data-lucide="arrow-right" style="width:16px;height:16px;color:var(--text-muted)"></i>
            <select class="form-control col-map" data-col="${i}">
              ${fields.map(f => `<option value="${f.value}" ${autoMap[i] === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="section-title" style="margin-bottom:16px">Configurações da Importação</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tipo de Transação</label>
          <select id="imp-type" class="form-control">
            <option value="expense">Despesa (Contas a Pagar)</option>
            <option value="income">Receita</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Categoria Padrão (se não mapeada)</label>
          <select id="imp-default-cat" class="form-control">
            <option value="">Sem categoria</option>
            ${cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="section-title" style="margin-bottom:12px">Preview (primeiras 5 linhas)</div>
      <div style="overflow-x:auto">
        <table style="width:100%;font-size:.8rem;border-collapse:collapse">
          <thead>
            <tr>${headers.map(h => `<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.slice(0, 5).map(r => `<tr>${r.map(c => `<td style="padding:8px;border-bottom:1px solid var(--border);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis">${c}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn btn-ghost" onclick="renderImport()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmImport(${JSON.stringify(rows).replace(/"/g, '&quot;')}, ${JSON.stringify(headers).replace(/"/g, '&quot;')})">
        Importar ${rows.length} linha(s)
      </button>
    </div>
  `;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function confirmImport(rows, headers) {
  const mapping = {};
  document.querySelectorAll('.col-map').forEach(sel => {
    if (sel.value) mapping[sel.value] = parseInt(sel.dataset.col);
  });

  if (mapping.name === undefined) { toast('Mapeie a coluna de Nome/Descrição', 'error'); return; }
  if (mapping.amount === undefined) { toast('Mapeie a coluna de Valor', 'error'); return; }

  const type       = document.getElementById('imp-type').value;
  const defaultCat = parseInt(document.getElementById('imp-default-cat').value) || null;
  const cats       = await db.categories.toArray();
  const catByName  = Object.fromEntries(cats.map(c => [c.name.toLowerCase(), c.id]));

  const today_str = today();
  const records   = [];
  let skipped     = 0;

  for (const row of rows) {
    const name = String(row[mapping.name] ?? '').trim();
    if (!name) { skipped++; continue; }

    const rawAmount = row[mapping.amount] ?? 0;
    const amount    = parseFloat(String(rawAmount).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

    let due_date = today_str;
    if (mapping.due_date !== undefined) {
      const raw = row[mapping.due_date];
      if (raw instanceof Date) {
        due_date = raw.toISOString().split('T')[0];
      } else if (raw) {
        const parsed = parseDateStr(String(raw));
        if (parsed) due_date = parsed;
      }
    }

    const [y, m] = due_date.split('-').map(Number);

    let category_id = defaultCat;
    if (mapping.category !== undefined) {
      const catName = String(row[mapping.category] ?? '').trim().toLowerCase();
      if (catByName[catName]) category_id = catByName[catName];
    }

    let kind = 'variable';
    if (mapping.kind !== undefined) {
      const k = String(row[mapping.kind] ?? '').toLowerCase();
      if (/fix/.test(k)) kind = 'fixed';
    }

    let status = 'pending';
    if (mapping.status !== undefined) {
      const s = String(row[mapping.status] ?? '').toLowerCase();
      if (/pago|paid|sim|yes|1/.test(s)) status = 'paid';
    }

    const notes = mapping.notes !== undefined ? String(row[mapping.notes] ?? '').trim() : '';

    records.push({
      template_id: null,
      name,
      category_id,
      transaction_type: type,
      kind,
      amount,
      due_date,
      paid_date: status === 'paid' ? due_date : null,
      status,
      month: m,
      year: y,
      notes
    });
  }

  if (records.length === 0) { toast('Nenhum registro válido encontrado', 'error'); return; }

  await db.transactions.bulkAdd(records);
  toast(`${records.length} registro(s) importado(s)!${skipped ? ` (${skipped} ignorado(s))` : ''}`, 'success');
  renderImport();
}

function parseDateStr(str) {
  const s = str.trim();
  const dmY = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmY) {
    const [, d, m, y] = dmY;
    const year = y.length === 2 ? '20' + y : y;
    return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

function switchImportTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('import-tab-sheet').style.display = tab === 'sheet' ? '' : 'none';
}

async function scanLocalDatabase() {
  const statusEl = document.getElementById('migration-status');
  statusEl.innerHTML = '<p style="color:var(--text-muted)">Procurando banco de dados local...</p>';

  try {
    const dbs = await indexedDB.databases();
    let found = null;

    for (const dbInfo of dbs) {
      const data = await _readIDB(dbInfo.name);
      if (data.categories || data.transactions) {
        found = { name: dbInfo.name, data };
        break;
      }
    }

    if (!found) {
      statusEl.innerHTML = '<p style="color:var(--expense)">Nenhum banco de dados encontrado nesta origem. Abra esta página em localhost:3000.</p>';
      return;
    }

    const cats = found.data.categories || [];
    const tpls = found.data.templates  || [];
    const txs  = found.data.transactions || [];
    window._migrationData = { cats, tpls, txs };

    statusEl.innerHTML = `
      <div class="card" style="margin-top:4px">
        <div class="card-title" style="margin-bottom:12px">Dados encontrados — ${found.name}</div>
        <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
          <div class="summary-card"><div class="label">Categorias</div><div class="value">${cats.length}</div></div>
          <div class="summary-card"><div class="label">Recorrências</div><div class="value">${tpls.length}</div></div>
          <div class="summary-card income-card"><div class="label">Transações</div><div class="value">${txs.length}</div></div>
        </div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="runMigration()">
          Migrar tudo para minha conta
        </button>
      </div>
    `;
  } catch(e) {
    statusEl.innerHTML = `<p style="color:var(--expense)">Erro: ${e.message}</p>`;
  }
}

function _readIDB(name) {
  return new Promise(resolve => {
    const req = indexedDB.open(name);
    req.onerror = () => resolve({});
    req.onsuccess = e => {
      const db = e.target.result;
      const stores = Array.from(db.objectStoreNames);
      const result = {};
      let pending = stores.length;
      if (!pending) { resolve(result); return; }
      for (const store of stores) {
        try {
          const getAllReq = db.transaction(store, 'readonly').objectStore(store).getAll();
          getAllReq.onsuccess = ev => { result[store] = ev.target.result; if (!--pending) resolve(result); };
          getAllReq.onerror  = ()  => { if (!--pending) resolve(result); };
        } catch { if (!--pending) resolve(result); }
      }
    };
  });
}

async function runMigration() {
  const { cats, tpls, txs } = window._migrationData || {};
  const statusEl = document.getElementById('migration-status');
  statusEl.innerHTML = '<p style="color:var(--text-muted)">Migrando... aguarde.</p>';

  const catIdMap = {};
  const tplIdMap = {};

  const existingCats = await db.categories.toArray();
  const existingByName = Object.fromEntries(existingCats.map(c => [c.name.toLowerCase().trim(), c.id]));

  let catsCreated = 0;
  for (const cat of (cats || [])) {
    const key = cat.name.toLowerCase().trim();
    if (existingByName[key]) { catIdMap[cat.id] = existingByName[key]; continue; }
    const { id: _id, ...data } = cat;
    const newId = await db.categories.add(data);
    catIdMap[cat.id] = newId;
    catsCreated++;
  }
  clearCatsCache();

  for (const tpl of (tpls || [])) {
    const { id: _id, ...data } = tpl;
    if (data.category_id) data.category_id = catIdMap[data.category_id] || null;
    const newId = await db.templates.add(data);
    tplIdMap[tpl.id] = newId;
  }

  for (const tx of (txs || [])) {
    const { id: _id, ...data } = tx;
    if (data.category_id) data.category_id = catIdMap[data.category_id] || null;
    if (data.template_id) data.template_id = tplIdMap[data.template_id] || null;
    await db.transactions.add(data);
  }

  statusEl.innerHTML = `
    <div class="card" style="background:var(--income-light);border-color:var(--income);margin-top:4px">
      <p style="color:var(--income);font-weight:600">Migração concluída!</p>
      <p style="font-size:.85rem;margin-top:6px">${catsCreated} categorias novas · ${tpls?.length||0} recorrências · ${txs?.length||0} transações importadas.</p>
    </div>
  `;
}

async function loadBundledJson() {
  try {
    const res = await fetch('./import_2026.json');
    if (!res.ok) throw new Error('not found');
    const records = await res.json();
    window._jsonRecords = records;

    const byMonth  = records.reduce((acc, r) => { const k = `${MONTHS[r.month-1]} ${r.year}`; acc[k]=(acc[k]||0)+1; return acc; }, {});
    const expenses = records.filter(r => r.transaction_type === 'expense').length;
    const incomes  = records.filter(r => r.transaction_type === 'income').length;
    const paid     = records.filter(r => r.status === 'paid').length;

    document.getElementById('json-preview').innerHTML = `
      <div class="card">
        <div class="section-title" style="margin-bottom:16px">Confirmar Importação</div>
        <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
          <div class="summary-card"><div class="label">Total</div><div class="value">${records.length}</div><div class="sub">registros</div></div>
          <div class="summary-card expense-card"><div class="label">Despesas</div><div class="value">${expenses}</div></div>
          <div class="summary-card income-card"><div class="label">Receitas</div><div class="value">${incomes}</div></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
          ${Object.entries(byMonth).map(([m,n]) => `<span class="badge badge-fixed">${m}: ${n}</span>`).join('')}
        </div>
        <p style="font-size:.83rem;color:var(--text-muted);margin-bottom:20px">
          ${paid} marcados como <strong>pago</strong> · ${records.length - paid} como <strong>pendente</strong>
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="document.getElementById('json-preview').innerHTML=''">Cancelar</button>
          <button class="btn btn-primary" style="background:var(--income)" onclick="confirmJsonImport(window._jsonRecords)">
            Confirmar e importar
          </button>
        </div>
      </div>
    `;
  } catch {
    toast('Arquivo import_2026.json não encontrado na pasta do projeto', 'error');
  }
}

async function handleJsonImport(input) {
  const file = input.files ? input.files[0] : input;
  if (!file) return;

  const text = await file.text();
  let records;
  try {
    records = JSON.parse(text);
  } catch {
    toast('Arquivo JSON inválido', 'error');
    return;
  }

  if (!Array.isArray(records) || records.length === 0) {
    toast('Nenhum registro encontrado no JSON', 'error');
    return;
  }

  const byMonth = records.reduce((acc, r) => {
    const k = `${MONTHS[r.month - 1]} ${r.year}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const expenses = records.filter(r => r.transaction_type === 'expense').length;
  const incomes  = records.filter(r => r.transaction_type === 'income').length;
  const paid     = records.filter(r => r.status === 'paid').length;

  document.getElementById('json-preview').innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="section-title" style="margin-bottom:16px">Preview da Importação</div>
      <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
        <div class="summary-card">
          <div class="label">Total</div>
          <div class="value">${records.length}</div>
          <div class="sub">registros</div>
        </div>
        <div class="summary-card expense-card">
          <div class="label">Despesas</div>
          <div class="value">${expenses}</div>
        </div>
        <div class="summary-card income-card">
          <div class="label">Receitas</div>
          <div class="value">${incomes}</div>
        </div>
      </div>
      <div class="card-title" style="margin-bottom:8px">Por mês</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        ${Object.entries(byMonth).map(([m, n]) =>
          `<span class="badge badge-fixed">${m}: ${n}</span>`
        ).join('')}
      </div>
      <p style="font-size:.83rem;color:var(--text-muted);margin-bottom:16px">
        ${paid} marcados como <strong>pago</strong> · ${records.length - paid} como <strong>pendente</strong>
      </p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="document.getElementById('json-preview').innerHTML=''">Cancelar</button>
        <button class="btn btn-primary" style="background:var(--income)" onclick="confirmJsonImport(window._jsonRecords)">
          Importar ${records.length} registros
        </button>
      </div>
    </div>
  `;

  window._jsonRecords = records;
}

async function confirmJsonImport(records) {
  if (!records || records.length === 0) return;

  const existing = await db.transactions.count();
  if (existing > 0) {
    if (!confirm(`Já existem ${existing} transação(ões) no app. Deseja adicionar os ${records.length} registros importados sem apagar os existentes?`)) return;
  }

  await db.transactions.bulkAdd(records);
  window._jsonRecords = null;
  toast(`${records.length} registros importados com sucesso!`, 'success');
  document.getElementById('json-preview').innerHTML = '';

  setTimeout(() => { location.hash = '#/'; app.render(); }, 800);
}
