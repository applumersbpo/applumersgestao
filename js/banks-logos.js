/**
 * Catálogo de logos de bancos brasileiros — servidos localmente em /logos/banks/
 */

const BANKS_CATALOG = [
  // ── Bancos Tradicionais ────────────────────────────────────────────────────
  { name: 'Banco do Brasil',         code: '001', file: 'banco-do-brasil' },
  { name: 'Bradesco',                code: '237', file: 'bradesco' },
  { name: 'Itaú Unibanco',           code: '341', file: 'itau' },
  { name: 'Caixa Econômica Federal', code: '104', file: 'caixa' },
  { name: 'Santander',               code: '033', file: 'santander' },
  { name: 'Safra',                   code: '422', file: 'safra' },
  { name: 'BTG Pactual',             code: '208', file: 'btg' },
  { name: 'BV',                      code: '655', file: 'bv' },
  { name: 'Banrisul',                code: '041', file: 'banrisul' },
  { name: 'BMG',                     code: '318', file: 'bmg' },
  { name: 'Daycoval',                code: '707', file: 'daycoval' },
  { name: 'Sofisa',                  code: '637', file: 'sofisa' },
  { name: 'BRB',                     code: '070', file: 'brb' },
  { name: 'Banestes',                code: '021', file: 'banestes' },
  { name: 'Banco do Nordeste',       code: '004', file: 'bnb' },
  { name: 'Banco da Amazônia',       code: '003', file: 'basa' },
  { name: 'BS2',                     code: '218', file: 'bs2' },
  { name: 'ABC Brasil',              code: '246', file: 'abc' },
  { name: 'Pine',                    code: '643', file: 'pine' },
  { name: 'Banco Arbi',              code: '213', file: 'arbi' },
  { name: 'Banco Original',          code: '212', file: 'original' },
  { name: 'BNP Paribas',             code: '752', file: 'bnp' },
  // ── Digitais / Fintechs ────────────────────────────────────────────────────
  { name: 'Nubank',                  code: '260', file: 'nubank' },
  { name: 'Inter',                   code: '077', file: 'inter' },
  { name: 'C6 Bank',                 code: '336', file: 'c6' },
  { name: 'Neon',                    code: '536', file: 'neon' },
  { name: 'XP Investimentos',        code: '102', file: 'xp' },
  { name: 'InfinitePay',             code: '743', file: 'infinitepay' },
  { name: 'Conta Simples',           code: '482', file: 'conta-simples' },
  { name: 'Cora',                    code: '403', file: 'cora' },
  { name: 'Asaas',                   code: '461', file: 'asaas' },
  { name: 'Efí Bank',                code: '364', file: 'efi' },
  { name: 'Transfeera',              code: '409', file: 'transfeera' },
  // ── Pagamentos ─────────────────────────────────────────────────────────────
  { name: 'Mercado Pago',            code: '323', file: 'mercadopago' },
  { name: 'PagSeguro',               code: '290', file: 'pagseguro' },
  { name: 'PagBank',                 code: '290', file: 'pagbank' },
  { name: 'Stone',                   code: '197', file: 'stone' },
  { name: 'PicPay',                  code: '380', file: 'picpay' },
  { name: 'RecargaPay',              code: '003', file: 'recargapay' },
  // ── Cooperativas ───────────────────────────────────────────────────────────
  { name: 'Sicoob',                  code: '756', file: 'sicoob' },
  { name: 'Sicredi',                 code: '748', file: 'sicredi' },
  { name: 'Cresol',                  code: '133', file: 'cresol' },
  { name: 'Unicred',                 code: '136', file: 'unicred' },
  { name: 'Credisis',                code: '097', file: 'credisis' },
  { name: 'Uniprime',                code: '084', file: 'uniprime' },
].map(b => ({ ...b, logo_url: `./logos/banks/${b.file}.svg` }));

/**
 * Normaliza string para comparação fuzzy: lowercase, sem acentos,
 * sem palavras genéricas de banco.
 * Retorna null se o resultado for vazio.
 */
function _normalizeName(s) {
  const result = String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(banco|s\.a|s\/a|ltda|do|da|de|dos|das|brasil|pagamentos|internet|solucoes|sociedade|credito|direto|pagamentos)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return result || null;
}

/**
 * Score de similaridade entre duas strings normalizadas (0-1).
 * Retorna 0 se não há match, 1 se idêntico.
 */
function _similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Containment: score parcial
  if (a.includes(b)) return 0.9;
  if (b.includes(a)) return 0.8;
  // Word intersection
  const wa = a.split(' ');
  const wb = b.split(' ');
  const shared = wa.filter(w => w.length > 1 && wb.includes(w)).length;
  if (shared > 0) return 0.5 + (shared / Math.max(wa.length, wb.length)) * 0.3;
  return 0;
}

/**
 * Busca no catálogo pelo código COMPE ou pelo nome do banco (fuzzy).
 * Retorna o objeto do catálogo (com logo_url) ou null.
 */
function findBankInCatalog(name, code) {
  // 1. Busca exata por código COMPE (3 dígitos)
  if (code) {
    const codeStr = String(code).replace(/\D/g, '').padStart(3, '0');
    if (codeStr.length === 3) {
      const byCode = BANKS_CATALOG.find(b => b.code === codeStr);
      if (byCode) return byCode;
    }
  }

  if (!name) return null;

  const needle = _normalizeName(name);
  if (!needle) return null; // guard against empty after normalization

  // 2. Busca por score de similaridade — retorna o mais alto acima de 0.4
  let bestMatch = null;
  let bestScore = 0.4; // threshold mínimo

  for (const b of BANKS_CATALOG) {
    const hay = _normalizeName(b.name);
    if (!hay) continue;
    const score = _similarity(needle, hay);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = b;
    }
  }

  return bestMatch;
}
