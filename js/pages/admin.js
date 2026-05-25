// ── Estado temporário do editor de brand ──────────────────────────────────────
let _pendingLogoData    = ''; // base64 ou URL do logo (sessão atual)
let _pendingFaviconData = ''; // base64 ou URL do favicon (sessão atual)

// ── Render Admin ──────────────────────────────────────────────────────────────

async function renderAdmin() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const [users, plans, brandCfg] = await Promise.all([
      pb.collection('users').getFullList({ fields: 'id,email,name,phone' }),
      pb.collection('user_plans').getFullList(),
      fetch('/api/brand').then(r => r.json()).catch(() => ({})),
    ]);

    const planByEmail = {};
    plans.forEach(p => { planByEmail[p.email] = p; });
    const comWpp    = users.filter(u => u.phone).length;
    const totalFees = plans.reduce((s, p) => s + (p.monthly_fee || 0), 0);
    users.forEach(u => { u._name = planByEmail[u.email]?.name || u.name || ''; });

    // Reseta pendentes ao entrar na página
    _pendingLogoData    = '';
    _pendingFaviconData = '';

    content.innerHTML = `
      ${_adminBrandSection(brandCfg)}

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
             </div>`}
      </div>
    `;

    _initBrandEditor();
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

// ── HTML da seção de brand ────────────────────────────────────────────────────

function _adminBrandSection(cfg) {
  const c = _normalizeBrand(cfg);

  // Helper: campo de cor com swatch visual
  const colorField = (id, label, val, hint = '') => `
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:.75rem;font-weight:600;color:var(--text-muted);letter-spacing:.01em">${label}</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" id="bp-${id}" value="${_escHtml(val)}"
          style="width:34px;height:34px;border:1.5px solid var(--border);border-radius:var(--r-md);
                 padding:2px;cursor:pointer;background:var(--surface);flex-shrink:0">
        <input id="bt-${id}" class="form-control" value="${_escHtml(val)}"
          style="font-family:'JetBrains Mono',monospace;font-size:.82rem;padding:7px 10px;
                 text-transform:uppercase;letter-spacing:.04em;min-width:0">
      </div>
      ${hint ? `<span style="font-size:.72rem;color:var(--text-soft)">${hint}</span>` : ''}
    </div>`;

  // Helper: campo de mídia
  const mediaField = (id, label, hint, currentData) => {
    const isBase64 = currentData && currentData.startsWith('data:');
    const urlVal   = isBase64 ? '' : _escHtml(currentData || '');
    const hasMedia = !!currentData;
    return `
    <div class="form-group">
      <label class="form-label">${label}</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;
          padding:8px 14px;border:1.5px dashed var(--border);border-radius:var(--r-md);
          font-size:.83rem;color:var(--primary-600);font-weight:500;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--primary-600)';this.style.background='var(--primary-50)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='transparent'">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <path d="M10 3v10M6 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          Enviar arquivo
          <input type="file" accept="image/*" style="display:none" onchange="_onMediaFile(this, '${id}')">
        </label>
        ${hasMedia && isBase64
          ? `<span id="${id}-file-label" style="font-size:.78rem;color:var(--income-text);font-weight:600">✓ Arquivo carregado</span>`
          : `<span id="${id}-file-label" style="font-size:.78rem;color:var(--text-soft)"></span>`}
      </div>
      <p style="font-size:.75rem;color:var(--text-soft);margin:5px 0 8px;line-height:1.5">${hint}</p>
      <label class="form-label" style="font-size:.76rem">Ou cole uma URL</label>
      <input id="${id}-url" class="form-control" value="${urlVal}" placeholder="https://..." oninput="_onMediaUrl(this, '${id}')">
      <div id="${id}-preview" style="margin-top:10px;${hasMedia ? '' : 'display:none'}">
        ${hasMedia ? `<img src="${_escHtml(currentData)}" alt=""
          style="height:48px;border-radius:var(--r-md);border:1px solid var(--border);padding:4px;background:var(--bg-subtle)"
          onerror="this.style.display='none'">` : ''}
      </div>
    </div>`;
  };

  // Separator
  const sep = title => `
    <div style="display:flex;align-items:center;gap:10px;margin:24px 0 14px">
      <span style="font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
        color:var(--text-muted);white-space:nowrap">${title}</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>`;

  // Mini sidebar preview
  const sidebarPreview = `
    <div style="background:${_escHtml(c.sidebarBg)};border-radius:var(--r-lg);padding:12px;
      display:flex;flex-direction:column;gap:4px;min-width:160px">
      <div style="font-family:'Spectral',Georgia,serif;font-size:.85rem;font-weight:500;
        color:#F8F4E4;padding:4px 6px;margin-bottom:4px;border-bottom:1px solid rgba(248,244,228,.1);
        padding-bottom:8px">Lumers Flow</div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;
        background:rgba(248,244,228,.14);position:relative;">
        <span style="position:absolute;left:0;top:20%;bottom:20%;width:3px;
          background:${_escHtml(c.warning)};border-radius:0 2px 2px 0"></span>
        <div style="width:6px;height:6px;border-radius:50%;background:${_escHtml(c.primary)}"></div>
        <span style="font-size:.78rem;color:#F8F4E4;font-weight:600">Dashboard</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px">
        <div style="width:6px;height:6px;border-radius:50%;background:${_escHtml(c.sidebarText)};opacity:.6"></div>
        <span style="font-size:.78rem;color:${_escHtml(c.sidebarText)};opacity:.9">Contas a Pagar</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px">
        <div style="width:6px;height:6px;border-radius:50%;background:${_escHtml(c.sidebarText)};opacity:.6"></div>
        <span style="font-size:.78rem;color:${_escHtml(c.sidebarText)};opacity:.9">Faturamento</span>
      </div>
    </div>`;

  // Paleta de swatches rápidos
  const palette = [
    { label: 'Primary', color: c.primary },
    { label: 'Primária escura', color: c.primaryDark },
    { label: 'Acento', color: c.warning },
    { label: 'Receita', color: c.income },
    { label: 'Despesa', color: c.expense },
    { label: 'Alerta', color: c.warning },
    { label: 'Fundo', color: c.bg },
    { label: 'Sidebar', color: c.sidebarBg },
  ];
  const paletteStrip = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
      ${palette.map(p => `
        <div title="${p.label}" style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="width:32px;height:32px;border-radius:var(--r-md);background:${_escHtml(p.color)};
            border:1.5px solid rgba(0,0,0,.08)"></div>
          <span style="font-size:.6rem;color:var(--text-soft);text-align:center;line-height:1.2;max-width:40px">${p.label}</span>
        </div>`).join('')}
    </div>`;

  return `
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <div class="card-title">Identidade Visual</div>
          <p style="font-size:.85rem;color:var(--text-muted);margin:4px 0 0;line-height:1.5">
            Personalize cores, logotipo e favicon. Aplicado para todos os usuários ao salvar.
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn btn-sm btn-secondary" onclick="_previewBrandConfig()">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
            Pré-visualizar
          </button>
          <button class="btn btn-sm btn-ghost" style="color:var(--expense)" onclick="_resetBrandConfig()">Restaurar padrões</button>
        </div>
      </div>

      <!-- Paleta atual + preview sidebar -->
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;
        background:var(--bg-subtle);border-radius:var(--r-lg);padding:16px;margin-bottom:8px">
        <div style="flex:1;min-width:180px">
          <div style="font-size:.75rem;font-weight:600;color:var(--text-muted);
            letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">Paleta atual</div>
          ${paletteStrip}
        </div>
        <div>
          <div style="font-size:.75rem;font-weight:600;color:var(--text-muted);
            letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">Preview sidebar</div>
          ${sidebarPreview}
        </div>
      </div>

      ${sep('Aplicativo')}
      <div class="form-group">
        <label class="form-label">Nome do aplicativo</label>
        <input id="b-appName" class="form-control" value="${_escHtml(c.appName)}" placeholder="Lumers Flow">
      </div>

      ${sep('Logotipo & Favicon')}
      ${mediaField('b-logo', 'Logotipo', 'PNG, SVG, JPEG, WEBP — recomendado fundo transparente. Máx 4MB.', c.logoData)}
      ${mediaField('b-favicon', 'Favicon', 'PNG 32×32 ou ICO — ícone da aba do navegador. Máx 4MB.', c.faviconData)}

      ${sep('Cores da Marca')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:8px">
        ${colorField('primary',      'Cor primária',    c.primary,      'Base do sistema — botões, links, ativo')}
        ${colorField('primaryDark',  'Primária escura', c.primaryDark,  'Hover / sombra de botão')}
        ${colorField('primaryLight', 'Primária clara',  c.primaryLight, 'Fundo de badges e destaques')}
      </div>

      ${sep('Semânticas')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${colorField('income',       'Receita',         c.income,       'Positivo / entrada')}
        ${colorField('incomeLight',  'Receita clara',   c.incomeLight,  'Fundo de badge de receita')}
        ${colorField('expense',      'Despesa',         c.expense,      'Negativo / saída')}
        ${colorField('expenseLight', 'Despesa clara',   c.expenseLight, 'Fundo de badge de despesa')}
        ${colorField('warning',      'Alerta / Acento', c.warning,      'Alertas, pendentes e accent CTA')}
        ${colorField('warningLight', 'Alerta claro',    c.warningLight, 'Fundo de badge de alerta')}
      </div>

      ${sep('Interface')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${colorField('bg',        'Fundo geral', c.bg,        'Background do app')}
        ${colorField('surface',   'Cartões',     c.surface,   'Cards, modais, inputs')}
        ${colorField('border',    'Bordas',      c.border,    'Linhas divisórias')}
        ${colorField('text',      'Texto',       c.text,      'Texto principal — alto contraste')}
        ${colorField('textMuted', 'Texto suave', c.textMuted, 'Labels, meta, legendas')}
      </div>

      ${sep('Barra Lateral')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${colorField('sidebarBg',     'Fundo',         c.sidebarBg,     'Background da sidebar')}
        ${colorField('sidebarText',   'Texto dos itens',c.sidebarText,  'Itens não ativos — use creme para contraste')}
        ${colorField('sidebarActive', 'Item ativo',    c.sidebarActive, 'Texto do item em foco')}
      </div>

      <div style="display:flex;gap:10px;padding-top:20px;border-top:1px solid var(--border);
        margin-top:24px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="saveBrandConfig()">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 12l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Salvar tudo
        </button>
        <button class="btn btn-secondary" onclick="_previewBrandConfig()">Pré-visualizar</button>
        <button class="btn btn-ghost" style="color:var(--expense)" onclick="_resetBrandConfig()">Restaurar padrões</button>
      </div>
    </div>`;
}

// ── Inicialização do editor ───────────────────────────────────────────────────

function _initBrandEditor() {
  const colorIds = [
    'primary', 'primaryDark', 'primaryLight',
    'income', 'incomeLight', 'expense', 'expenseLight',
    'warning', 'warningLight',
    'bg', 'surface', 'border', 'text', 'textMuted',
    'sidebarBg', 'sidebarText', 'sidebarActive',
  ];

  colorIds.forEach(id => {
    const picker = document.getElementById(`bp-${id}`);
    const text   = document.getElementById(`bt-${id}`);
    if (!picker || !text) return;
    picker.addEventListener('input', () => { text.value = picker.value; });
    text.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
    });
  });

  // Auto-computa variantes ao mudar a cor principal
  const autoDerive = [
    ['primary',  'primaryDark',  _darken,  null],
    ['primary',  'primaryLight', _lighten, null],
    ['income',   'incomeLight',  _lighten, null],
    ['expense',  'expenseLight', _lighten, null],
    ['warning',  'warningLight', _lighten, null],
  ];
  autoDerive.forEach(([srcId, dstId, fn]) => {
    const srcPicker = document.getElementById(`bp-${srcId}`);
    if (!srcPicker) return;
    srcPicker.addEventListener('input', () => {
      const v = fn(srcPicker.value);
      const dp = document.getElementById(`bp-${dstId}`);
      const dt = document.getElementById(`bt-${dstId}`);
      if (dp) dp.value = v;
      if (dt) dt.value = v;
    });
  });
}

// ── Upload de mídia (logo / favicon) ─────────────────────────────────────────

async function _compressImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) { reject(new Error('Arquivo muito grande (máx 4MB)')); return; }
    const reader = new FileReader();
    reader.onload = e => {
      if (file.type === 'image/svg+xml') { resolve(e.target.result); return; }
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png', 0.88));
      };
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

async function _onMediaFile(input, fieldId) {
  const file = input.files[0];
  if (!file) return;

  const label = document.getElementById(`${fieldId}-file-label`);
  if (label) { label.textContent = 'Processando...'; label.style.color = 'var(--text-muted)'; }

  try {
    const isLogo   = fieldId === 'b-logo';
    const maxW     = isLogo ? 512 : 64;
    const maxH     = isLogo ? 512 : 64;
    const data     = await _compressImage(file, maxW, maxH);

    if (isLogo) {
      _pendingLogoData = data;
    } else {
      _pendingFaviconData = data;
    }

    // Limpa URL field (arquivo tem prioridade)
    const urlInput = document.getElementById(`${fieldId}-url`);
    if (urlInput) urlInput.value = '';

    // Preview
    _showMediaPreview(fieldId, data);
    if (label) { label.textContent = `✓ ${file.name}`; label.style.color = 'var(--income)'; }
  } catch(e) {
    if (label) { label.textContent = ''; }
    toast(e.message, 'error');
  }
}

function _onMediaUrl(input, fieldId) {
  const url = input.value.trim();
  // Arquivo previamente carregado é descartado se o user digitar URL
  if (fieldId === 'b-logo') {
    _pendingLogoData = '';
    const lbl = document.getElementById('b-logo-file-label');
    if (lbl) lbl.textContent = '';
  } else {
    _pendingFaviconData = '';
    const lbl = document.getElementById('b-favicon-file-label');
    if (lbl) lbl.textContent = '';
  }
  _showMediaPreview(fieldId, url);
}

function _showMediaPreview(fieldId, src) {
  const preview = document.getElementById(`${fieldId}-preview`);
  if (!preview) return;
  if (src) {
    preview.style.display = '';
    preview.innerHTML = `<img src="${_escHtml(src)}" alt="" style="height:48px;border-radius:8px;border:1px solid var(--border);padding:4px;background:#f8fafc" onerror="this.style.display='none'">`;
  } else {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
}

// ── Coleta o formulário ───────────────────────────────────────────────────────

function _collectBrandForm() {
  const gp = id => document.getElementById(`bp-${id}`)?.value || '';
  const gt = id => document.getElementById(`bt-${id}`)?.value || gp(id);

  const logoUrl    = document.getElementById('b-logo-url')?.value.trim()    || '';
  const faviconUrl = document.getElementById('b-favicon-url')?.value.trim() || '';

  return {
    appName:       document.getElementById('b-appName')?.value.trim() || 'Lumers Flow',
    primary:       gt('primary'),
    primaryDark:   gt('primaryDark'),
    primaryLight:  gt('primaryLight'),
    income:        gt('income'),
    incomeLight:   gt('incomeLight'),
    expense:       gt('expense'),
    expenseLight:  gt('expenseLight'),
    warning:       gt('warning'),
    warningLight:  gt('warningLight'),
    bg:            gt('bg'),
    surface:       gt('surface'),
    border:        gt('border'),
    text:          gt('text'),
    textMuted:     gt('textMuted'),
    sidebarBg:     gt('sidebarBg'),
    sidebarText:   gt('sidebarText'),
    sidebarActive: gt('sidebarActive'),
    logoData:      _pendingLogoData    || logoUrl,
    faviconData:   _pendingFaviconData || faviconUrl,
  };
}

// ── Popula o formulário ───────────────────────────────────────────────────────

function _populateBrandForm(cfg) {
  const c = _normalizeBrand(cfg);
  const set = (id, val) => {
    const p = document.getElementById(`bp-${id}`);
    const t = document.getElementById(`bt-${id}`);
    if (p) p.value = val;
    if (t) t.value = val;
  };

  document.getElementById('b-appName').value = c.appName;
  set('primary',       c.primary);
  set('primaryDark',   c.primaryDark);
  set('primaryLight',  c.primaryLight);
  set('income',        c.income);
  set('incomeLight',   c.incomeLight);
  set('expense',       c.expense);
  set('expenseLight',  c.expenseLight);
  set('warning',       c.warning);
  set('warningLight',  c.warningLight);
  set('bg',            c.bg);
  set('surface',       c.surface);
  set('border',        c.border);
  set('text',          c.text);
  set('textMuted',     c.textMuted);
  set('sidebarBg',     c.sidebarBg);
  set('sidebarText',   c.sidebarText);
  set('sidebarActive', c.sidebarActive);

  // Logo
  _pendingLogoData = c.logoData?.startsWith('data:') ? c.logoData : '';
  const logoUrlEl  = document.getElementById('b-logo-url');
  if (logoUrlEl)  logoUrlEl.value = c.logoData?.startsWith('data:') ? '' : (c.logoData || '');
  _showMediaPreview('b-logo', c.logoData || '');

  // Favicon
  _pendingFaviconData = c.faviconData?.startsWith('data:') ? c.faviconData : '';
  const favUrlEl      = document.getElementById('b-favicon-url');
  if (favUrlEl) favUrlEl.value = c.faviconData?.startsWith('data:') ? '' : (c.faviconData || '');
  _showMediaPreview('b-favicon', c.faviconData || '');
}

// ── Ações ─────────────────────────────────────────────────────────────────────

function _previewBrandConfig() {
  _applyBrand(_collectBrandForm());
  toast('Pré-visualização aplicada (não salvo)', 'success');
}

function _resetBrandConfig() {
  if (!confirm('Restaurar todos os padrões visuais? A pré-visualização será aplicada mas não salva até você clicar em "Salvar tudo".')) return;
  _pendingLogoData    = '';
  _pendingFaviconData = '';
  _populateBrandForm(getBrandDefaults());
  _applyBrand(getBrandDefaults());
  toast('Padrões restaurados (pré-visualizando). Clique em Salvar tudo para confirmar.', 'success');
}

async function saveBrandConfig() {
  const cfg = _collectBrandForm();

  // Valida hexadecimais
  const hexFields = ['primary','primaryDark','primaryLight','income','incomeLight',
    'expense','expenseLight','warning','warningLight','bg','surface','border',
    'text','textMuted','sidebarBg','sidebarText','sidebarActive'];
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  for (const f of hexFields) {
    if (!hexRe.test(cfg[f])) {
      toast(`Cor inválida em "${f}". Use o formato #rrggbb`, 'error');
      return;
    }
  }

  const btn = document.querySelector('[onclick="saveBrandConfig()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    await saveBrand(cfg);
    _pendingLogoData    = '';
    _pendingFaviconData = '';
    toast('Identidade visual salva com sucesso!', 'success');
  } catch(e) {
    toast('Erro ao salvar: ' + (e.message || 'falha'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar tudo'; }
  }
}

// ── Usuários ──────────────────────────────────────────────────────────────────

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
    </div>`;
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
