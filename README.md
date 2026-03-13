# InkApp

Sistema de Gestão para Estúdios de Tatuagem e Piercing, implementado a partir do PRD fornecido.

## Stack

- Backend: Node.js + Express + SQLite (`better-sqlite3`) + JWT
- Frontend: React + Vite + React Router + Recharts

## Módulos implementados

- Autenticação por perfil (`cliente`, `tatuador`, `gerente`)
- Página inicial tipo vitrine com artistas, loja e depoimentos
- Agendamento inteligente:
  - consulta de disponibilidade por artista e serviço
  - bloqueio de agenda
  - prevenção de conflito
  - atualização de status e reagendamento
- Ferramenta de orçamento com imagens de referência
- E-commerce com carrinho, pedido e baixa automática de estoque
- Alertas de estoque baixo
- Dashboard financeiro para gerente:
  - faturamento, despesas e lucro
  - ganhos por tatuador
  - timeline financeira
- Painel do tatuador e painel consolidado do gerente

## Estrutura

```text
inkapp/
  backend/
  frontend/
  PRD_ InkApp - Sistema de Gestão para Estúdios de Tatuagem e Piercing.md
```

## Como rodar

### Opção simples (recomendada)

```bash
npm run dev
```

Isso sobe:
- Frontend em `http://localhost:3100`
- Backend em `http://localhost:4100/api`

### Opção manual (2 terminais)

```bash
$env:PORT="4100"
$env:CORS_ORIGIN="http://localhost:3100"
npm --prefix backend run dev
```

```bash
$env:VITE_API_URL="http://localhost:4100/api"
npm --prefix frontend run dev -- --port 3100
```

## Usuários de demonstração (seed)

- Gerente: `gerente@inkapp.local` / `123456`
- Tatuador: `luna@inkapp.local` / `123456`
- Cliente: `cliente@inkapp.local` / `123456`

## Observações

- O backend cria e popula automaticamente o banco SQLite em `backend/data/inkapp.db` na primeira execução.
- Integrações externas (gateway de pagamento, Google Calendar, SMS/e-mail real) estão preparadas como fluxo de dados e notificações internas, podendo ser conectadas em uma próxima etapa.
