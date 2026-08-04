# Changelog — Lumers Gestão Financeira

Todas as mudanças notáveis do projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [v1.15.4] — 2026-08-04

### Adicionado
- **Op `evoWiring` no `/api/n8n`** — diagnóstico (e reparo opcional) da ligação Evolution → app: inspeciona o webhook registrado na instância padrão e, com `fix`, reaplica o webhook no caminho-base com `byEvents:false` para garantir a entrega dos eventos de mensagem ao app.

---

## [v1.15.3] — 2026-08-04

### Corrigido
- **Fan-out para o n8n não completava** — o webhook da Evolution respondia `200` antes de processar; em serverless (Vercel) o trabalho assíncrono após a resposta era congelado, então o `fetch` externo para o n8n nunca chegava. Agora a resposta `200` é enviada **após** concluir o processamento (incluindo o repasse), garantindo a entrega ao n8n.

---

## [v1.15.2] — 2026-08-04

### Adicionado
- **Op `setConfig` no `/api/n8n`** — permite gravar as chaves da integração (`n8n_webhook_url`, `n8n_secret`) de forma restrita, autenticada pelo secret, para provisionar a configuração sem depender do login de admin.

---

## [v1.15.1] — 2026-08-04

### Corrigido
- **Formato do fan-out para o n8n** — o repasse de mensagens recebidas passa a usar o formato nativo da Evolution (`event: "messages.upsert"`, payload em `data`), compatível com o fluxo do n8n que interpreta os gastos.

### Adicionado
- **Ops `sendMessage` e `getAudioBase64` no `/api/n8n`** — o fluxo do n8n responde ao usuário e baixa áudios **através do app**, que usa a **instância padrão definida no painel**. Assim o n8n não precisa mais conhecer instância/apikey da Evolution (credenciais permanecem no servidor).

---

## [v1.15.0] — 2026-08-04

### Adicionado
- **Integração n8n — registro automático de gastos via WhatsApp** — reativada e configurável pelo painel (Sistema → WhatsApp → Integração n8n). É possível definir a **URL do webhook do n8n** e um **secret compartilhado** (`x-n8n-secret`), com botão para gerar o secret e copiar o endpoint de callback (`/api/n8n`) para colar no fluxo do n8n.
- **Fan-out de mensagens recebidas** — o webhook interno da Evolution passa a repassar mensagens **recebidas** dos usuários (ignorando grupos e mensagens enviadas pelo próprio sistema) para o webhook do n8n configurado, mantendo intacto o rastreamento de conexão/QR/entrega. Deixar a URL em branco desativa o repasse.

### Melhorado
- **Autenticação do endpoint `/api/n8n`** — além do secret de ambiente/fallback, o endpoint passa a aceitar o secret definido no painel, permitindo alinhar as credenciais do fluxo n8n sem redeploy.

---

## [v1.14.0] — 2026-07-25

### Adicionado
- **Editor WYSIWYG de templates de e-mail** — novo modelo de edição que renderiza o e-mail e permite formatar o corpo direto, como num documento: barra de ferramentas (negrito, itálico, sublinhado, títulos, listas, alinhamento, link, cor do texto, limpar formatação), inserção de variáveis `{{ }}` e cabeçalho com logo no ponto do cursor, e alternância **Visual ⇄ HTML** para editar o código quando quiser. Não depende de CDN externo — sempre disponível. Ideal para ajustar templates existentes (que abriam como um bloco opaco no editor de blocos).
- **Seletor dos 2 modelos de builder** — ao clicar em **Editar**/**Novo** em Comunicação → Templates, o usuário escolhe entre o **Editor WYSIWYG** (texto/HTML) e o **Editor visual (blocos)**. Nenhum modelo substitui o outro; a escolha é de quem edita.

### Melhorado
- **Preview com marca** no editor WYSIWYG — botão que renderiza o e-mail com logo e variáveis de exemplo em um modal isolado (desktop/mobile), substituindo o preview lateral fixo por uma edição em tela cheia mais fluida.

---

## [v1.13.0] — 2026-07-25

### Melhorado
- **Menu lateral reorganizado por intenção de uso** — os itens foram reagrupados em **Financeiro** (Dashboard, Receitas, Despesas, Carteiras, Metas), **Análise** (Relatórios, Fluxo Anual), **Patrimônio**, **Dados** (Categorias, Importar) e **Minha Conta** (Editar Perfil). O grupo "Operação" foi dividido e "Editar Perfil" saiu de "Administração".
- **Acesso admin unificado** — em vez de vários links soltos na sidebar (Admin, Usuários, Sistema, Bancos), agora há uma entrada única **"Painel Admin"** (só para administradores); toda a navegação administrativa vive nas abas internas do painel.

### Adicionado
- **Aba "Bancos" no painel admin** — a gestão de bancos, que só existia na sidebar, passou a ser uma aba do painel.
- **Aba "Logs"** — novo espaço que consolida o **Histórico de disparos** (mensagens WhatsApp/e-mail) e os **Logs do sistema** (auditoria administrativa), antes espalhados como botões dentro de "Sistema".

### Alterado
- Abas do painel admin reordenadas: **Visão Geral › Usuários › Planos › Bancos › Comunicação › Tema › Sistema › Logs**. A aba "Dashboard" virou "Visão Geral" e "E-mail" virou "Comunicação".

---

## [v1.12.0] — 2026-07-25

### Adicionado
- **Regras de notificação automática (nova aba)** — em Admin → E-mail há uma nova aba "Regras" para definir disparos automáticos baseados no comportamento do usuário. Cada regra tem: nome, critério (**dias sem acessar o sistema** ou **dias sem registrar lançamentos**) com o número de dias, canais (**e-mail** e/ou **WhatsApp**), o modelo de e-mail a usar e/ou a mensagem de WhatsApp (com variáveis {nome}, {email}, {plano}...), além de um intervalo mínimo de reenvio (cooldown). Exemplos: "10 dias sem acessar → e-mail modelo X" e "3 dias sem lançamentos → WhatsApp + e-mail".
- **Avaliação periódica pelo cron** — o dispatcher passou a avaliar as regras ativas a cada execução, encontrar os usuários que batem no critério e disparar pelos canais escolhidos, respeitando o opt-out de e-mail e o cooldown por usuário (com throttle de no máximo 1 tentativa/dia em caso de falha transitória).

### Técnico
- Novas tabelas `notification_rules` (definição das regras) e `notification_rule_sends` (histórico de disparos, base do cooldown/throttle). Novos endpoints `GET /email/notification-rules` e `POST|DELETE /email/notification-rule` (dentro do roteador de e-mail — sem novas serverless functions). Envio de WhatsApp usa a instância Evolution padrão conectada.

---

## [v1.11.0] — 2026-07-25

### Adicionado
- **Opt-out de e-mails automáticos por usuário** — na edição de usuário há agora a opção "Receber e-mails automáticos", visível somente para contas **admin** e **super admin**. Ao desmarcar, nenhum e-mail automático (boas-vindas, lembretes de vencimento, campanhas) é enviado àquele usuário. E-mails transacionais críticos (recuperação de senha e testes manuais de envio) continuam sendo enviados normalmente. Usuário comum não pode desabilitar suas notificações e sempre recebe.
- **Override de envio confirmado pelo admin** — ao disparar uma campanha de e-mail, o painel pergunta se deseja incluir também os usuários que desabilitaram o recebimento. Confirmando, o envio é forçado a eles; caso contrário, são ignorados e o total ignorado é informado no aviso.

### Técnico
- Nova coluna `email_notifications_enabled` (padrão 1) em `users` e `force_send` (padrão 0) em `email_dispatch`. O bloqueio de opt-out é centralizado em `sendEmail()` com parâmetro `force` para bypass; a fila de campanhas propaga o override do enfileiramento até o dispatcher do cron.

---

## [v1.10.0] — 2026-07-25

### Adicionado
- **Logs do sistema (auditoria administrativa)** — nova tabela `system_log` e tela "Logs do sistema" (Sistema → Logs do sistema) que registra TODAS as ações de administradores: usuário criado/alterado/excluído, impersonação, teste de WhatsApp, alteração de configurações, geração do secret do cron, ciclo de vida das instâncias Evolution (criar/vincular/excluir/desvincular/definir padrão/atualizar chave) e envio de campanhas. Cada registro guarda quem fez (e-mail e perfil), a ação, o alvo, detalhes em JSON, o IP e a data/hora.
- **Identidade preservada na exclusão de usuário** — antes de excluir um usuário (hard delete), o sistema agora captura e registra e-mail, nome e perfil da conta excluída no log. Isso resolve a lacuna em que não era possível saber QUEM havia sido excluído após a remoção.
- **Filtros de leitura do log** — a tela de logs permite filtrar por ação, administrador (e-mail), alvo (e-mail/nome), e intervalo de datas (de/até), com paginação. O registro é best-effort: a auditoria nunca quebra a operação principal.

---

## [v1.9.3] — 2026-07-03

### Melhorado
- **Modelo atual da tela de login definido como padrão de fábrica** — os valores do modelo de login que estavam salvos no servidor (layout `centered`, cor do painel `#3A5A40`, fundo do formulário `#f8fff5`) passaram a ser o baseline embutido em `_BRAND_DEFAULTS`. Agora, mesmo sem config/cache, a tela de login já nasce nesse formato em vez de cair nos defaults antigos. Cache de brand incrementado (`v6` → `v7`) para invalidar dados antigos.

---

## [v1.9.2] — 2026-07-03

### Corrigido
- **Predefinições da tela de login agora são aplicadas em tempo real, sem esperar o carregamento da rede** — o modelo salvo (layout, cor de fundo, imagem do painel, textos/eyebrow/heading/desc, título, copyright) é aplicado a partir do cache local imediatamente ao carregar a página, antes das libs pesadas de CDN. Antes, a tela de login nascia com o modelo padrão e só "trocava" para o salvo após o `app.init()` rodar (que era bloqueado pelo download dos scripts de CDN), passando a sensação de atraso. O `fetch('/api/brand')` continua atualizando o modelo em background.

---

## [v1.9.1] — 2026-07-03

### Melhorado
- **Editor de templates de e-mail agora abre em tela cheia** — o builder visual virou um overlay full-viewport (em vez de embutido no painel do admin), com barra de ações (Voltar/Preview/Salvar) fixa no topo e o canvas do editor preenchendo toda a altura disponível. O scroll do fundo fica travado enquanto o editor está aberto e é liberado ao sair por qualquer caminho (Voltar, Salvar, troca de sub-aba ou navegação para outra página).

### Corrigido
- Fallback do editor básico voltava a ficar oculto atrás do editor em tela cheia — o overlay full-viewport agora é removido do DOM (não só desmontado/scroll liberado) antes de abrir o modal básico, que volta a ficar visível; ao fechá-lo, o usuário retorna à lista de templates.

---

## [v1.9.0] — 2026-07-03

### Melhorado
- **Novo editor visual de templates de e-mail** — substituído o GrapesJS pelo SDK Templatical (`@templatical/editor` 0.13.0, drag-and-drop Vue 3 + Tiptap). Carregado LAZY via CDN como ESM puro (sem bundler), autocontido (embute Vue e injeta o próprio CSS no shadow DOM).
- **Templates novos** abrem num layout de marca com blocos nativos (logo, título, texto, botão CTA, rodapé), totalmente editáveis bloco a bloco.
- **Merge tags `{{var}}`** (sintaxe handlebars) com autocomplete ao digitar `{{`; sobrevivem intactas até o HTML final para o backend substituir.
- Mantidos: campos Nome/Categoria/Assunto/Texto, trava de template de sistema, aviso mobile, overlays de carregamento e de erro offline (com fallback para o editor de código básico), guard de alterações não salvas e "Preview com marca".

### Adicionado
- **Pipeline de export para HTML** no save/preview: JSON do editor → `renderToMjml` → MJML → `mjml2html` → HTML com CSS inline (email-safe), via `@templatical/renderer` e `mjml-browser` (CDN).

### Corrigido
- Templates existentes (HTML salvo) são preservados ao abrir no novo editor como um bloco HTML (o Templatical não decompõe HTML em blocos visuais — ver notas de migração), agora com **banner "Template legado"** avisando que é editável como bloco único.
- **Builder travava para sempre** se o usuário voltasse/trocasse de sub-aba enquanto o editor ainda inicializava: a instância era ressuscitada num shadow DOM destacado (vazamento) e o guard de reabertura ficava preso. Ao resolver o `init()` agora revalidamos canvas/contexto e desmontamos a instância órfã.
- **Save de template vazio** agora é bloqueado com aviso ("O template está vazio.") em vez de sobrescrever silenciosamente.
- **Erro de export unificado**: a etapa `renderToMjml` passou a ser protegida pelo mesmo try/catch do `mjml2html`, com mensagem de falha consistente.
- Removido código morto: função no-op `_adminEmailBuilderDevice`, variável não lida `_emBuilderLegacy` e a opção `onError` inexistente no `init` do SDK.

---

## [v1.8.1] — 2026-07-03

### Corrigido
- **Editor visual de templates de e-mail não carregava** ("Não foi possível carregar o editor visual"). A URL do plugin `grapesjs-preset-newsletter` (v1.0.2) apontava para um arquivo inexistente (`dist/grapesjs-preset-newsletter.min.js`, HTTP 404); corrigida para o arquivo correto (`dist/index.js`).

---

## [v1.8.0] — 2026-07-03

### Adicionado
- **Editor de templates de e-mail com preview ao vivo** (iframe) mostrando o e-mail renderizado com a marca/logotipo do sistema.
- **Chips clicáveis das 9 variáveis disponíveis** e botão "Inserir cabeçalho com logo" no editor.
- **Injeção automática de marca** (`logo_url`, `app_name`, `primary_color`, `year`) em todos os e-mails transacionais e de campanha.
- **Endpoint de preview** (`POST /email/preview`) admin-only para renderizar o HTML do template.

### Melhorado
- Os 3 templates de sistema (redefinição de senha, boas-vindas, expiração de plano) agora incluem o cabeçalho com logotipo hospedado (deliverability: URL HTTPS ao invés de base64).

---

## [v1.7.1] — 2026-07-03

### Corrigido
- **Remetente padrão de e-mail** migrado para o subdomínio verificado no Resend (`app.lumersbpo.com.br`).
- **Botão de teste de e-mail** no painel admin agora exibe o erro real do provedor em vez de sempre mostrar sucesso.

---

## [v1.7.0] — 2026-07-02

### Adicionado
- **Sistema de e-mail transacional via Resend** (envio por REST API, sem SDK).
- **Reset de senha por e-mail** com link seguro e resposta anti-enumeração.
- **E-mail de boas-vindas no cadastro** (fire-and-forget).
- **Notificações do sistema com opt-in do usuário** (admin define quais existem).
- **Editor de templates de e-mail** (assunto/HTML/texto com variáveis `{{...}}`).
- **Listas de contatos e grupos de disparo** (incl. importar todos os usuários).
- **Campanhas com envio imediato ou agendado**, processadas por fila via cron.
- **Lembrete mensal de vencimento de plano** (aniversário do cadastro) por e-mail.
- **Painel admin de E-mail & Notificações** (config de remetente/chave, botão de teste, templates, listas, campanhas, tipos de notificação, log).
- **Card de "Notificações por e-mail"** nas configurações do usuário.

---

## [v1.6.2] — 2026-07-02

### Melhorado
- **Renomeação da marca "Lumers BPO" para "Lumers Flow"** em todos os pontos de exibição: título de boas-vindas do onboarding, rodapé de copyright do login, placeholder do campo de copyright no admin e mensagens de WhatsApp (assistente e confirmação de conta ativa).

---

## [v1.6.1] — 2026-06-29

Marco de release que consolida e publica a planilha de exportação reformulada introduzida na v1.6.0.

### Adicionado
- **Planilha de exportação Excel totalmente reformulada (ExcelJS)**: 1ª aba **"Resumo"** com KPIs (Total de Receitas, Total de Despesas, Saldo do Mês) e gráficos consolidados embutidos; aba **"Por Categoria"** (Receitas e Despesas, cada uma com total, % e contagem de lançamentos); abas detalhadas de **Receitas** e **Despesas**.

### Melhorado
- **Visual profissional da planilha**: cabeçalho na cor verde do sidebar (`#243D28`) com texto branco em negrito, congelamento da 1ª linha, linhas zebradas, bordas, colunas com auto-ajuste de largura e valores em formato monetário `R$ #,##0.00`.

### Corrigido
- **F-214**: gráficos renderizados offscreen — saem sempre nítidos, independentemente da aba ativa, e coerentes com o regime exportado.

---

## [v1.6.0] — 2026-06-29

### Adicionado
- **Aba "Resumo" com gráficos embutidos** na planilha de exportação (agora a 1ª página do workbook): título com nome do cliente/regime/período, cartões de KPI (Total de Receitas, Total de Despesas e Saldo do Mês) e os gráficos do relatório (Evolução, Despesas por Categoria, Fluxo de Caixa, Competência × Caixa) capturados das instâncias Chart.js via `toBase64Image()` e inseridos como imagem PNG (`worksheet.addImage`). Se uma instância de gráfico não existir (aba não renderizada), a planilha é gerada sem aquela imagem, sem quebrar.
- **Aba "Por Categoria"** consolidando total por categoria, separando **Receitas** e **Despesas**, cada seção com colunas Categoria, Total (R$), % do total e nº de Lançamentos, ordenadas por valor e com linha de total.

### Melhorado
- **Visual profissional da planilha exportada**: migração da geração de XLSX (SheetJS, sem suporte a estilo/imagem) para **ExcelJS**. Cabeçalhos na cor verde do sidebar (`#243D28`) com texto branco em negrito, primeira linha congelada (freeze), linhas zebradas em verde claro, bordas finas, colunas com **auto-ajuste de largura** pela maior célula (mín. 12 / máx. 40) e valores monetários alinhados à direita com formato `R$ #,##0.00`.
- **Ordem das abas** padronizada: 1) Resumo, 2) Por Categoria, 3) Receitas, 4) Despesas, 5) Resumo Anual. Datas exibidas como `dd/mm/aaaa`. Download via Blob/`URL.createObjectURL` mantendo o nome `Lumers_<Regime>_<ano>_<mês>_<MÊS>.xlsx` e o toast de sucesso; tratamento de erro com toast claro caso o ExcelJS esteja indisponível.

### Corrigido
- **Gráficos da aba "Resumo" agora saem corretos independentemente da aba ativa (F-214)**: antes, os gráficos eram capturados das instâncias Chart.js visíveis; como as abas Categoria/Fluxo/Comp×Caixa ficam `display:none`, seus canvases ficavam 0×0 e `toBase64Image()` retornava PNG em branco — exportando da "Visão Geral", só o gráfico ativo saía. Agora os gráficos do Excel são re-renderizados **offscreen** num container fora da viewport com canvas de dimensão explícita (960×600, `animation:false`, `responsive:false`, `devicePixelRatio:2`), garantindo PNG nítido sempre. Refatoração extraiu builders de config (`buildMainChartConfig`/`buildCatChartConfig`/`buildCashChartConfig`/`buildCompCaixaChartConfig`) reaproveitados pela renderização visível e pelo export. A seleção dos gráficos da aba Resumo passou a ser **coerente com o regime exportado** (competência → Evolução + Categorias; caixa → Fluxo de Caixa + Categorias; Comp×Caixa → gráfico do regime selecionado + Categorias), evitando rotular como "Caixa" um gráfico de competência.

### Notas
- Adicionado CDN do ExcelJS (`exceljs@4.4.0`) em `index.html`; o `xlsx@0.18.5` permanece carregado para os demais usos (admin/import).
- Cache bumped de `lumers-v39` para `lumers-v40`.

---

## [v1.5.0] — 2026-06-18

### Adicionado
- **Badge "Parcelado"/"Recorrente" nas linhas de despesa**: em `expenses.js` (`expenseRow`) e `transactions.js` (`transactionRowTx`), cada linha agora exibe um badge discreto: `badge-installment` (azul/primary) se `transaction_type === 'installment'`; `badge-recurring` (teal/info) se `template_id` estiver preenchido em outros tipos; nenhum badge nos gastos avulsos. Helper `txTypeBadge(t)` adicionado a `utils.js`. Classes `.badge-installment` e `.badge-recurring` adicionadas ao CSS.
- **Parcelas e recorrentes incluídos no total de despesas e saldo do dashboard**: `totalExpense` e `expPaid` em `dashboard.js` agora somam todos os `EXPENSE_TYPES` (`expense`, `installment`, `general`, `daily`), via `allExpenses`. `saldoProjetado` e `saldoReal` passam a refletir todas as saídas do mês. `overdue` e `upcoming` atualizados para o mesmo conjunto. Contagem de "contas em aberto" usa `allExpenses`. Os cards informativos "Gastos Gerais" e "Parcelas do Mês" continuam exibindo sub-totais (`totalGeneral`, `instTotal`/`instPaid`) apenas como detalhe — não são somados ao KPI novamente, evitando double-count.
- **Parcelamento no Lançamento Rápido (FAB)**: o modal "Lançamento rápido" agora suporta parcelamento de despesas. Abaixo do campo Valor aparece o checkbox "Parcelar esta despesa" com bloco de configuração (nº de parcelas mín 2–360, dia de vencimento opcional, helper em tempo real "Nx de R$X = R$Y total"). Ao salvar no modo parcelado, cria um registro em `db.installments` com `start_month`/`start_year` e chama `generateInstallmentTransactions`; se houver data de vencimento preenchida, a 1ª parcela do mês é marcada como paga. Usa IDs próprios (`fab-parcel-cb`, `fab-parcel-block`, `fab-parcel-count`, `fab-parcel-day`, `fab-parcel-helper`, `fab-amount-label`) para não colidir com o modal de Novo Gasto.

### Alterado
- **Texto "Parcelar esta compra" → "Parcelar esta despesa"** no modal de Novo Gasto (`js/pages/expenses.js`).
- **Toggle Despesa/Receita no FAB** (`fabSetType`): ao mudar para Receita, oculta o bloco de parcelamento e desmarca o checkbox; ao voltar para Despesa, exibe o bloco novamente. O label do campo Valor alterna entre "Valor (R$)" e "Valor da parcela (R$)" conforme o estado do checkbox.

### Corrigido
- **Schema da tabela `installments` — colunas `start_month`, `start_year` e `account_id` agora persistem corretamente** (DDL `CREATE TABLE` + migração PRAGMA idempotente via `ALTER TABLE` + allowlist `FIELDS` em `api/data/[name].js` e `api/data/[name]/[id].js`). Sem essa correção, os três campos eram descartados silenciosamente pelo filtro de body, tornando a geração index-aware/eager de parcelas inoperante em qualquer banco novo ou já existente. A migração PRAGMA garante compatibilidade com bases de produção existentes sem risco de falha por coluna já presente.
- **Parcelas materializadas integralmente na criação** (`generateAllInstallmentTransactions` em `js/db.js`): ao criar um parcelamento, todas as N transações mensais são gravadas imediatamente no banco — não apenas a do mês corrente. Relatórios e Fluxo Anual (`js/pages/reports.js`, `api/data/[name].js`) passam a enxergar parcelas de meses futuros sem necessidade de "visitar" cada mês. Fix do `today()` no FAB (linha que chamava `today` sem parênteses, causando NaN em start_month/start_year) e remoção de leitura redundante do campo `competence`. Badge "Parcelado"/"Recorrente" adicionado ao `transactionRow` do dashboard (`js/pages/dashboard.js`).

### Notas
- Cache bumped de `lumers-v38` para `lumers-v39`

---

## [v1.4.0] — 2026-06-18

### Adicionado
- **Parcelamento direto no modal "Novo Gasto"**: checkbox "Parcelar esta compra" transforma o lançamento avulso em um registro de parcelamento. O label do campo Valor muda dinamicamente para "Valor da parcela (R$)" e um helper em tempo real exibe o resumo (ex: "10x de R$500,00 = R$5.000,00 total"). Campos adicionais: nº de parcelas (mín 2, máx 360) e dia de vencimento (auto-preenchido a partir da data de vencimento do gasto). Ao marcar "Pago", a 1ª parcela já é registrada como quitada. Valida categoria obrigatória, parcelas ≥ 2 e valor > 0.
- **Modal de pagamento de parcelas com múltiplas opções** (`openPayInstallmentModal`): substituiu o botão "Pagar Nª" nos cards de parcelamento. O modal exibe parcelas restantes, valor mensal, atalhos "Pagar 1ª" e "Quitar tudo (N parcelas — R$X)", campo numérico editável para quantas parcelas pagar, campo de data (padrão hoje, não permite data futura), e total atualizado em tempo real.
- **Pagamento de N parcelas de uma vez** (`payInstallmentN`): paga N parcelas simultaneamente. Atualiza `paid_installments` no registro, marca a transação do mês corrente como paga, e — para parcelamentos com `start_month`/`start_year` — retroativamente marca como pagas todas as transações já materializadas em meses futuros que se tornaram pré-pagas.

### Corrigido
- **Double-count em pré-pagamento (consistência crítica)**: `generateInstallmentTransactions` agora é *index-aware*. Para parcelamentos criados com `start_month`/`start_year`, calcula o índice da parcela para o mês em questão (`idx = meses desde o start + 1`). Se `idx > total`, o mês está fora do ciclo e não gera nada. Se `idx ≤ paid_installments`, a parcela foi pré-paga e a transação é gerada/atualizada como `status: 'paid'` — não como pendente — evitando que meses futuros inflem o "A pagar". Parcelamentos legados sem `start_month`/`start_year` mantêm o comportamento anterior (fallback seguro).

### Corrigido (pós-QA)
- **F-01 — Desfazer parcela inconsistente com pagamento em lote**: `unpayInstallment` agora reverte de forma consistente. Para parcelamentos com `start_month`/`start_year`, varre todas as transações do parcelamento e reverte para `pending` (status/paid_date/cash_date/paid_amount) qualquer parcela cujo índice seja > `newPaid` — garantindo que o número de tx pagas coincida exatamente com `paid_installments`. Parcelamentos legados mantêm o comportamento anterior (só reverte o mês corrente). `clearUpcomingCache` é chamado ao final.
- **F-02 — account_id não propagado para parcelas**: (1) `saveExpense` inclui `account_id` no `instRecord`; (2) `generateInstallmentTransactions` propaga `account_id: inst.account_id || ''` nas transações geradas; (3) `payInstallmentN` inclui `account_id` ao criar transação avulsa (mês sem tx pré-gerada).
- **F-03 — Off-by-one em helper de parcela**: condição `count > 2 && amt <= 0` corrigida para `count >= 2 && amt <= 0`, cobrindo o caso de 2 parcelas.
- **NB-01 — `payInstallment` (dead code)**: verificado que não há nenhuma referência externa; função removida. Referência obsoleta no array `_IMP_MUTATION_HANDLERS` (whitelist de impersonação) também removida. **Regressão corrigida**: `openPayInstallmentModal` adicionado à whitelist de impersonação read-only (substitui o antigo `payInstallment` como gatilho do botão "Pagar" nos cards de parcelamento).
- **NB-02 — Comentário sobre paid_date fallback em geração tardia**: documentado em `generateInstallmentTransactions` que `today()` é usado como melhor fallback disponível quando a parcela pré-paga é gerada tardiamente (sem passar pelo sweep de `payInstallmentN`).
- **NB-04 — Nº da parcela no nome da transação**: `generateInstallmentTransactions` e `payInstallmentN` (tx avulsa) agora incluem `(idx/total)` no campo `name` das transações geradas para parcelamentos com `start_month`/`start_year`; parcelamentos legados mantêm o nome original.

### Notas
- Cache bumped de `lumers-v37` para `lumers-v38` (invalidar cache para distribuir fixes de db.js e installments.js)

---

## [v1.3.0] — 2026-06-18

### Adicionado
- **Acesso de admin/superadmin à conta do usuário ("Ver como usuário"), somente leitura e com auditoria**: admin e super_admin podem abrir a conta de qualquer usuário e navegar com a mesma visão dele (dashboard, receitas, despesas etc.) sem poder alterar nada. Botões "Acessar conta" na lista e no perfil do usuário (página Admin → Usuários). Arquitetura: o backend emite um token de impersonação dedicado (`POST /api/admin/impersonate`) com payload rebaixado (`is_admin: false`, `role: 'user'`, `imp: true`, `imp_by`/`imp_by_email`) e expiração curta de 2h — o cliente nunca envia `user_id`, o backend filtra tudo por `token.sub`. Imposição **server-side** de somente-leitura: endpoints de dados/usuário rejeitam qualquer método ≠ GET com HTTP 403, e endpoints admin bloqueiam totalmente o token de impersonação. Cada acesso é registrado na tabela `impersonation_logs` (admin, alvo, data). No frontend: banner fixo "Vendo como <usuário> — somente leitura" com botão Sair, ocultação dos controles de criar/editar/excluir/pagar e do FAB, persistência via `localStorage` (sobrevive a recarga) e retorno limpo ao painel admin (inclusive quando a sessão de 2h expira)

### Melhorado
- **Modo somente-leitura mais coerente na impersonação**: a varredura de ocultação no frontend passou a mirar uma whitelist explícita de funções de mutação (criar/editar/excluir/pagar/seleção em massa/importar/salvar), em vez de um regex genérico de verbos — assim modais de **visualização** que compartilham verbos (changelog, histórico de avaliações, histórico de mensagens) e ações de navegar/exportar permanecem disponíveis ao admin. Defesa em profundidade: `POST /api/brand` agora rejeita explicitamente o token de impersonação (`isImpersonation` → 403), em linha com os demais endpoints
- **UX read-only nas listas**: os botões de ação das linhas (pagar/receber/editar/excluir/ativar e seleção em massa) usam `data-action` com listener delegado, escapando da varredura de onclick — ficavam visíveis e tomavam 403 ao clicar. Agora uma regra CSS declarativa escopada (`body.impersonating <lista> .t-actions`) os oculta nas listas de despesas, receitas, diário, contas a pagar, bancos, contas, categorias e recorrências, além da barra de seleção em massa (`#bulk-bar`/`.bulk-cb-wrap`). A lista de Transações foi mantida intencionalmente fora da regra porque sua `.t-actions` também hospeda o **valor** da transação (controle de leitura)
- **Consolidação do endpoint de impersonação para caber no limite de funções serverless (plano Hobby = 12)**: a lógica antes em `api/admin/impersonate.js` (13ª função) foi movida para dentro de `api/admin/users.js` como a action `impersonate` (mesmo padrão de `create-user`, `send-message` etc.), e o arquivo dedicado foi removido — voltando a 12 funções. O frontend passou a chamar `POST /api/admin/users` com `{ action: 'impersonate', targetUserId }`. Todas as garantias de segurança foram preservadas: guards de topo (`isImpersonation` → 403 anti-escalonamento, `is_admin` obrigatório → 403), token sempre rebaixado (`is_admin:false`, `role:'user'`, `imp:true`), expiração de 2h, validação do alvo (400/404) e auditoria em `impersonation_logs`

### Corrigido
- **"Movimentações recentes" do dashboard admin não atualizava com lançamentos novos**: a query usava `ORDER BY t.created_at DESC` lexicográfico sobre uma coluna TEXT com formatos de data **mistos** — inserts gravam ISO via `toISOString()` (`2026-06-18T20:00:00.000Z`, com `T`) enquanto o `DEFAULT` do schema é `datetime('now')` (`2026-06-18 20:00:00`, com espaço). Como `' '` (0x20) < `'T'` (0x54), a ordenação textual jogava todas as linhas no formato-espaço para baixo das ISO independentemente do tempo real, escondendo os lançamentos recentes. Trocado por `ORDER BY datetime(t.created_at) DESC`, que normaliza ambos os formatos para um valor comparável (`LIMIT 10` e colunas inalterados)

### Segurança
- **Hardening do `JWT_SECRET` (sem fallback forjável em produção)**: a resolução do segredo em `api/_lib/auth.js` foi centralizada e endurecida. Em produção (`VERCEL_ENV === 'production'` ou `NODE_ENV === 'production'`) a ausência de `JWT_SECRET` agora **falha alto** (`throw new Error('JWT_SECRET não configurado — abortando por segurança')`) em vez de cair num segredo embutido no código — eliminando o risco de qualquer pessoa com acesso ao código-fonte forjar tokens (inclusive os de impersonação) e comprometer contas. Em dev/local, mantém-se um fallback explícito (`dev-only-insecure-secret`) com `console.warn`, para não quebrar o desenvolvimento. A lógica de assinatura/verificação (HS256, expiração, payload) permanece inalterada. **Requer que a env `JWT_SECRET` esteja configurada no Vercel (produção) antes do deploy.**

### Notas
- Cache bumped de `lumers-v35` para `lumers-v36`

---

## [v1.2.5] — 2026-06-18

### Corrigido
- **Pagamento/recebimento real de R$ 0,00 era impossível de representar (F-210)**: `paid_amount` agora distingue `NULL` (não-informado → relatório usa `amount`) de `0` (R$0 real pago → contabilizado como 0). Schema passou a aceitar `NULL` sem `DEFAULT 0`; migração única e idempotente (com flag em `system_settings`) converte legados `paid_amount = 0` em `NULL`, preservando o fallback para `amount`. No save de despesas/receitas — e também no modal de confirmação de pagamento/recebimento (botão check da lista, `openPayDateModal`) — o valor pago é lido do input cru: vazio → `NULL`/`amount`, `"0"`/`"0,00"` → `0` real (antes o modal mascarava o R$0, caindo no valor cheio); ao desmarcar pago grava `NULL`. Relatório e export (regime de caixa) trocaram `t.paid_amount || t.amount` por `t.paid_amount != null ? t.paid_amount : amount`. A migração `0 → NULL` passou a rodar num batch transacional (libsql) para atomicidade

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
