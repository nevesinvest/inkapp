const express = require("express");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest } = require("../../utils/http");
const {
  getIntegrationSettings,
  saveIntegrationSettings,
  mergeIntegrationSettings
} = require("./settings.service");
const { checkWppConnection } = require("../quotes/quote-delivery.service");

const router = express.Router();
const DEFAULT_WPP_START_PATH = "/api/{session}/start-session";
const DEFAULT_WPP_QR_PATH = "/api/{session}/qrcode-session";
const DEFAULT_WPP_GENERATE_TOKEN_PATH = "/api/{session}/{secret}/generate-token";

function isValidEmail(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function isValidSmtpPort(value) {
  if (value === undefined || value === null || value === "") return true;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return false;
  const normalized = Math.trunc(parsed);
  return normalized >= 1 && normalized <= 65535;
}

function buildWppEndpoint({ apiUrl, session, secret = "", pathTemplate }) {
  const baseUrl = String(apiUrl || "").trim().replace(/\/+$/, "");
  const normalizedSession = String(session || "").trim();
  if (!baseUrl || !normalizedSession || !pathTemplate) return null;

  const normalizedPath = String(pathTemplate)
    .replace("{session}", encodeURIComponent(normalizedSession))
    .replace("{secret}", encodeURIComponent(String(secret || "").trim()))
    .replace(/^\/+/, "");

  if (!normalizedPath) return null;
  return `${baseUrl}/${normalizedPath}`;
}

function buildWppHeaders(settings) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (settings?.wppConnectToken) {
    headers.Authorization = `Bearer ${settings.wppConnectToken}`;
  }
  if (settings?.wppConnectSecretKey) {
    headers.secretkey = settings.wppConnectSecretKey;
    headers.SecretKey = settings.wppConnectSecretKey;
  }

  return headers;
}

async function parseResponsePayload(response) {
  const rawText = await response.text();
  try {
    return rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    return rawText || null;
  }
}

function isConnectedPayload(payload) {
  if (!payload || typeof payload !== "object") return false;

  if (typeof payload.status === "boolean") {
    return payload.status;
  }

  const statusText = String(payload.status || payload.message || payload.state || "")
    .trim()
    .toLowerCase();
  if (!statusText) return false;

  if (statusText.includes("connected")) return true;
  if (statusText.includes("open")) return true;
  return false;
}

function extractQrCodeDataUrl(payload) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.qrcode,
    payload.qrCode,
    payload.base64,
    payload.qrcodeBase64,
    payload.qr
  ];

  const qrRaw = candidates.find((value) => typeof value === "string" && value.trim().length > 20);
  if (!qrRaw) return null;
  if (qrRaw.startsWith("data:image")) return qrRaw;
  return `data:image/png;base64,${qrRaw}`;
}

async function generateWppToken(settings) {
  const endpoint = buildWppEndpoint({
    apiUrl: settings.wppConnectApiUrl,
    session: settings.wppConnectSession,
    secret: settings.wppConnectSecretKey,
    pathTemplate: DEFAULT_WPP_GENERATE_TOKEN_PATH
  });
  if (!endpoint) {
    return {
      ok: false,
      reason: "wpp_token_generation_not_configured",
      details: "Configure URL da API, sessao e secret do WPP Connect."
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    return {
      ok: false,
      reason: "wpp_token_generation_http_error",
      details: `HTTP ${response.status}`,
      endpoint,
      payload
    };
  }

  const token = String(payload?.token || "").trim();
  if (!token) {
    return {
      ok: false,
      reason: "wpp_token_generation_invalid_payload",
      details: "A API do WPP Connect nao retornou token valido.",
      endpoint,
      payload
    };
  }

  return {
    ok: true,
    endpoint,
    payload,
    token
  };
}

async function startWppSession(settings) {
  const endpoint = buildWppEndpoint({
    apiUrl: settings.wppConnectApiUrl,
    session: settings.wppConnectSession,
    pathTemplate: DEFAULT_WPP_START_PATH
  });
  if (!endpoint) {
    return {
      ok: false,
      reason: "wpp_start_session_not_configured",
      details: "Configure URL da API e sessao do WPP Connect."
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildWppHeaders(settings),
    body: JSON.stringify({ waitQrCode: false })
  });
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    return {
      ok: false,
      reason: "wpp_start_session_http_error",
      details: `HTTP ${response.status}`,
      endpoint,
      payload
    };
  }

  return {
    ok: true,
    endpoint,
    payload
  };
}

async function fetchWppQrCode(settings) {
  const endpoint = buildWppEndpoint({
    apiUrl: settings.wppConnectApiUrl,
    session: settings.wppConnectSession,
    pathTemplate: DEFAULT_WPP_QR_PATH
  });
  if (!endpoint) {
    return {
      ok: false,
      reason: "wpp_qrcode_not_configured",
      details: "Configure URL da API e sessao do WPP Connect."
    };
  }

  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildWppHeaders(settings)
  });
  const contentType = String(response.headers.get("content-type") || "")
    .trim()
    .toLowerCase();

  if (contentType.startsWith("image/")) {
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const mimeType = contentType.split(";")[0] || "image/png";

    return {
      ok: true,
      endpoint,
      payload: {
        status: "qrcode_image",
        contentType: mimeType
      },
      qrCodeDataUrl: `data:${mimeType};base64,${imageBuffer.toString("base64")}`
    };
  }

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    return {
      ok: false,
      reason: "wpp_qrcode_http_error",
      details: `HTTP ${response.status}`,
      endpoint,
      payload
    };
  }

  return {
    ok: true,
    endpoint,
    payload,
    qrCodeDataUrl: extractQrCodeDataUrl(payload)
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWppQrCode(settings, options = {}) {
  const attempts = Number.isFinite(options.attempts) ? options.attempts : 40;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1500;

  let lastResult = null;
  for (let index = 0; index < attempts; index += 1) {
    const result = await fetchWppQrCode(settings);
    lastResult = result;
    if (!result.ok) return result;
    if (result.qrCodeDataUrl) {
      return { ...result, attemptsUsed: index + 1 };
    }
    if (index < attempts - 1) {
      await wait(delayMs);
    }
  }

  return {
    ...lastResult,
    attemptsUsed: attempts
  };
}

function pickWppSettingsPayload(settings) {
  return {
    wppConnectEnabled: Boolean(settings.wppConnectEnabled),
    wppConnectApiUrl: String(settings.wppConnectApiUrl || "").trim(),
    wppConnectSession: String(settings.wppConnectSession || "").trim(),
    wppConnectToken: String(settings.wppConnectToken || "").trim(),
    wppConnectSecretKey: String(settings.wppConnectSecretKey || "").trim(),
    wppConnectSendPath: String(settings.wppConnectSendPath || "").trim(),
    wppConnectStatusPath: String(settings.wppConnectStatusPath || "").trim()
  };
}

router.use(authenticate, requireRoles("gerente"));

router.get("/integrations", (_req, res) => {
  const settings = getIntegrationSettings();
  return res.json(settings);
});

router.put("/integrations", (req, res) => {
  const payload = req.body || {};

  if (!isValidEmail(payload.smtpFrom)) {
    return badRequest(res, "E-mail de origem invalido.");
  }
  if (!isValidEmail(payload.smtpReplyTo)) {
    return badRequest(res, "E-mail de resposta invalido.");
  }
  if (!isValidSmtpPort(payload.smtpPort)) {
    return badRequest(res, "Porta SMTP invalida. Informe um numero entre 1 e 65535.");
  }
  if (payload.wppConnectApiUrl && !/^https?:\/\//i.test(String(payload.wppConnectApiUrl).trim())) {
    return badRequest(res, "A URL da API WPP Connect deve comecar com http:// ou https://.");
  }

  const settings = saveIntegrationSettings(payload);
  return res.json({
    message: "Configuracoes salvas com sucesso.",
    settings
  });
});

router.post("/integrations/load-wpp", async (req, res) => {
  const currentSettings = getIntegrationSettings();
  const previewPayload = req.body || {};

  if (previewPayload.wppConnectApiUrl && !/^https?:\/\//i.test(String(previewPayload.wppConnectApiUrl).trim())) {
    return badRequest(res, "A URL da API WPP Connect deve comecar com http:// ou https://.");
  }

  const settings = mergeIntegrationSettings(currentSettings, previewPayload);
  const result = await checkWppConnection(settings);

  if (!result.ok) {
    const message = [result.details, result.hint].filter(Boolean).join(" | ");
    return res.status(400).json({
      message: message || "Nao foi possivel carregar/verificar o WPP Connect.",
      result
    });
  }

  return res.json({
    message: "WPP Connect carregado/verificado com sucesso.",
    result
  });
});

router.post("/integrations/wpp/connect-assistant", async (req, res) => {
  const currentSettings = getIntegrationSettings();
  const previewPayload = req.body || {};

  if (previewPayload.wppConnectApiUrl && !/^https?:\/\//i.test(String(previewPayload.wppConnectApiUrl).trim())) {
    return badRequest(res, "A URL da API WPP Connect deve comecar com http:// ou https://.");
  }

  const settings = mergeIntegrationSettings(currentSettings, previewPayload);
  let workingSettings = { ...settings };
  let statusCheck = await checkWppConnection(workingSettings);
  let tokenGenerated = null;

  if (!statusCheck.ok && statusCheck.reason === "wpp_connect_http_error" && statusCheck.details === "HTTP 401") {
    const tokenResult = await generateWppToken(workingSettings);
    if (!tokenResult.ok) {
      const message = [tokenResult.details, tokenResult.hint].filter(Boolean).join(" | ");
      return res.status(400).json({
        message: message || "Nao foi possivel gerar token do WPP Connect.",
        result: tokenResult
      });
    }

    tokenGenerated = tokenResult.token;
    workingSettings = {
      ...workingSettings,
      wppConnectToken: tokenGenerated
    };
    statusCheck = await checkWppConnection(workingSettings);
  }

  if (!statusCheck.ok) {
    const message = [statusCheck.details, statusCheck.hint].filter(Boolean).join(" | ");
    return res.status(400).json({
      message: message || "Nao foi possivel validar o WPP Connect.",
      result: statusCheck
    });
  }

  const alreadyConnected = isConnectedPayload(statusCheck.payload);
  let startResult = null;
  let qrResult = null;

  if (!alreadyConnected) {
    startResult = await startWppSession(workingSettings);
    if (!startResult.ok) {
      const message = [startResult.details, startResult.hint].filter(Boolean).join(" | ");
      return res.status(400).json({
        message: message || "Nao foi possivel iniciar a sessao no WPP Connect.",
        result: startResult
      });
    }

    const qrFromStart = extractQrCodeDataUrl(startResult.payload);
    if (qrFromStart) {
      qrResult = {
        ok: true,
        qrCodeDataUrl: qrFromStart,
        payload: startResult.payload,
        attemptsUsed: 1
      };
    } else {
      qrResult = await waitForWppQrCode(workingSettings, {
        attempts: 40,
        delayMs: 1500
      });
      if (!qrResult.ok) {
        const message = [qrResult.details, qrResult.hint].filter(Boolean).join(" | ");
        return res.status(400).json({
          message: message || "Nao foi possivel obter o QR Code no WPP Connect.",
          result: qrResult
        });
      }
    }
  }

  if (tokenGenerated) {
    saveIntegrationSettings({
      ...pickWppSettingsPayload(workingSettings),
      wppConnectToken: tokenGenerated
    });
  }

  const finalCheck = await checkWppConnection(workingSettings);
  const result = {
    ok: true,
    alreadyConnected,
    tokenGenerated,
    statusCheck: finalCheck.ok ? finalCheck : statusCheck,
    startSession: startResult,
    qrCode: qrResult,
    settingsPatch: tokenGenerated ? { wppConnectToken: tokenGenerated } : null
  };

  return res.json({
    message: alreadyConnected
      ? "WhatsApp ja conectado nesta sessao."
      : "Assistente executado. Escaneie o QR Code para concluir a conexao.",
    result
  });
});

module.exports = router;
