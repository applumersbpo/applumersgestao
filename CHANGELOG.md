# Changelog — Lumers Gestão Financeira

Todas as mudanças notáveis do projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

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
