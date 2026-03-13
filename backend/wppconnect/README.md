# WPP Connect - Instalacao e Configuracao (InkApp)

Esta pasta concentra a estrutura de configuracao do envio de respostas de orcamento por WhatsApp.

## 1. Subir o WPP Connect Server

1. Copie `.env.example` para `.env` dentro desta pasta.
2. Ajuste token/secret/session.
3. Suba o servico com Docker Compose (arquivo de exemplo):

```bash
docker compose --env-file .env -f docker-compose.example.yml up -d --build
```

Observacao: o exemplo usa um `Dockerfile` local que parte de `WPP_CONNECT_BASE_IMAGE` e aplica o core
`@wppconnect/server` na versao `WPP_CONNECT_SERVER_VERSION` para melhorar compatibilidade de QR Code.

## 2. Escanear QR Code e iniciar sessao

Use os endpoints da sua instancia WPP Connect para iniciar sessao e escanear QR Code.
Ao concluir, mantenha a mesma sessao definida em `WPP_CONNECT_SESSION`.

## 3. Configurar backend do InkApp

No `backend/.env` do InkApp, configure:

```dotenv
WPP_CONNECT_ENABLED=true
WPP_CONNECT_API_URL=http://localhost:21465
WPP_CONNECT_SESSION=inkapp
WPP_CONNECT_TOKEN=seu-token
WPP_CONNECT_SECRET_KEY=seu-secret
WPP_CONNECT_SEND_PATH=/api/{session}/send-message
```

`WPP_CONNECT_SEND_PATH` permite adaptar o endpoint de envio conforme a versao do servidor sem mudar codigo.

## 4. Teste funcional

1. Abra o painel do tatuador.
2. Em `Orcamentos Relacionados`, clique em `Responder`.
3. Marque `Enviar por WhatsApp`.
4. Envie a resposta.
5. Verifique no retorno da API (campo `delivery`) se o canal `whatsapp` ficou como `sent`.
