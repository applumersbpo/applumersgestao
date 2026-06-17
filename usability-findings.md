# Usability / QA Findings — applumersgestao

Contrato de findings do QA Vision Lab. Cada finding usa ID único (faixa F-2XX = reviewer estático).
Ciclo de status: aberto → em_progresso → resolvido / descartado.

Escopo desta rodada: integração Evolution API.
- PROBLEMA 1 — "As configurações não são aplicadas na Evolution ao criar a instância."
- PROBLEMA 3 — "O envio de mensagens pela instância padrão falha."

---

## F-201 | categoria: funcional | severidade: alta | status: corrigido
- Tela: api/admin/users.js:255
- Passos: 1) Admin → Sistema → WhatsApp → "Criar nova instância". 2) Frontend chama `_evoCreateInstance` → action `create-evolution-instance`. 3) Backend faz POST `/instance/create` com body `{ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }` (linha 258). 4) Nenhuma chamada subsequente é feita.
- Esperado: As configurações da Evolution deveriam ser aplicadas na criação — seja no body do `/instance/create` (campos como `rejectCall`/`msgCall`, `groupsIgnore`, `alwaysOnline`, `readMessages`, `readStatus`, `syncFullHistory`) e/ou via chamadas subsequentes a `/settings/set/{instance}` e `/webhook/set/{instance}` para webhook.
- Observado: O body só envia `{ instanceName, qrcode, integration }`. Não há nenhum campo de settings nem chamada a `/settings/set/{instance}` ou `/webhook/set/{instance}` em todo o repositório (grep por `settings/set|webhook/set|rejectCall|groupsIgnore|alwaysOnline|readMessages|syncFullHistory` = 0 resultados). A instância nasce com defaults da Evolution; nenhuma configuração do sistema é aplicada. Causa raiz direta do PROBLEMA 1.
- (resolvedor) Correção: api/admin/users.js (`create-evolution-instance`) — após `/instance/create` retornar OK, faz POST `/settings/set/{instance}` com header global e defaults `{ rejectCall:true, msgCall:'', groupsIgnore:true, alwaysOnline:true, readMessages:false, readStatus:false, syncFullHistory:false }`, envolto em try/catch (não quebra a criação). Webhook é configurado via `/webhook/set/{instance}` SOMENTE se `process.env.EVOLUTION_WEBHOOK_URL` existir — sem hardcode. Falta a URL de webhook: ver F-206 (precisa-decisão). Validado com `node --check api/admin/users.js`.

## F-202 | categoria: funcional | severidade: alta | status: corrigido
- Tela: api/admin/users.js:381
- Passos: 1) Admin salva a chave global pela UI → gravada em `system_settings.evolution_global_key` (DB). 2) Cria/vincula instância como padrão. 3) Dispara mensagem (action `send-message`). 4) `instKey = defInst.api_key || _evoKey()` (linha 381).
- Esperado: Quando a instância padrão não tem `api_key` própria salva, o fallback deveria usar a MESMA chave usada para gerenciar instâncias — `getSystemSetting('evolution_global_key')` (via `_evoGlobalHdrs`), como em create/QR/delete.
- Observado: O fallback usa `_evoKey()` = `process.env.EVOLUTION_APIKEY`, que é uma chave DIFERENTE da global do DB. No `.env.production` o `EVOLUTION_APIKEY` é a chave da instância `app-lumers` (`BC1D…`), não a `AUTHENTICATION_API_KEY` global. Para qualquer instância padrão que não seja a `app-lumers` (ou cujo `api_key` esteja vazio), o header `apikey` enviado não autentica → Evolution responde 401 → envio falha. Mismatch entre a chave aceita pela Evolution e a chave usada no send. Causa raiz provável do PROBLEMA 3.
- (resolvedor) Correção: api/admin/users.js (`send-message`) — fallback de chave agora é `defInst.api_key || globalKey || _evoKey()`, onde `globalKey = await getSystemSetting('evolution_global_key')` (mesma chave global usada em create/QR/delete). `_evoKey()` mantido como último fallback. Validado com `node --check api/admin/users.js`.

## F-203 | categoria: funcional | severidade: média | status: corrigido
- Tela: api/admin/users.js:519
- Passos: 1) Dispara `send-message` para N usuários. 2) Todos os envios falham (ex.: 401 da Evolution). 3) Backend monta `results` com `ok:false` por item, mas retorna `res.status(200).json({ ok: true, sent, total, results })`.
- Esperado: O status HTTP / payload deveria refletir falha total (ex.: HTTP != 200 ou `ok:false`) para o frontend sinalizar erro claramente ao usuário.
- Observado: O handler sempre retorna HTTP 200 com `ok:true` mesmo quando `sent === 0`. O erro real da Evolution fica engolido dentro de `results[].error` (e em `message_logs`), mas a resposta de topo indica sucesso. Isso mascara o PROBLEMA 3 — o admin pode achar que "enviou" sem perceber a falha sem abrir o histórico.
- (resolvedor) Correção: api/admin/users.js (`send-message`) — se `sent === 0 && total > 0`, retorna HTTP 502 com `{ ok:false, error:<primeiro results[].error>, sent, total, results }`. Se `sent > 0 && sent < total`, retorna HTTP 200 com `{ ok:true, partial:true, sent, total, results }`. Sucesso total mantém o contrato original. Campos `sent`/`total`/`results` preservados. Validado com `node --check api/admin/users.js`.

## F-204 | categoria: funcional | severidade: média | status: corrigido
- Tela: api/admin/users.js:265
- Passos: 1) Cria instância via `create-evolution-instance`. 2) Backend extrai `createdKey = data?.hash || data?.apikey || data?.instance?.apikey || ''` (linha 265). 3) Insere em `evolution_instances.api_key`. 4) Depois usa essa key no `send-message`.
- Esperado: `api_key` deve armazenar a string da apikey da instância retornada pelo `/instance/create`.
- Observado: Em versões da Evolution v2 o campo `hash` do retorno de create pode ser um OBJETO (`{ apikey: "..." }`) em vez de string. Nesse caso `data?.hash` é um objeto e é passado como arg do INSERT (libsql) — armazenando algo inválido/`[object Object]` ou lançando erro. A `api_key` resultante não autentica → `send-message` (e listagem de status) falham com 401. Contribui para o PROBLEMA 3 em instâncias criadas pelo app. (Dependente da versão da Evolution — verificar o formato real do retorno em `wpp.razzodigital.com.br`.)
- (resolvedor) Correção: api/admin/users.js (`create-evolution-instance`) — adicionado helper `pickKey(v)` que retorna `v` se string, `v.apikey` se objeto `{ apikey }`, senão `''`. `createdKey` agora é `pickKey(data.hash) || pickKey(data.apikey) || pickKey(data.instance?.apikey) || pickKey(data.instance?.hash) || ''`, garantindo string (nunca `[object Object]`) no INSERT. Validado com `node --check api/admin/users.js`.

## F-205 | categoria: funcional | severidade: baixa | status: corrigido
- Tela: api/admin/users.js:469
- Passos: 1) Dispara `send-message` com mídia base64. 2) Backend POST `/message/sendMedia/{inst}` com body `{ number, mediatype, media, caption, fileName? }` (linhas 469-475).
- Esperado: Para mídia em base64, a Evolution v2 normalmente exige/recomenda `mimetype` (e `fileName` para documentos) no payload do `sendMedia`.
- Observado: O payload não envia `mimetype`. Dependendo da versão/tipo de mídia, o envio de mídia pode falhar mesmo quando o texto funciona. Não afeta envio de texto puro (PROBLEMA 3 reportado pode incluir só texto), por isso severidade baixa — verificar contra a doc da instância em uso.
- (resolvedor) Correção: api/admin/users.js (`send-message`/sendMedia) — infere `mimetype` a partir do prefixo `data:<mime>;base64,` da mídia original e, na ausência, pela extensão de `media_name` (mapa de extensões comuns img/vídeo/áudio/doc). O campo `mimetype` só é incluído no body quando inferido (nunca vazio). Texto puro inalterado. Validado com `node --check api/admin/users.js`.

## F-206 | categoria: decisão | severidade: média | status: corrigido
- Tela: api/admin/users.js (`create-evolution-instance`)
- Contexto: Ao corrigir F-201, o código aplica `/settings/set/{instance}` automaticamente, mas o webhook (`/webhook/set/{instance}`) só é configurado SE existir `process.env.EVOLUTION_WEBHOOK_URL`. Hoje essa env não existe e não há URL de webhook definida em lugar nenhum do repositório. Para não fazer hardcode de URL, o webhook foi deixado opcional/condicional.
- Decisão (orquestrador): O webhook FAZ sentido — existe `api/n8n.js`, função que recebe transações de um workflow n8n a partir de mensagens recebidas no WhatsApp (recurso de "registro automático"). O webhook deve ser configurado automaticamente na criação da instância.
- (resolvedor) Correção: api/admin/users.js (`create-evolution-instance`) — o webhook agora é automatizado na criação da instância (best-effort, dentro do try/catch, não quebra a criação). Quando `process.env.EVOLUTION_WEBHOOK_URL` existe, faz POST `/webhook/set/{instance}` (Evolution v2) com payload `{ webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] } }`, assinando os eventos necessários ao fluxo n8n (recebimento de mensagens + estado de conexão). A URL não é hardcoded: vem de `EVOLUTION_WEBHOOK_URL`, a ser definida no Vercel apontando para o endpoint do n8n. Validado com `node --check api/admin/users.js`.

## F-207 | categoria: funcional | severidade: alta | status: corrigido
- Tela: api/admin/users.js (`create-evolution-instance`, ~linha 249-308)
- Bug reportado: ao criar uma nova instância pelo painel, a instância NÃO é configurada (settings/webhook) e nenhum erro é mostrado.
- Passos: 1) Admin → Sistema → WhatsApp → "Criar nova instância". 2) Backend faz POST `/instance/create`. 3) Em seguida chama `/settings/set/{instance}` e `/webhook/set/{instance}` dentro de try/catch.
- Esperado: settings + webhook aplicados na nova instância; se falhar, o erro real deve ser exposto (não engolido).
- Observado: As chamadas de configuração rodavam DEPOIS do create e (a) o try/catch só captura erro de REDE — `fetch` NÃO lança em HTTP 4xx/5xx — e (b) o código nunca lia/logava `r.ok` nem o corpo. Resultado: se a Evolution rejeitava o settings (timing: instância recém-criada ainda não pronta), o 4xx era engolido silenciosamente → instância nascia sem configuração, sem mensagem de erro.
- (sondagem ao vivo — Evolution v2.3.7 em wpp.razzodigital.com.br): `POST /settings/set/{instance}` responde **HTTP 404** com corpo `{"status":404,"error":"Not Found","response":{"message":["The \"X\" instance does not exist"]}}` quando a instância não está pronta/reconhecida — exatamente a janela de timing pós-create. Mesmo shape em `webhook/find`, `settings/find`, `connectionState`. (`GET /instance/fetchInstances` → HTTP 401 com a chave fallback `EVOLUTION_APIKEY`; a global válida vive em `system_settings.evolution_global_key` no DB / Vercel Encrypted, não baixável localmente, então a sondagem autenticada do create+settings não foi possível — mas o shape do erro 404 que é engolido foi confirmado e é independente de credencial.)
- (resolvedor) Correção: api/admin/users.js (`create-evolution-instance`) — settings + webhook agora são aplicados de forma ATÔMICA no body do `/instance/create` (Evolution v2 aceita os campos de settings achatados e `webhook` como objeto inline), eliminando a janela de timing. Mantida uma chamada de reforço pós-create a `/settings/set` e `/webhook/set`, mas agora CORRIGIDA: lê `r.ok` + corpo, e em falha acumula `{ ok, status, error }` num objeto `_config` (settings + webhook) e loga via `console.error` em vez de engolir. A resposta final do handler agora retorna `{ ...data, _config }`, expondo o erro real no Network/painel. Validado com `node --check api/admin/users.js`.
