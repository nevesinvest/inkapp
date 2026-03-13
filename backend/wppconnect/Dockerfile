ARG BASE_IMAGE=wppconnect/server-cli:latest
FROM ${BASE_IMAGE}

ARG WPP_CONNECT_SERVER_VERSION=2.9.0

WORKDIR /usr/src/wpp-server

# Atualiza o core do servidor para uma versao com melhor compatibilidade de QR Code.
RUN npm install --no-save @wppconnect/server@${WPP_CONNECT_SERVER_VERSION} \
  && npm cache clean --force
