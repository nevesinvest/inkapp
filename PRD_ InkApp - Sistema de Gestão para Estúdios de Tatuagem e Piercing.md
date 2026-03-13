# PRD: InkApp - Sistema de Gestão para Estúdios de Tatuagem e Piercing

## 1. Introdução

O InkApp é um sistema de gestão completo e integrado, projetado para atender às necessidades específicas de estúdios de tatuagem e piercing. A plataforma visa otimizar a operação do estúdio, aprimorar a experiência do cliente e fornecer ferramentas eficientes para a gestão de agendamentos, finanças, estoque e portfólios de artistas. Este documento detalha os requisitos do produto (PRD) para o desenvolvimento do InkApp.

## 2. Visão Geral e Estratégia do Produto

### 2.1. Objetivo Principal

O objetivo central do InkApp é criar um sistema de gerenciamento completo e integrado para um estúdio de tatuagem. O sistema deve ser intuitivo para a equipe (tatuadores e gerentes) e também oferecer uma experiência profissional e fácil para os clientes, desde o primeiro contato até o pós-atendimento.

### 2.2. Público-Alvo

O sistema é destinado a três grupos de usuários principais:

| Perfil de Usuário | Descrição |
| :--- | :--- |
| **Clientes** | Pessoas que buscam agendar sessões de tatuagem, solicitar orçamentos e comprar produtos relacionados. |
| **Tatuadores** | Profissionais que necessitam de uma ferramenta para gerenciar suas agendas, interagir com clientes e exibir seus trabalhos. |
| **Gerente/Administrador** | Responsável pela supervisão geral das operações do estúdio, incluindo finanças, estoque e desempenho da equipe. |

## 3. Requisitos Funcionais

### 3.1. Página Inicial (Vitrine do Estúdio)

A página inicial do InkApp será a vitrine digital do estúdio, com um design visualmente atraente e moderno que reflita a identidade artística do local. A paleta de cores será sóbria, predominantemente preto e branco, com detalhes coloridos sutis utilizados para destacar elementos importantes, botões de ação e mensagens de alerta. As seções principais incluirão uma **Hero Section** com imagens de alta qualidade, um **Portfólio dos Artistas** exibindo os trabalhos em formato de galeria ou carrossel, um **Resumo Financeiro** (visível apenas para o Gerente), um destaque para a **Loja de Produtos** e uma seção dedicada a **Depoimentos** de clientes satisfeitos. Botões de **Call-to-Action (CTAs)** claros, como "Agendar Sessão" e "Ver Loja", guiarão a navegação do usuário.

### 3.2. Sistema de Agendamento Inteligente

O sistema de agendamento do InkApp foi concebido para ser robusto e intuitivo, atendendo tanto aos clientes quanto aos tatuadores.

#### 3.2.1. Fluxo do Cliente

O cliente iniciará o processo de agendamento selecionando o tatuador desejado e o tipo de serviço, como "Sessão de 4 horas" ou "Tatuagem Pequena". Um calendário exibirá a disponibilidade de horários do tatuador escolhido. Após selecionar a data e hora, o cliente preencherá seus dados pessoais e realizará o pagamento de um sinal ou depósito online para confirmar o agendamento. O sistema garantirá o envio de confirmações e lembretes automáticos por e-mail ou SMS para o cliente.

#### 3.2.2. Painel do Tatuador

Cada tatuador terá acesso restrito a um painel pessoal mediante login. Neste painel, será possível visualizar a agenda pessoal com todos os agendamentos confirmados. Uma funcionalidade crucial será a capacidade de bloquear horários para compromissos pessoais ou sessões de desenho, garantindo flexibilidade na gestão do tempo. Além disso, haverá uma opção de sincronização bidirecional com o Google Calendar pessoal do tatuador.

### 3.3. Ferramenta de Orçamento para Clientes

Uma ferramenta de orçamento detalhada estará disponível para os clientes solicitarem estimativas para suas tatuagens. O formulário incluirá campos para nome e contato do cliente, uma descrição detalhada da ideia da tatuagem, a possibilidade de upload de múltiplas imagens de referência, seleção do estilo da tatuagem, indicação do local do corpo e tamanho estimado, e a preferência por um tatuador específico (com a opção "Indiferente"). Após o envio, o sistema notificará automaticamente o gerente e/ou o tatuador designado para análise e resposta.

### 3.4. E-commerce e Controle de Estoque

O InkApp contará com uma **Loja Online** dedicada à venda de produtos do estúdio. Esta página de e-commerce será organizada em categorias como "Pomadas Cicatrizantes", "Roupas e Acessórios" e "Prints e Arte dos Tatuadores", com páginas de produto, carrinho de compras e checkout. O **Controle de Estoque** será integrado, garantindo a baixa automática de itens vendidos na loja online. Além disso, o sistema enviará **Alertas de Estoque Baixo** automaticamente quando um produto atingir um nível predefinido.

### 3.5. Painel de Controle Financeiro (Acesso do Gerente)

Um **Dashboard Financeiro** abrangente será acessível exclusivamente ao gerente, oferecendo uma visão clara das finanças do estúdio. As **Métricas e Relatórios** incluirão o faturamento (diário, semanal, mensal), despesas e lucros, e os ganhos por tatuador. Gráficos intuitivos facilitarão a análise de performance financeira.

### 3.6. Perfis dos Tatuadores

A página "Artistas" apresentará um perfil individual para cada tatuador. Esta página terá um layout de galeria ou grid, onde cada card exibirá a foto, nome e estilo principal do tatuador. Ao clicar no card, o usuário será direcionado ao perfil completo do artista, que incluirá foto de perfil e banner, biografia/descrição, uma galeria de imagens em grid com seu portfólio de trabalhos, e um botão proeminente "Agendar com [Nome do Artista]" que levará diretamente ao sistema de agendamento, pré-selecionando o tatuador.

### 3.7. Agendamento Interno Avançado

O sistema de agendamento interno do InkApp oferecerá **Visualizações de Calendário** diária, semanal e mensal. O **Painel do Gestor** terá uma **Agenda Consolidada** que exibirá todos os agendamentos de todos os tatuadores, com um **Código de Cores** para fácil identificação de cada profissional. **Filtros** rápidos permitirão a visualização por tatuador, tipo de serviço e status do agendamento. As **Funcionalidades de Gestão** incluirão o **Cancelamento de Agendamento** com opções de reembolso e registro do motivo, e o **Bloqueio de Agenda** por hora, dia ou semana, também com registro do motivo. A funcionalidade de **Drag & Drop** permitirá arrastar e soltar eventos para reagendamento, e as atualizações serão em tempo real. O sistema também permitirá a exportação da agenda em PDF ou sincronização com o Google Calendar, e emitirá notificações para conflitos de horário e lembretes de bloqueios programados.

## 4. Requisitos Não-Funcionais

| Categoria | Requisito |
| :--- | :--- |
| **Usabilidade** | A interface deve ser intuitiva e de fácil navegação para todos os perfis de usuário. |
| **Desempenho** | O sistema deve ter um tempo de resposta rápido, especialmente no carregamento de imagens e calendários. As atualizações devem ser em tempo real. |
| **Segurança** | Acesso restrito a dados sensíveis (financeiros e de clientes) com base no perfil do usuário. Pagamentos online seguros. |
| **Escalabilidade** | A arquitetura deve suportar o crescimento do estúdio, incluindo a adição de novos tatuadores e um volume crescente de agendamentos e vendas. |
| **Compatibilidade** | O sistema deve ser responsivo e funcionar em desktops e tablets. |

## 5. Integrações

As integrações essenciais para o InkApp incluem gateways de **Pagamentos** para processar depósitos de agendamento e vendas de produtos. A sincronização bidirecional opcional com o Google Calendar dos tatuadores será implementada para o **Calendário**. Para **Notificações**, o sistema se integrará com serviços de e-mail e SMS para o envio de confirmações e lembretes.

## 6. Considerações Futuras

Para o futuro, o InkApp poderá expandir suas funcionalidades com o desenvolvimento de um **Aplicativo Móvel** dedicado para clientes e tatuadores, a inclusão de **Recursos de Marketing** como ferramentas de e-mail marketing e gestão de redes sociais, e a implementação de **Relatórios Avançados** para análises mais aprofundadas sobre o desempenho do negócio.
