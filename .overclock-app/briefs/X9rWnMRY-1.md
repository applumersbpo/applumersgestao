---
id: X9rWnMRY-1
missionId: X9rWnMRYcmew
titulo: Enviando dados da conta Lumers Flow
status: aberto
---

Enviando dados da conta Lumers Flow

---
Worker contract (mandatory, in order):
1. pwd — confirm the repo.
2. Read the pointed item (+ parent item if a slice, for context).
3. Execute strictly within the item's file scope.
4. Write the result back into the item (Correção/notas + session id).
5. Commit with pathspec citing the item ID — this commit is PRE-AUTHORIZED by this contract; do not ask permission, do not wait to be asked.
6. handoff_submit as your last action.

## Resultado

**Sessão:** pane-181 · **Item:** X9rWnMRY-1 · **Data:** 2026-08-08

> Interpretação do item (o brief só tinha o título, sem escopo de arquivo): montar o **pacote de dados de conexão** que a conta **Lumers Flow (n8n)** precisa para se conectar a este app após a atualização v1.36.0 (n8n como cérebro + Chatwoot). Segredos reais **não** são incluídos — indico onde obtê-los no painel.

### 1. Ponte app ⇄ n8n

| Item | Valor |
|------|-------|
| Endpoint de callback (n8n → app) | `https://app.lumersbpo.com.br/api/n8n` |
| Método | `POST` (JSON) |
| Header de auth | `x-n8n-secret: <SECRET>` |
| Onde pegar o `<SECRET>` | Painel → Admin → Sistema → **Integração n8n** (campo Secret). Fallback env: `N8N_SECRET`. |
| Webhook app → n8n | Configurado no mesmo painel (**URL do webhook do n8n**); o app faz fan-out das mensagens recebidas quando o toggle "Assistente de IA" está **desligado**. |

### 2. Primeira chamada recomendada no fluxo n8n

`POST /api/n8n` com `{ "op": "getConnections" }` → devolve, já do painel, tudo que o n8n precisa (sem credencial fixa no fluxo):

- `chatwoot`: `{ enabled, url, token, account_id, inbox_id }`
- `evolution`: `{ instance, api_key, base, connection_status }`
- `ai`: `{ enabled, groq_key, groq_model, groq_vision_model, gemini_key, gemini_model, openai_key, openai_vision_model, openai_audio_model }`
- `wa_assistant_number`

### 3. Operações disponíveis (todas via `POST /api/n8n` + header `x-n8n-secret`)

- **Conexões/regras:** `getConnections`, `getRules`
- **Contexto:** `userByPhone` `{ phone }`, `getUserContext` `{ userId | phone }`, `getMediaBase64` `{ messageKey }`, `getAudioBase64` `{ messageKey }`
- **Ações:** `addTransaction` `{ userId, record }`, `addInstallment` `{ userId, record }`, `createCategory` `{ userId, record:{name,type,icon} }`, `createAccount` `{ userId, record:{name,bank_name,type,initial_balance} }`, `markBillPaid` `{ txId, paidDate }`
- **Canais:** `sendMessage` `{ phone, text }` (WhatsApp), `sendChatwoot` `{ conversationId, text, private? }` (Chatwoot)

### 4. Fluxo de ativação (lado Lumers Flow)

1. Preencher no painel: Integração n8n (URL + secret), Chatwoot (URL/token/account/inbox) e Regras & Base de conhecimento.
2. No n8n: 1º nó chama `getConnections`; usar `getRules`/`getUserContext` para contexto; executar ações via os ops; responder com `sendMessage`/`sendChatwoot`.
3. Desligar o toggle "Assistente de IA" no painel para o repasse ir 100% ao n8n.

### 5. Segurança

- Nunca versionar os JSONs de workflow em `n8n/*.json` (contêm credenciais em texto puro) nem `.env.production`.
- O `<SECRET>` e os tokens de Chatwoot/Evolution ficam só no painel/DB; o n8n os obtém em runtime via `getConnections`.

> Observação: nenhum arquivo de código foi alterado neste item — o suporte já foi entregue na v1.36.0. Este item documenta o **pacote de conexão** para a conta Lumers Flow. Se a intenção era outra (ex.: exportar um workflow n8n pronto ou enviar credenciais reais para um destino específico), me reoriente que eu ajusto.
