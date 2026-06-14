# Changelog — Lumers Gestão Financeira

Todas as mudanças notáveis do projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

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
