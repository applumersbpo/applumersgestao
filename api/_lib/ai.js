import { getSystemSetting } from './db.js';

// Lê a configuração de IA do painel (system_settings). Groq = texto/raciocínio,
// Gemini = multimodal (áudio + imagem/print). Chaves ficam vazias até o admin colar.
export async function getAiConfig() {
  const [enabled, groqKey, groqModel, geminiKey, geminiModel] = await Promise.all([
    getSystemSetting('ai_enabled'),
    getSystemSetting('ai_groq_key'),
    getSystemSetting('ai_groq_model'),
    getSystemSetting('ai_gemini_key'),
    getSystemSetting('ai_gemini_model'),
  ]);
  return {
    enabled: enabled === '1' || enabled === 'true',
    groqKey: groqKey || '',
    groqModel: groqModel || 'llama-3.3-70b-versatile',
    geminiKey: geminiKey || '',
    geminiModel: geminiModel || 'gemini-2.0-flash',
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

// Transcreve áudio (base64) para texto PT-BR via Gemini.
export async function geminiTranscribeAudio({ key, model, base64, mime = 'audio/ogg' }) {
  return geminiGenerate({
    key,
    model,
    parts: [
      { text: 'Transcreva o áudio a seguir para texto em português do Brasil. Responda APENAS com a transcrição literal, sem comentários nem aspas.' },
      { inline_data: { mime_type: mime, data: base64 } },
    ],
  });
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
      { inline_data: { mime_type: mime, data: base64 } },
    ],
  });
}
