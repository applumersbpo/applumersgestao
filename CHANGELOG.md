# Changelog — Lumers Gestão Financeira

Todas as mudanças notáveis do projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [v1.36.0] — 2026-08-08

### Adicionado
- **Fundação para assistente de IA no n8n (cérebro externo) + Chatwoot** — preparado todo o lado do app para o n8n orquestrar um assistente mais completo (leitura de documentos, ações mais amplas, melhor entendimento) e para conectar o Chatwoot como canal de atendimento. Sem novos arquivos de função serverless (mantém o limite 12/12): tudo entra como novos `op` na ponte `api/n8n.js` e novos ajustes no painel.
- **Pontos de conexão pelo painel** — nova seção *Chatwoot* (URL base, access token, account ID, inbox ID e chave liga/desliga) na área de sistema. O n8n lê essas credenciais via `getConnections` e responde conversas via `sendChatwoot`, sem credenciais fixas no fluxo.
- **Regras & Base de conhecimento** — nova seção no painel com *regras gerais* em texto livre (injetadas no prompt) e uma *base de documentos* (regras/documentos/FAQ) com adicionar, ativar/desativar e excluir. Consumida pelo n8n via `getRules`. Estrutura pronta para RAG (busca semântica) no futuro — a tabela `knowledge_docs` já reserva coluna de embedding.
- **Novos `op` na ponte `api/n8n.js`** — `getConnections` (pontos de conexão do painel), `getRules` (regras + documentos ativos), `getUserContext` (contas, categorias, contas a pagar, metas e totais do mês), `createCategory`, `createAccount`, `markBillPaid` (ações completas), `getMediaBase64` (leitura de imagem/PDF/áudio) e `sendChatwoot` (resposta no Chatwoot).

### Melhorado
- **Documentação dos workflows n8n** atualizada para a nova arquitetura (n8n como cérebro, app como provedor de dados/ações e canais).

---

## [v1.35.1] — 2026-08-07

### Melhorado
- **Assistente do WhatsApp mais fluido e humano** — o "cérebro" de entendimento foi reescrito para captar a *intenção* por trás da mensagem em vez de depender de palavras-chave exatas. Agora entende gírias, erros de digitação, áudio transcrito torto, mensagens curtas ou com várias coisas juntas, e escolhe sozinho a rota certa (registrar, dar baixa, criar conta/categoria, consultar ou conversar), perguntando só o essencial. As respostas ficaram mais naturais e calorosas (menos "robô"), com exemplos de intenção guiando a classificação e um pouco mais de variação no tom.

---

## [v1.35.0] — 2026-08-07

### Adicionado
- **Lembrete diário de contas a pagar (8h)** — todo dia às 8h (horário de Brasília) o usuário recebe no WhatsApp um "bom dia" com as contas que *vencem hoje*: despesas pendentes com vencimento na data e parcelas de parcelamentos cujo dia de vencimento é hoje. Cada conta mostra descrição, valor, categoria e conta, mais o *total do dia*. Se não houver nada, avisa "hoje você não tem nenhuma conta a pagar lançada". Respeita opt-out (`daily_bills`) e envia no máximo 1x por dia por usuário.
- **Baixa de contas pagas pelo WhatsApp** — a partir do lembrete, o usuário pode responder que já pagou uma conta ("paguei a conta de luz ontem", "quitei o aluguel dia 05"); o assistente encontra a despesa pendente e dá baixa (status pago, data do pagamento). Havendo mais de uma conta com o mesmo nome, ele lista e pergunta qual foi paga.
- **Criação de categorias de receita/despesa pelo WhatsApp** — o usuário pode pedir "cria a categoria Pets" ou "adiciona categoria de receita Freelance" e o assistente cria a categoria (com emoji sugerido), evitando duplicar categorias já existentes do mesmo tipo.

---

## [v1.34.0] — 2026-08-06

### Adicionado
- **Cadastro de múltiplos lançamentos a partir de uma imagem/fatura** — quando um print ou fatura de cartão traz VÁRIAS despesas, o assistente agora lista cada lançamento (descrição/estabelecimento, valor e data), pergunta *quais* o usuário quer cadastrar (todos, números ou nenhum), pede em qual banco/conta/cartão registrar e mostra uma *tela de confirmação* com valores, descrições, categoria, conta e datas antes de gravar.
- **Datas de competência e vencimento nos lançamentos** — o assistente observa as datas e o nome do estabelecimento na imagem e pergunta se deve registrar com as *datas do documento* ou uma *nova data*. Cada lançamento passa a gravar a *data de competência* (quando o gasto ocorreu) e a *data de vencimento*; vencimentos futuros entram como "a pagar/receber" (pendente).

---

## [v1.33.1] — 2026-08-06

### Adicionado
- **Conexão ChatGPT (OpenAI) para ler imagens e documentos** — o assistente passou a usar a OpenAI como provedor primário de visão (imagens/prints) e leitura de documentos (PDF de fatura/boleto/comprovante). Basta colar a chave da OpenAI no painel (Sistema → Assistente de IA).
- **Seleção de modelo por IA em lista suspensa** — cada provedor (Groq texto, Groq visão, OpenAI visão, OpenAI áudio, Gemini) agora tem um seletor com os modelos disponíveis, cada opção indicando sua função e custo/velocidade. Valores personalizados já configurados são preservados.

### Melhorado
- **Roteamento de áudio/imagem tirado do Gemini** — imagens: OpenAI → Groq → Gemini; documentos: OpenAI → Gemini; áudio: Groq → OpenAI → Gemini. O Gemini passa a ser apenas fallback de última instância.
- **Modelo de visão do Groq corrigido** — padrão atualizado para `qwen/qwen3.6-27b` (Llama-4 Scout/Maverick foram descontinuados pelo Groq), com migração auto-corretiva de valores antigos.

---

## [v1.33.0] — 2026-08-06

### Adicionado
- **Trava de interação — só responde a quem está cadastrado** — o assistente agora só envia mensagens automáticas para números cadastrados no Lumers Flow. Números desconhecidos (inclusive contatos captados de outras instâncias) são ignorados silenciosamente, eliminando disparos indevidos e loops de bot. O fluxo de auto-cadastro fica desligado por padrão e pode ser reativado por configuração (`wa_signup_enabled`).
- **Guarda anti-loop/anti-bot** — se um mesmo número dispara muitas mensagens em sequência (mais de 8 em 1 minuto), o assistente pausa o atendimento e envia *uma única* mensagem de reativação com um código aleatório. O atendimento só é retomado se a pessoa responder exatamente com aquele código — barrando conversas automáticas entre bots sem afetar usuários reais.
- **Interações via WhatsApp no perfil do usuário** — a tela de perfil do usuário (admin) agora mostra as interações do assistente via WhatsApp (data, tipo, mensagem e resposta), separadas do "Último acesso" à plataforma.

### Melhorado
- **Modelo de visão do Groq configurável** — o modelo usado para leitura de imagens/prints via Groq passou a ser configurável no painel (`ai_groq_vision_model`), evitando quebra quando o Groq descontinua/renomeia modelos (erro 404 model_not_found). Padrão atualizado para um modelo suportado.

---

## [v1.32.0] — 2026-08-06

### Adicionado
- **Leitura de documentos/faturas (PDF) no WhatsApp** — o assistente agora entende documentos enviados (PDF de fatura de cartão, boleto, comprovante), roteando a leitura para o Gemini. A extração passou a ser estruturada, focada em faturas: banco/cartão, valores, datas de vencimento/fechamento e compras parceladas.
- **Registro de compras parceladas** — quando o usuário informa uma compra parcelada (ex.: por texto/áudio "comprei uma TV por 3500 em 8x", ou a partir de uma fatura), o assistente registra um parcelamento (valor total ÷ nº de parcelas). Ele conduz o fluxo perguntando o cartão/conta e, na primeira vez, o *dia de fechamento* e o *dia de vencimento* da fatura — guardados na conta para não perguntar de novo — e calcula o mês da primeira parcela a partir desses dias.

### Melhorado
- **Leitura de imagens/prints** — passou a usar o mesmo prompt estruturado de faturas, melhorando a extração de valores, datas e parcelamentos de recibos e prints.

---

## [v1.31.0] — 2026-08-05

### Adicionado
- **Resumo diário do mês por WhatsApp (17h)** — todo dia, às 17h (horário de Brasília), o assistente envia ao usuário (plano ativo, com telefone) um resumo do mês atual: receitas, despesas e saldo. Se a pessoa não registrou nenhum valor no dia, a mensagem inclui um lembrete convidando a interagir e registrar seus lançamentos. Envio único por dia por usuário; respeita opt-out em preferências de notificação.
- **Follow-up automático em mensagens em massa** — ao disparar uma mensagem/atualização em massa, o admin pode marcar *Follow-up*. Quem não responder recebe lembretes automáticos (a cada 3h, até 3 vezes) do tipo _"Olá, você está por aí? O que achou dessa atualização? Já testou?"_. Assim que a pessoa interage com o assistente, os follow-ups param.

### Melhorado
- **Detecção de nome no cadastro via WhatsApp** — quando um número não cadastrado inicia a conversa e a primeira mensagem não parece um nome (ex.: anúncio encaminhado, link, saudação ou pergunta), o assistente não salva mais aquilo como nome: ele identifica que não é um nome e pede, de forma clara, apenas o nome completo para prosseguir com o cadastro.

---

## [v1.30.0] — 2026-08-05

### Adicionado
- **Notificação aos admins quando um usuário envia uma sugestão de melhoria** — sempre que qualquer usuário envia uma melhoria pelo WhatsApp (comando `/melhorias` ou no modo pendente), todos os administradores com telefone cadastrado recebem uma mensagem informando quem enviou (nome/e-mail/telefone) e o conteúdo da sugestão.

---

## [v1.29.1] — 2026-08-05

### Corrigido
- **Leitura de imagens/recibos no WhatsApp** — quando o Groq (visão) falha, o assistente agora tenta o Gemini automaticamente, aumentando a taxa de sucesso. As respostas ao usuário passaram a distinguir os casos: leitura ruim/ilegível → informa que *não deu para entender* e pede reenviar mais nítido ou por texto; indisponibilidade técnica (provedor fora do ar/limite) → informa que a *função está temporariamente indisponível*; falha ao baixar a mídia → pede reenviar.
- **Erro "Unsupported type of value" ao concluir/recusar melhoria** — o campo `decided_by` estava sendo preenchido com um valor indefinido, quebrando a atualização. Corrigido para usar o ID do admin autenticado.

---

## [v1.29.0] — 2026-08-05

### Melhorado
- **Registro de lançamento no WhatsApp agora pergunta o banco/conta** — ao registrar uma receita/despesa, se o usuário não indicar a conta, o assistente pergunta em qual banco registrar (lista as contas cadastradas; aceita número, nome ou `novo <Banco>`). Se o usuário **não tiver nenhuma conta cadastrada**, o assistente informa e sugere criar a conta na hora — basta enviar o nome do banco que ele cria a conta e já registra tudo.
- **Categoria opcional no lançamento** — quando a categoria não é identificada automaticamente, o assistente oferece as categorias do usuário (número/nome) para classificar e melhorar os relatórios, com opção de `pular`. Quando dá para inferir (ex.: "almoço" → Alimentação), classifica sozinho sem perguntar.

---

## [v1.28.1] — 2026-08-05

### Corrigido
- **Logs do sistema** — as ações de melhorias e de mensagens agendadas (`improvement.update`, `message.scheduled_update`, `message.scheduled_send_now`, `message.scheduled_delete`) agora exibem rótulo colorido e aparecem no filtro por ação, em vez do código bruto. Todas as 21 ações auditadas passam a ter legenda.

---

## [v1.28.0] — 2026-08-05

### Adicionado
- **Gerenciar mensagens agendadas** — nova ação **Agendadas** na aba Usuários abre um painel com todas as campanhas de WhatsApp com envios ainda pendentes/agendados, mostrando data-hora do próximo disparo, nº de destinatários e prévia do texto. Para cada agendamento é possível **editar a mensagem**, **reagendar** (nova data/hora preservando a cadência), **disparar agora** e **excluir** (cancela os envios pendentes). Ações registradas nos logs do sistema.

---

## [v1.27.0] — 2026-08-05

### Adicionado
- **Popup de novidade do WhatsApp** — ao acessar a plataforma, o usuário vê (uma vez) um popup apresentando o assistente no WhatsApp e suas possibilidades, com um botão *Testar agora* que abre o WhatsApp já com a mensagem de teste `esse é um teste "gastei 30 com almoço"` endereçada à instância padrão. O sistema reconhece o teste e responde com uma simulação explicando como funciona. O número da instância é configurável no painel (Sistema → WhatsApp).
- **Comando `/ajuda`** — tira-dúvidas sobre o sistema. `/ajuda` mostra a visão geral; `/ajuda <pergunta>` responde via IA o que o sistema pode e não pode fazer.
- **Comando `/system` (somente admin)** — menu numerado `[1..6]` com emojis: cadastrar/editar/excluir usuário, relatório do sistema, enviar mensagem a um usuário e ver funcionalidades. Fluxo conduzido por respostas numéricas.
- **Comando `/melhorias`** — qualquer usuário envia uma sugestão pelo WhatsApp; ela é arquivada e listada no painel admin (nova aba **Melhorias**), em ordem de data, com autor, prioridade e status. Ao marcar como *Concluída* ou *Recusada*, o usuário é avisado automaticamente pelo WhatsApp.
- **Moderação do assistente** — travas de palavras proibidas (xingamentos/conteúdo sexual) e detecção de uso indevido (ex.: não-admin tentando usar `/system`). O usuário é avisado 3 vezes e, na ocorrência seguinte, tem o acesso ao assistente *bloqueado* automaticamente, com notificação a um administrador. Admins reativam via `desbloquear <e-mail>` — somente administradores ativam/inativam contas pelo WhatsApp.

---

## [v1.26.0] — 2026-08-05

### Removido
- **Opção de botões na modal de envio** — os botões de ação (resposta/link) foram removidos. O WhatsApp não suporta botões interativos nativos em conexões não-oficiais (Baileys), então o recurso não entregava valor real. A modal volta a ter apenas mensagem, mídia e agendamento. Para links, basta colá-los no texto — o WhatsApp já os torna clicáveis.

---

## [v1.25.2] — 2026-08-05

### Corrigido
- **Mensagens com botões não chegavam** — quando o WhatsApp/Baileys rejeitava os botões interativos (comum em conexões não-oficiais), o envio falhava por completo e a mensagem nunca era entregue. Agora, se os botões nativos falharem, a mensagem é enviada automaticamente como texto com os botões anexados ao final: **links** ficam clicáveis e **respostas** aparecem como opções listadas — garantindo que a mensagem sempre chegue.

---

## [v1.25.1] — 2026-08-05

### Corrigido
- **Botão "Adicionar botão" quase invisível** — na seção de botões de ação da modal de envio, o botão para adicionar usava estilo fantasma (sem borda/fundo) e passava despercebido. Agora é um botão tracejado destacado, ocupando a largura da seção.

### Melhorado
- **Agendamento ao lado do "Enviar"** — o controle de agendar saiu das opções avançadas e foi para o rodapé, ao lado do botão de envio: marque "Agendar" e escolha data/hora ali mesmo. O botão de envio passa a indicar "Agendar para N" quando o agendamento está ativo.

---

## [v1.25.0] — 2026-08-05

### Melhorado
- **UX da modal de envio de mensagem redesenhada** — o formulário deixou de ser uma pilha densa de seções com o mesmo peso visual. Agora o fluxo principal fica em destaque: campo de mensagem com os botões de IA (Criar/Melhorar) no topo, chips de variáveis e atalhos de formatação logo abaixo. As opções secundárias (cadência, agendamento, mídia e variações/spin) foram agrupadas em **"Opções avançadas"** recolhível, reduzindo a poluição visual.

### Adicionado
- **Pré-visualização ao vivo estilo WhatsApp** — uma bolha de mensagem mostra em tempo real como o texto ficará no WhatsApp (negrito, itálico, tachado, variáveis destacadas) junto com os botões de ação e o anexo de mídia, atualizando conforme você digita ou configura os botões.

---

## [v1.24.0] — 2026-08-05

### Adicionado
- **Botões na mensagem do WhatsApp** — na modal de envio (Sistema → enviar mensagem), o administrador pode adicionar até 3 botões de dois tipos: **Resposta** (resposta rápida) e **Link** (URL clicável). Os botões são enviados junto com a mensagem, inclusive em campanhas agendadas. Quando há botões, o envio de mídia é substituído. ⚠️ Em conexões não-oficiais (Baileys), o WhatsApp pode não exibir os botões em alguns aparelhos (best-effort).

---

## [v1.23.0] — 2026-08-04

### Adicionado
- **Agendamento de mensagens** — na modal de envio de mensagens (Sistema → enviar mensagem), o administrador pode marcar "Agendar envio" e escolher data/hora. As mensagens ficam na fila e são disparadas automaticamente pelo cron na data/hora escolhida, respeitando a cadência entre elas. Sem agendamento, o comportamento continua sendo envio imediato.

---

## [v1.22.2] — 2026-08-04

### Corrigido
- **Conversa do WhatsApp travava repetindo a mesma pergunta** — quando uma operação de gestão de usuário ficava pendente (ex.: "Qual usuário você quer excluir?"), qualquer mensagem seguinte — inclusive um simples "olá" — era forçada de volta para essa operação, repetindo a mesma pergunta e nunca saindo do estado. Agora só os passos de confirmação explícita (sim/não de exclusão e de envio de credenciais) prendem a conversa; uma mensagem comum encerra a operação pendente e volta ao fluxo normal.

---

## [v1.22.1] — 2026-08-04

### Corrigido
- **IA do WhatsApp voltou a responder** — o webhook da instância Evolution estava registrado com `webhookByEvents: true`, fazendo o Evolution enviar as mensagens para um subcaminho inexistente (`/api/webhooks/evolution/messages-upsert` → 404) em vez da URL base. Os botões "Criar instância" e "Testar" do painel gravavam essa configuração errada, então clicar em "Testar" re-quebrava a conexão. Ambos passam a usar `byEvents: false` (caminho-base). O registro em produção foi corrigido.

---

## [v1.22.0] — 2026-08-04

### Adicionado
- **Cota de uso da IA no painel** — em Sistema → Assistente de IA, o botão "Ver cota de uso" mostra o consumo do Groq (requisições/dia e tokens/minuto) em barras de progresso com % de uso e horário de renovação, além do status de cada provedor (Operacional / Cota esgotada / Erro). O Gemini exibe o status de saúde (a API do Google não expõe a cota restante).
- **Primeiro login obrigatório no WhatsApp** — usuário comum que nunca acessou o sistema é orientado a fazer o primeiro login no app antes de usar o assistente do WhatsApp (administradores são isentos).
- **Solicitação de acesso via WhatsApp** — número não cadastrado passa a poder solicitar acesso pelo próprio WhatsApp (coleta nome e e-mail). O pedido é enviado aos administradores, que aprovam ou recusam respondendo "aprovar #código" / "recusar #código". Ao aprovar, a conta é criada e os dados de acesso são enviados automaticamente por e-mail e WhatsApp.

---

## [v1.21.0] — 2026-08-04

### Adicionado
- **Variável `{ultimo_acesso}`** — nova variável de mensagem que insere a data do último acesso do destinatário (resolvida por destinatário no disparo, considerando o último login ou a última transação registrada). Disponível nos botões de variáveis do disparo em massa.
- **Filtro "Filtrar por acesso" no disparo em massa** — seletor que pré-seleciona automaticamente os destinatários conforme o critério escolhido: todos com WhatsApp, nunca acessaram, ou inativos há +7 / +15 / +30 dias.

### Melhorado
- **Rótulo de último acesso por destinatário** — cada linha da lista de destinatários agora mostra quando foi o último acesso do usuário (ex.: "Nunca acessou", "Acesso hoje", "Último acesso há X dias").

---

## [v1.20.1] — 2026-08-04

### Adicionado
- **Mensagem pronta "Primeiro acesso pendente"** — avisa o usuário que criou a conta mas nunca acessou, com aviso de remoção automática em 48h caso o primeiro acesso não aconteça.
- **Mensagem pronta "Sentimos sua falta"** — reengajamento para usuários inativos há alguns dias, com variações de texto (spin) e personalização por {nome}.

### Melhorado
- **Mensagem pronta "Atualização"** — texto revisado e agora anexa automaticamente o banner de atualização (`lumers-atualizacao.png`), enviado como imagem com legenda no WhatsApp.

---

## [v1.20.0] — 2026-08-04

### Adicionado
- **Escrever mensagem com IA no disparo em massa** — o modal de envio de WhatsApp ganhou um assistente de redação com dois botões: **Criar com IA** (descreva o assunto e a IA escreve a mensagem completa) e **Melhorar com IA** (escreva um rascunho e a IA aprimora a escrita). O resultado substitui o texto no campo, pronto para revisar e enviar.

### Melhorado
- **Modal de disparo maior no desktop** — a largura do modal de envio em massa aumentou (até 1040px) para dar mais visibilidade aos destinatários e à composição da mensagem.

---

## [v1.19.0] — 2026-08-04

### Adicionado
- **Telefone obrigatório ao criar usuário pelo assistente** — na criação de usuários via WhatsApp (admin), o telefone com DDD passou a ser um dado obrigatório, coletado junto com nome, e-mail e senha.
- **Notificação de boas-vindas com dados de acesso** — após criar um usuário, o assistente pergunta ao admin se deseja informar o novo usuário dos dados de acesso. Ao confirmar, envia **e-mail e WhatsApp** com login, senha e link de acesso.
- **Template de e-mail "Boas-vindas com dados de acesso"** — novo modelo de sistema (`welcome_credentials`) com login, senha e botão de acesso, usado no envio confirmado pelo admin.

### Melhorado
- **Assistente sempre exibe a senha ao admin** após criar o usuário, facilitando o repasse manual caso a notificação automática não seja desejada.

---

## [v1.18.1] — 2026-08-04

### Corrigido
- **Visual do seletor de mês no topo** — o botão do mês (agora clicável para abrir o seletor) estava deformado por conflito de estilos com os botões de navegação. Ajustado o CSS para exibir o mês e a seta de forma limpa e alinhada, com largura adequada e responsividade.

---

## [v1.18.0] — 2026-08-04

### Adicionado
- **Modal de exclusão no padrão Lumers Flow** — o `confirm()` nativo do navegador foi substituído por um modal estilizado em todas as listas de lançamentos (Despesas, Receitas, Transações, Dia a Dia, Contas a Pagar). Para itens de **parcelamento** ou **recorrência**, o modal pergunta se deseja "Excluir apenas esta" ou "Excluir todo o parcelamento/recorrência".
- **Exclusão que realmente persiste em parcelamentos/recorrências** — excluir "apenas esta" marca o mês como pulado no pai (`skip_months`), evitando que a ocorrência seja recriada pela regeneração automática; "excluir todo o parcelamento" remove o pai e todas as parcelas geradas.
- **Seletor de mês/ano** — o mês exibido no topo agora é clicável e abre um seletor rápido para saltar para qualquer mês/ano, com botão "Ir para o mês atual".
- **Assistente WhatsApp cria contas/carteiras** — pedidos como "cadastre a carteira Nubank com saldo de R$200" passam a criar uma conta com saldo inicial (não mais um lançamento de receita). O assistente também conhece as contas já cadastradas e atribui lançamentos à conta citada ("no Nubank").
- **Gestão de usuários pelo assistente (apenas admin)** — administradores podem criar, editar e excluir usuários do sistema via WhatsApp. O assistente coleta os dados necessários (nome, e-mail, senha e telefone opcional) de forma conversacional, insistindo até completar, gera senha quando solicitado e pede confirmação antes de excluir.

### Corrigido
- **Exclusão de despesas/receitas que "não apagavam"** — ocorrências de parcelamentos e recorrências voltavam ao recarregar por serem regeneradas a partir do registro-pai; agora a exclusão é respeitada.

---

## [v1.17.1] — 2026-08-04

### Melhorado
- **Leitura de prints/imagens agora via Groq (visão)** — os prints passam a ser interpretados pelo modelo de visão `meta-llama/llama-4-scout-17b-16e-instruct` da Groq (cota própria, separada do Gemini), resolvendo as falhas de cota (HTTP 429) do Gemini também nas imagens. O Gemini permanece como fallback. Com isso, tanto áudio quanto imagem rodam pela chave Groq.

---

## [v1.17.0] — 2026-08-04

### Adicionado
- **Flag "WhatsApp" nos lançamentos** — toda receita/despesa registrada pelo assistente via WhatsApp recebe uma marca de origem (`source=whatsapp`) e passa a exibir um selo **WhatsApp** na lista de lançamentos, distinguindo do que foi cadastrado pelo painel.
- **Registro de interações do assistente no painel** — nova tabela `wa_interactions` e visão em Painel → Logs → "Interações do assistente (WhatsApp)": data/hora, usuário e telefone, tipo de entrada (texto/áudio/print), a mensagem, a resposta da IA e a ação executada (lançamento, consulta, pergunta, etc.).

### Melhorado
- **Transcrição de áudio agora via Groq Whisper** — os áudios do WhatsApp passam a ser transcritos pelo `whisper-large-v3-turbo` da Groq (cota própria, separada do Gemini, e compatível com `ogg/opus`), resolvendo as falhas de cota (HTTP 429) do Gemini. O Gemini continua como fallback e segue responsável pelos prints/imagens.

---

## [v1.16.3] — 2026-08-04

### Melhorado
- **Mensagem clara quando a cota da IA de mídia estoura** — ao receber HTTP 429 (limite de cota/rate limit) do Gemini ao transcrever áudio ou ler print, o assistente agora avisa que é limite momentâneo e sugere tentar de novo em alguns minutos ou mandar por texto, em vez do erro genérico.

---

## [v1.16.2] — 2026-08-04

### Corrigido
- **Assistente não entendia áudios do WhatsApp** — o mime type dos áudios de voz vem como `audio/ogg; codecs=opus`, e o Gemini rejeitava o parâmetro `; codecs=opus`, fazendo a transcrição falhar. Agora o mime é sanitizado (só o tipo base, ex.: `audio/ogg`) antes de enviar ao Gemini — vale também para prints/imagens.

---

## [v1.16.1] — 2026-08-04

### Adicionado
- **Botão "Testar conexão" na seção de IA** — valida as chaves Groq e Gemini com uma chamada mínima real (antes mesmo de salvar), mostrando por provedor se conectou (com amostra da resposta) ou o erro exato. Facilita diagnosticar chave inválida antes de ativar o assistente.
- **Ação `test-ai-connection` em `/api/admin/users`** — endpoint de teste que exercita Groq (`groqChat`) e/ou Gemini (`geminiGenerate`) com as chaves enviadas no corpo.

### Corrigido
- **Assistente não reconhecia número já cadastrado** — a busca do usuário pelo telefone agora tolera variações do número BR: com/sem código do país `55` e com/sem o **9º dígito** do celular. A coluna `phone` é normalizada na consulta (remove espaços, parênteses, hífen, `+`), então casa mesmo com números salvos formatados.
- **Validação de telefone no cadastro** — ao criar usuário, o número é normalizado para o formato canônico `55 + DDD + 9 + 8 dígitos`, inserindo o 9º dígito quando ausente, e cadastros com telefone fora do padrão BR são rejeitados.

---

## [v1.16.0] — 2026-08-04

### Adicionado
- **Assistente de IA no WhatsApp (cérebro no app)** — o app passa a interpretar as mensagens recebidas por conta própria, com reconhecimento do **nível de acesso** (usuário comum vê só a própria conta; admin/super_admin acessam dados de todos) e do **nome do usuário** pelo número cadastrado. Registra lançamentos (receitas/despesas) por **texto, áudio e print**, **pergunta** quando está em dúvida se é receita ou despesa (conversa multi-turno) e responde consultas de saldo/resumo. Vídeo não é suportado (resposta orientando o usuário).
- **Seção "Assistente de IA" no painel (Sistema)** — gestão das chaves e modelos: **Groq** para texto/raciocínio e **Gemini** para áudio e imagens/prints, com liga/desliga. Enquanto ativa, o repasse ao n8n é ignorado.
- **`api/_lib/ai.js`** — cliente de IA: Groq (chat/JSON) e Gemini (multimodal: transcrição de áudio e leitura de imagem).
- **`api/_lib/assistant.js`** — orquestrador do assistente: lookup por telefone, controle de acesso por role, roteamento texto/áudio/imagem, registro de lançamento e estado de conversa.
- **Tabela `wa_conversations`** — estado de conversa por telefone (contexto pendente para o multi-turno + histórico curto).

### Melhorado
- **Webhook da Evolution** — quando a IA está ligada (`ai_enabled=1`), processa a mensagem no app; senão, mantém o fan-out para o n8n (compatibilidade).

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
