import { getSystemSetting } from './db.js';

// Lê a configuração de IA do painel (system_settings). Groq = texto/raciocínio,
// Gemini = multimodal (áudio + imagem/print). Chaves ficam vazias até o admin colar.
export async function getAiConfig() {
  const [enabled, groqKey, groqModel, groqVisionModel, geminiKey, geminiModel, openaiKey, openaiVisionModel, openaiAudioModel, signupEnabled] = await Promise.all([
    getSystemSetting('ai_enabled'),
    getSystemSetting('ai_groq_key'),
    getSystemSetting('ai_groq_model'),
    getSystemSetting('ai_groq_vision_model'),
    getSystemSetting('ai_gemini_key'),
    getSystemSetting('ai_gemini_model'),
    getSystemSetting('ai_openai_key'),
    getSystemSetting('ai_openai_vision_model'),
    getSystemSetting('ai_openai_audio_model'),
    getSystemSetting('wa_signup_enabled'),
  ]);
  return {
    enabled: enabled === '1' || enabled === 'true',
    groqKey: groqKey || '',
    groqModel: groqModel || 'llama-3.3-70b-versatile',
    // Modelo de visão do Groq (multimodal). Configurável no painel porque o Groq
    // descontinua/renomeia esses modelos periodicamente (ex.: 404 model_not_found).
    // Os Llama-4 Scout/Maverick foram descontinuados; modelo de visão atual: qwen/qwen3.6-27b.
    groqVisionModel: groqVisionModel || 'qwen/qwen3.6-27b',
    geminiKey: geminiKey || '',
    geminiModel: geminiModel || 'gemini-2.0-flash',
    // OpenAI (ChatGPT) — leitura de imagens e documentos (PDF). Provedor primário
    // de visão/documento; Groq e Gemini ficam como fallback.
    openaiKey: openaiKey || '',
    openaiVisionModel: openaiVisionModel || 'gpt-4o-mini',
    openaiAudioModel: openaiAudioModel || 'whisper-1',
    // Trava de onboarding: por padrão o assistente só responde a usuários já
    // cadastrados. Só faz o fluxo de solicitação de acesso se explicitamente ligado.
    signupEnabled: signupEnabled === '1' || signupEnabled === 'true',
  };
}

// Groq chat completions (API compatível com OpenAI). Retorna o texto do assistente.
// jsonMode força resposta em JSON válido (usado para classificação de intenção).
export async function groqChat({ key, model, messages, temperature = 0.2, jsonMode = false }) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content || '';
}

// Gemini generateContent — multimodal. parts = [{text}] e/ou [{inline_data:{mime_type,data}}].
export async function geminiGenerate({ key, model, parts, systemInstruction }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts }],
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('') || '';
}

// Sanitiza o mime type para o formato que o Gemini aceita: remove parâmetros
// como "; codecs=opus" (que o WhatsApp envia nos áudios) e normaliza vazios.
function cleanMime(mime, fallback) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return base || fallback;
}

// Transcreve áudio (base64) via Groq Whisper (endpoint audio/transcriptions).
// Groq tem cota própria (separada do Gemini) e aceita ogg/opus do WhatsApp.
export async function groqTranscribeAudio({ key, model = 'whisper-large-v3-turbo', base64, mime = 'audio/ogg', filename = 'audio.ogg' }) {
  const type = cleanMime(mime, 'audio/ogg');
  const bin = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bin], { type }), filename);
  form.append('model', model);
  form.append('language', 'pt');
  form.append('response_format', 'text');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Groq Whisper HTTP ${r.status}: ${text.slice(0, 200)}`);
  return (text || '').trim();
}

// Interpreta imagem/print (base64) via Groq (modelo de visão Llama 4).
// Cota própria do Groq, separada do Gemini. Usa o endpoint chat/completions
// com conteúdo multimodal (image_url em data URL).
export async function groqReadImage({ key, model = 'qwen/qwen3.6-27b', base64, mime = 'image/jpeg', prompt }) {
  const type = cleanMime(mime, 'image/jpeg');
  const content = [
    {
      type: 'text',
      text:
        prompt ||
        'Este é um print enviado por um usuário de um app financeiro. Extraia de forma objetiva: valor(es) em reais, nome/descrição do gasto ou recebimento, data (se houver) e se aparenta ser RECEITA ou DESPESA. Se não for um comprovante/financeiro, descreva brevemente o que é. Responda em português, curto.',
    },
    { type: 'image_url', image_url: { url: `data:${type};base64,${base64}` } },
  ];
  return groqChat({ key, model, messages: [{ role: 'user', content }], temperature: 0.2 });
}

// Transcreve áudio (base64) para texto PT-BR via Gemini.
export async function geminiTranscribeAudio({ key, model, base64, mime = 'audio/ogg' }) {
  return geminiGenerate({
    key,
    model,
    parts: [
      { text: 'Transcreva o áudio a seguir para texto em português do Brasil. Responda APENAS com a transcrição literal, sem comentários nem aspas.' },
      { inline_data: { mime_type: cleanMime(mime, 'audio/ogg'), data: base64 } },
    ],
  });
}

// ── OpenAI (ChatGPT) ────────────────────────────────────────────────────────
// Chat completions da OpenAI (mesma família da API compatível). Retorna o texto.
export async function openaiChat({ key, model, messages, temperature = 0.2 }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content || '';
}

// Interpreta imagem/print (base64) via visão da OpenAI (gpt-4o / gpt-4o-mini).
// Usa conteúdo multimodal com image_url em data URL.
export async function openaiReadImage({ key, model = 'gpt-4o-mini', base64, mime = 'image/jpeg', prompt }) {
  const type = cleanMime(mime, 'image/jpeg');
  const content = [
    {
      type: 'text',
      text:
        prompt ||
        'Este é um print enviado por um usuário de um app financeiro. Extraia de forma objetiva: valor(es) em reais, nome/descrição do gasto ou recebimento, data (se houver) e se aparenta ser RECEITA ou DESPESA. Se não for um comprovante/financeiro, descreva brevemente o que é. Responda em português, curto.',
    },
    { type: 'image_url', image_url: { url: `data:${type};base64,${base64}` } },
  ];
  return openaiChat({ key, model, messages: [{ role: 'user', content }], temperature: 0.2 });
}

// Lê um documento (PDF de fatura/boleto/comprovante) via OpenAI, enviando o
// arquivo como parte "file" (base64 em data URL). Modelos gpt-4o leem PDF assim.
export async function openaiReadDocument({ key, model = 'gpt-4o-mini', base64, mime = 'application/pdf', filename = 'documento.pdf', prompt }) {
  const type = cleanMime(mime, 'application/pdf');
  const content = [
    {
      type: 'text',
      text:
        prompt ||
        'Este é um documento financeiro (fatura de cartão, boleto ou comprovante). Extraia de forma objetiva os valores, datas de vencimento/fechamento, banco/cartão e compras parceladas. Responda em português, curto.',
    },
    { type: 'file', file: { filename, file_data: `data:${type};base64,${base64}` } },
  ];
  return openaiChat({ key, model, messages: [{ role: 'user', content }], temperature: 0.2 });
}

// Transcreve áudio (base64) via OpenAI (endpoint audio/transcriptions).
export async function openaiTranscribeAudio({ key, model = 'whisper-1', base64, mime = 'audio/ogg', filename = 'audio.ogg' }) {
  const type = cleanMime(mime, 'audio/ogg');
  const bin = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bin], { type }), filename);
  form.append('model', model);
  form.append('language', 'pt');
  form.append('response_format', 'text');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`OpenAI Whisper HTTP ${r.status}: ${text.slice(0, 200)}`);
  return (text || '').trim();
}

// Interpreta imagem/print (base64) extraindo o conteúdo financeiro via Gemini.
export async function geminiReadImage({ key, model, base64, mime = 'image/jpeg', prompt }) {
  return geminiGenerate({
    key,
    model,
    parts: [
      {
        text:
          prompt ||
          'Este é um print enviado por um usuário de um app financeiro. Extraia de forma objetiva: valor(es) em reais, nome/descrição do gasto ou recebimento, data (se houver) e se aparenta ser RECEITA ou DESPESA. Se não for um comprovante/financeiro, descreva brevemente o que é. Responda em português, curto.',
      },
      { inline_data: { mime_type: cleanMime(mime, 'image/jpeg'), data: base64 } },
    ],
  });
}
