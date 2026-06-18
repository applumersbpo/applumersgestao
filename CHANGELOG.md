# Changelog — Lumers Gestão Financeira

Todas as mudanças notáveis do projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [v1.2.5] — 2026-06-18

### Corrigido
- **Pagamento/recebimento real de R$ 0,00 era impossível de representar (F-210)**: `paid_amount` agora distingue `NULL` (não-informado → relatório usa `amount`) de `0` (R$0 real pago → contabilizado como 0). Schema passou a aceitar `NULL` sem `DEFAULT 0`; migração única e idempotente (com flag em `system_settings`) converte legados `paid_amount = 0` em `NULL`, preservando o fallback para `amount`. No save de despesas/receitas o valor pago é lido do input cru: vazio → `NULL`, `"0"`/`"0,00"` → `0` real; ao desmarcar pago grava `NULL`. Relatório e export (regime de caixa) trocaram `t.paid_amount || t.amount` por `t.paid_amount != null ? t.paid_amount : amount`

### Notas
- Cache bumped de `lumers-v34` para `lumers-v35`

---

## [v1.2.4] — 2026-06-18

### Corrigido
- **Legados pagos sem data somem do Fluxo de Caixa (F-213)**: no regime de caixa, lançamentos `pagos` com `cash_date` e `paid_date` vazios eram excluídos; agora há fallback para `competence_date` e, por último, `due_date`, mantendo intacto o comportamento de registros que já têm data de pagamento (relatório e export)
- **Acoplamento frágil de funções compartilhadas (F-211)**: `openPayDateModal` e `clearUpcomingCache` foram movidas para `js/utils.js` (carregado cedo), eliminando a dependência de `income.js`/`bills.js` em funções definidas em arquivos carregados depois

### Notas
- **F-210** marcado como `precisa-decisão`: representar pagamento/recebimento real de R$ 0,00 exige decisão de schema/migração (distinguir 0 legado de 0 real) — não aplicado fix parcial para não criar inconsistência save↔relatório
- Cache bumped de `lumers-v33` para `lumers-v34`

---

## [v1.2.3] — 2026-06-17

### Corrigido
- **Status de instância Evolution sempre exibido como "Desconectada"**: a API normaliza `open` → `connected`, mas o frontend comparava com `'open'` — corrigido para reconhecer `'connected'` (e `'open'` por robustez) como verde/Conectada, `'connecting'` como âmbar/Conectando…
- **Webhook registrado com URL de deployment instável**: `deriveWebhookUrl` priorizava `VERCEL_URL` (URL por-deployment, instável) sobre o domínio de produção; reordenado para `APP_BASE_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → host da requisição → `VERCEL_URL` como último recurso
- Cache bumped de `lumers-v32` para `lumers-v33`

### Adicionado
- **Botão "Testar conexão" por instância Evolution**: verifica o status ao vivo na Evolution, persiste no banco e reaplica o webhook com a URL de produção correta; re-renderiza a lista após o teste

---

## [v1.2.2] — 2026-06-17

### Corrigido
- **Fuso horário em `today()`**: a função usava `new Date().toISOString()` (UTC), retornando o dia seguinte à noite no fuso BRT (UTC-3) — o que alocava lançamentos de caixa no mês errado e fazia a validação/`max` de data aceitar "amanhã". Agora deriva a data LOCAL no formato `YYYY-MM-DD`
- **Cards de resumo desatualizados ao pagar/desfazer pela lista**: ao marcar Pago/Recebido (modal de confirmação) ou Desfazer pela lista, só a lista era re-renderizada e os cards do topo (Total/Pago/A Pagar e Receita/Recebido/A Receber) ficavam errados; agora a página inteira é re-renderizada, recomputando os totais
- Alinhado o default do campo "Data de vencimento" da receita ao da despesa (default = hoje), por consistência
- Cache bumped de `lumers-v31` para `lumers-v32`

---

## [v1.2.0] — 2026-06-17

### Adicionado
- **Checkbox "Pago" / "Recebido"** nas modais de despesa e receita: ao marcar, abre um bloco com **data do pagamento/recebimento** (default = data de acionamento, hoje) e **valor pago/recebido** (default = valor digitado no campo de valor); em edição de registro já realizado, recupera a data de caixa e o `paid_amount` existentes
- Novo campo **`paid_amount`** em transações = valor efetivamente pago/recebido (default = `amount`); regime de caixa passa a considerar o valor realizado
- **Modal de confirmação de data e valor** ao marcar pago/recebido pela lista (botão de check): permite escolher a data efetiva e o valor antes de gravar, em vez de assumir a data de hoje automaticamente
- Aba **Competência × Caixa** no relatório, com exportação por filtro (o caixa passa a contar apenas valores realizados, `status = 'paid'`)

### Melhorado
- **Bloqueio de data futura**: a data de pagamento/recebimento nunca pode ser superior à data de hoje, tanto nas modais quanto na confirmação pela lista (validação + `max` no campo de data); ao violar, exibe o toast "Não é possível registrar um pagamento/recebimento com data superior à data de hoje."
- Desfazer pago/recebido (botões individuais e em massa) agora também limpa `cash_date`/`paid_date` e zera `paid_amount`
- Cache bumped de `lumers-v29` para `lumers-v30`

---

## [v1.1.5] — 2026-06-17

### Corrigido
- Alerta/card de "Contas a vencer" agora filtra por vencimento (`due_date`) dentro do mês vigente e mostra os dias restantes ("vence hoje/amanhã/em N dias"); corrigido o drift de fuso horário e o filtro de data que era engolido

---

## [v1.1.4] — 2026-06-17

### Melhorado
- Release de consolidação da refatoração de mensageria Evolution: fila de disparos (`message_dispatch`), processador assíncrono com claim atômico, receptor de webhook, cron externo configurável e barra de progresso em tempo real — todas as funcionalidades entregues em v1.1.0–v1.1.3 agora estabilizadas em produção

---

## [v1.1.3] — 2026-06-17

### Corrigido
- Consolidadas as rotas `/api/auth/login` e `/api/auth/register` dentro de `/api/auth/[action].js` para ficar dentro do limite de **12 funções serverless** do plano Hobby; URLs e comportamento de login/cadastro permanecem inalterados

---

## [v1.1.2] — 2026-06-17

### Corrigido
- Removido o cron por minuto (`* * * * *` em `vercel.json`) que era **incompatível com o plano Hobby** e estava travando os deploys de produção; o dispatcher de WhatsApp passa a ser acionado por **trigger externo** (a rota `/api/cron/dispatcher` continua funcional)

---

## [v1.1.1] — 2026-06-17

### Melhorado
- Categorias agora listadas em **ordem alfabética** nos selects das modals de despesa, receita, gasto do dia e quick-add
- Cache bumped de `lumers-v28` para `lumers-v29`

---

## [v1.1.0] — 2026-06-17

### Adicionado
- **Cliente Evolution centralizado** (`api/_lib/evolution.js`): métodos `connectionState`, `sendText`, `sendMedia`, `verifyNumbers`, `createInstance`, `connectQr`, `deleteInstance`, `setSettings`, `setWebhook` (com tolerância v1/v2), `deriveWebhookUrl`, `applySpin`, `applyVars`, `inferMimetype`, `withRetry` e `normalizeStatus` — elimina fetch inline duplicado em todo o projeto
- **Fila de disparos** (`message_campaigns` + `message_dispatch`): cada disparo cria uma campanha e enfileira um `message_dispatch` por destinatário com `scheduled_for` espaçado pela cadência — sem setTimeout no serverless
- **Processador assíncrono** (`api/cron/dispatcher.js`): claim atômico por linha (`UPDATE WHERE status IN ('pending','processing')`), retry automático (até 3 tentativas, backoff 30s), detecção de instância caída (devolve à fila), atualização de `message_campaigns.sent/failed/status`
- **Receptor de webhook** (`api/webhooks/evolution.js`): persiste `CONNECTION_UPDATE` → `evolution_instances.connection_status`, `QRCODE_UPDATED` → `evolution_instances.qr`, `MESSAGES_UPDATE`/`MESSAGES_UPSERT fromMe` → `message_logs.delivery_status`
- **Cron externo** (`cron-job.org` ou similar): URL configurável no painel admin (Sistema → WhatsApp → "Disparo automático"), secret gerenciável pelo admin com botão "Gerar/Regenerar", substituindo o cron nativo da Vercel (incompatível com plano Hobby)
- **Barra de progresso no frontend**: `_sendAdminMessage()` agora enfileira e faz polling de `GET /admin/users?resource=campaign-status&id=` a cada 2s, exibindo enviadas / falhas / na fila em tempo real
- **Novos campos de DB**: `evolution_instances.connection_status/qr/last_status_at`, `message_logs.message_id/delivery_status`
- Webhook **sempre auto-configurado** na criação de instância (URL derivada de `APP_BASE_URL` → `VERCEL_URL` → host da requisição), sem depender de `EVOLUTION_WEBHOOK_URL`
- Recurso `campaign-status` no endpoint admin/users para polling do frontend

### Melhorado
- `evolution-instances` agora persiste o status de conexão no DB após cada refresh via API, tornando o dispatcher independente de calls externas para verificar o estado
- `create-evolution-instance`: webhook configura `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED` e usa tolerância v1/v2 em `setWebhook`
- Cache bumped de `lumers-v27` para `lumers-v28`

### Corrigido
- **C-01/C-02 — status de conexão**: removida chamada dupla a `normalizeStatus()` no dispatcher e no send-message; o campo `connection_status` já chega normalizado do webhook/listagem — a re-normalização retornava 'disconnected' para qualquer valor válido, bloqueando 100% dos disparos
- **A-01 — race condition do dispatcher**: claim atômico corrigido para `WHERE status='pending'` exclusivamente; reciclagem de órfãos (`processing > 5 min`) feita em UPDATE único antes do loop, eliminando possibilidade de dois ticks reivindicarem o mesmo registro (mensagem duplicada)
- **M-01 — polling sem limite**: adicionado guarda de falhas (MAX_FAILS=10) e timeout (5 min) no polling de campanha; loop infinito e botão travado eliminados
- **B-01 — espaço em branco no texto**: `text || ' '` substituído por `text || ''` no payload de envio
- **B-02 — barra de progresso trava**: cálculo de `pct` agora inclui `skipped` para que usuários sem telefone não impeçam a barra de atingir 100%

---

## [v1.0.7] — 2026-06-17

### Corrigido
- Despesa agora **nasce pendente** (não mais como paga), de modo que o botão de marcar como paga passa a fazer sentido no fluxo
- Lógica das datas corrigida: a data de vencimento alimenta `due_date` e o badge "Vencido" volta a funcionar corretamente
- Despesa pendente **não abate mais o saldo**; o abatimento só ocorre quando a despesa é efetivamente paga
- Pagamento individual (pay/unpay) e pagamento em massa passam a controlar corretamente o `cash_date`, garantindo o abate do saldo apenas na data de pagamento

---

## [v1.0.6] — 2026-06-17

### Corrigido
- Disparo de mensagens pelo painel falhava com "Unsupported type of value": os INSERTs em `message_logs` usavam `user.id`/`user.name`, campos inexistentes no JWT (que expõe `sub`), passando `undefined` ao libsql. Corrigido para usar `user.sub` como id do remetente e buscar o nome no banco

---

## [v1.0.5] — 2026-06-17

### Corrigido
- Configuração de conexão da instância WhatsApp validada e corrigida: chave global e instância padrão ajustadas no ambiente/painel, restaurando o disparo de mensagens pela instância padrão (envio confirmado em teste — HTTP 201)

---

## [v1.0.4] — 2026-06-16

### Corrigido
- Configuração da instância (settings/webhook) agora é aplicada de forma atômica na criação (`/instance/create`) e falhas deixam de ser engolidas silenciosamente — o erro real passa a ser exposto na resposta (`_config`) e logado (F-207)

---

## [v1.0.3] — 2026-06-16

### Corrigido
- Chave de envio do broadcast agora usa a chave global do servidor (corrige falha 401 no envio pela instância padrão — F-202)
- Resposta de envio reflete a falha real em vez de sempre retornar sucesso (F-203)
- `api_key` da instância criada tratada como string mesmo quando a Evolution retorna objeto `{ apikey }` (F-204)
- `mimetype` incluído no envio de mídia base64 (F-205)

### Adicionado
- Aplicação automática das configurações da instância (`rejectCall`, `groupsIgnore`, `alwaysOnline` etc.) ao criar uma nova instância Evolution (F-201)
- Configuração automática do webhook (eventos `MESSAGES_UPSERT`/`CONNECTION_UPDATE` → n8n) na criação da instância, com URL vinda de `EVOLUTION_WEBHOOK_URL` (F-206)

---

## [v1.0.2] — 2026-06-15

### Adicionado
- Histórico de versões (changelog) acessível ao clicar na versão da barra lateral — visível apenas para admin e super admin

### Melhorado
- Estilo da versão na barra lateral: menor, centralizada e com menor destaque visual
- Cache bumped de `lumers-v25` para `lumers-v26`

---

## [v1.0.1] — 2026-06-15

### Corrigido
- Label "Data de caixa" renomeado para "Data de vencimento" nos modais de Nova Receita e Nova Despesa

### Melhorado
- Cache bumped de `lumers-v24` para `lumers-v25`

---

## [v1.0.0] — 2026-06-14

### Adicionado
- Número de versão exibido no rodapé da barra lateral

### Melhorado
- Estratégia de cache do Service Worker: HTML com Network First, JS/CSS com Stale-While-Revalidate, imagens com Cache First
- Cache bumped de `lumers-v23` para `lumers-v24` para limpar caches antigos dos usuários

### Corrigido
- Seleção de categorias no lançamento rápido (FAB) não exibia as categorias existentes
- Label "Data de caixa" renomeado para "Data de vencimento" no formulário de lançamento rápido

---

## Regra de Versionamento

A cada deploy de produção:
1. Incrementar versão em `index.html` (elemento `.sidebar-version`)
2. Adicionar entrada no topo deste arquivo com data, categoria e descrição
3. Atualizar o nome do cache em `sw.js` se arquivos estáticos mudaram
