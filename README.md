# Visibill — App de Controle Financeiro

PWA de controle financeiro multi-usuário. Backend: PocketBase. Automação WhatsApp: N8N + Evolution API.

## Setup

1. Clone o repositório
2. Copie `js/config.example.js` para `js/config.js` e preencha as credenciais
3. Configure um servidor PocketBase com as coleções necessárias
4. Faça o deploy dos arquivos para a pasta pública do PocketBase (`pb_public/`)

## Stack

- HTML / CSS / JS puro (PWA)
- PocketBase v0.38 (backend + auth)
- N8N + Evolution API (automação WhatsApp)
- Service Worker (cache offline)
