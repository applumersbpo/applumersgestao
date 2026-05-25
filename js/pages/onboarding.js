async function checkOnboardingDone() {
  try {
    const res = await db.settings.filter(`key = 'onboarding_done'`).toArray();
    return res.length > 0;
  } catch {
    return true;
  }
}

function showOnboarding() {
  const el = document.createElement('div');
  el.id = 'onboarding';
  el.style.cssText = 'position:fixed;inset:0;z-index:8000;background:var(--bg);overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:24px';
  document.body.appendChild(el);
  _renderOnboarding(1);
}

function _renderOnboarding(step) {
  const el = document.getElementById('onboarding');
  if (!el) return;

  const dots = [1, 2, 3].map(i => `
    <div style="width:8px;height:8px;border-radius:50%;background:${i <= step ? 'var(--primary)' : 'var(--border)'}"></div>
  `).join('');

  const progress = `<div style="display:flex;gap:6px;justify-content:center;margin-bottom:32px">${dots}</div>`;

  let body = '';
  if (step === 1) body = _onboardingStep1();
  if (step === 2) body = _onboardingStep2();
  if (step === 3) body = _onboardingStep3();

  el.innerHTML = `<div style="width:100%;max-width:440px">${progress}${body}</div>`;
}

function _onboardingStep1() {
  return `
    <div class="card" style="padding:32px;text-align:center">
      <div style="margin-bottom:24px">
        <svg width="52" height="52" viewBox="0 0 28 28" fill="none" style="margin:0 auto;display:block">
          <rect width="28" height="28" rx="8" fill="var(--primary)"/>
          <path d="M7 14h14M14 7v14" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div style="font-size:1.4rem;font-weight:700;margin-bottom:8px;color:var(--text)">Bem-vindo ao Lumers BPO</div>
      <p style="color:var(--text-muted);font-size:.9rem;margin-bottom:28px;line-height:1.6">
        Controle suas finanças de forma simples e visual. Vamos configurar tudo em 2 passos rápidos.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px;text-align:left">
        ${[
          ['📋', 'Categorias prontas para usar'],
          ['🔄', 'Lançamentos recorrentes automáticos'],
          ['📊', 'Relatórios e metas de faturamento'],
        ].map(([icon, text]) => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface);border-radius:var(--radius-sm)">
            <span style="font-size:1.1rem">${icon}</span>
            <span style="font-size:.88rem;color:var(--text)">${text}</span>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:1rem" onclick="_renderOnboarding(2)">
        Começar configuração →
      </button>
    </div>
  `;
}

function _onboardingStep2() {
  const preview = SUGGESTED_CATEGORIES.slice(0, 12);
  const chips = preview.map(c => `
    <div style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;font-size:.8rem;background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">
      ${c.icon} ${c.name}
    </div>
  `).join('');

  return `
    <div class="card" style="padding:32px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:2rem;margin-bottom:8px">🗂️</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--text);margin-bottom:6px">Suas categorias estão prontas</div>
        <p style="color:var(--text-muted);font-size:.88rem">
          Criamos <strong>${SUGGESTED_CATEGORIES.length} categorias</strong> sugeridas para você organizar despesas e receitas.
        </p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${chips}</div>
      <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:24px">
        + ${SUGGESTED_CATEGORIES.length - 12} mais... Você pode editar, criar e remover categorias quando quiser.
      </p>
      <button class="btn btn-primary" style="width:100%;padding:12px;margin-bottom:10px" onclick="_renderOnboarding(3)">
        Perfeito, continuar →
      </button>
      <button class="btn btn-ghost" style="width:100%" onclick="_renderOnboarding(3)">
        Personalizar depois
      </button>
    </div>
  `;
}

function _onboardingStep3() {
  return `
    <div class="card" style="padding:32px;text-align:center">
      <div style="font-size:3rem;margin-bottom:16px">🎉</div>
      <div style="font-size:1.3rem;font-weight:700;color:var(--text);margin-bottom:8px">Tudo pronto!</div>
      <p style="color:var(--text-muted);font-size:.9rem;margin-bottom:28px;line-height:1.6">
        Seu app está configurado. Agora é só começar a lançar suas finanças.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border-radius:var(--radius-sm)">
          <span style="font-size:1rem">✅</span>
          <span style="font-size:.88rem;color:var(--text)">Categorias configuradas</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border-radius:var(--radius-sm)">
          <span style="font-size:1rem">✅</span>
          <span style="font-size:.88rem;color:var(--text)">Conta criada com sucesso</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border-radius:var(--radius-sm)">
          <span style="font-size:1rem">✅</span>
          <span style="font-size:.88rem;color:var(--text)">Pronto para lançar finanças</span>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:1rem" onclick="finishOnboarding()">
        Ir para o Dashboard →
      </button>
    </div>
  `;
}

async function finishOnboarding() {
  try {
    await db.settings.add({ key: 'onboarding_done', value: 'true' });
  } catch(_) {}

  const el = document.getElementById('onboarding');
  if (el) el.remove();

  await app._resume();
}
