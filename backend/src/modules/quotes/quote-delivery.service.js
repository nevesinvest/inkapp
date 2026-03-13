const nodemailer = require("nodemailer");
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS
} = require("../../config/env");
const { getIntegrationSettings } = require("../settings/settings.service");

let smtpTransporter = null;
let smtpTransporterCacheKey = null;

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseSmtpPort(value, fallback = 587) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < 1 || normalized > 65535) return fallback;
  return normalized;
}

function getSmtpConfig(settings = {}) {
  const host = String(settings.smtpHost || SMTP_HOST || "").trim();
  const port = parseSmtpPort(settings.smtpPort, SMTP_PORT);
  const secure = parseBoolean(settings.smtpSecure, SMTP_SECURE);
  const user = String(settings.smtpUser || SMTP_USER || "").trim();
  const pass = String(settings.smtpPass || SMTP_PASS || "").trim();

  return {
    host,
    port,
    secure,
    user,
    pass
  };
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeWhatsapp(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return null;
}

function parseContactFromText(clientContact) {
  const raw = String(clientContact || "");
  const emailMatch = raw.match(/[^\s|]+@[^\s|]+\.[^\s|]+/i);
  const digits = onlyDigits(raw);
  const whatsapp = normalizeWhatsapp(digits);

  return {
    email: normalizeEmail(emailMatch ? emailMatch[0] : ""),
    whatsapp
  };
}

function extractQuoteContact(quote) {
  const email = normalizeEmail(quote?.client_email);
  const whatsapp = normalizeWhatsapp(quote?.client_whatsapp);

  if (email || whatsapp) {
    return { email, whatsapp };
  }

  return parseContactFromText(quote?.client_contact);
}

function formatCurrencyBRL(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "A combinar";
  return numberValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatDateTimeBR(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMultilineHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br/>");
}

function buildResponseMessage({ quote, artistName, responseText, responseAmount }) {
  const lines = [
    `Oi, ${quote.client_name}!`,
    "",
    `Sua solicitacao de orcamento #${quote.id} foi respondida por ${artistName || "nosso time"}.`,
    `Estilo: ${quote.style}`,
    `Regiao do corpo: ${quote.body_part}`,
    `Tamanho estimado: ${quote.size_estimate}`,
    `Valor estimado: ${formatCurrencyBRL(responseAmount)}`,
    ""
  ];

  if (responseText) {
    lines.push("Consideracoes do tatuador:");
    lines.push(responseText);
    lines.push("");
  }

  lines.push("Se quiser, responda esta mensagem para continuarmos o atendimento.");
  lines.push("InkApp");

  return lines.join("\n");
}

function buildResponseEmailHtml({ quote, artistName, responseText, responseAmount }) {
  const safeClientName = escapeHtml(quote?.client_name || "Cliente");
  const safeArtistName = escapeHtml(artistName || "nosso time");
  const safeStyle = escapeHtml(quote?.style || "-");
  const safeBodyPart = escapeHtml(quote?.body_part || "-");
  const safeSizeEstimate = escapeHtml(quote?.size_estimate || "-");
  const safeRequestDescription = formatMultilineHtml(quote?.description || "-");
  const safeResponseText = responseText ? formatMultilineHtml(responseText) : "Sem consideracoes adicionais.";
  const quoteId = escapeHtml(quote?.id);
  const quoteCreatedAt = escapeHtml(formatDateTimeBR(quote?.created_at));
  const amountText = escapeHtml(formatCurrencyBRL(responseAmount));

  return `
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Resposta de Orcamento #${quoteId}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif;color:#172133;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6ebf3;">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(120deg,#111826,#1f2d46);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.8;">InkApp Studio</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:700;">Sua proposta esta pronta</h1>
                <p style="margin:10px 0 0;font-size:15px;opacity:0.92;">Orcamento #${quoteId} respondido por ${safeArtistName}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 12px;font-size:16px;line-height:1.55;">Oi, <strong>${safeClientName}</strong>! Obrigado por enviar seu pedido de orcamento.</p>
                <p style="margin:0;font-size:15px;line-height:1.55;color:#4a5a74;">
                  Abaixo estao os detalhes da resposta para voce avaliar com tranquilidade.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:40%;padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:13px;color:#52637d;">Valor estimado</td>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:15px;font-weight:700;color:#18243a;">${amountText}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:13px;color:#52637d;">Estilo</td>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:14px;color:#18243a;">${safeStyle}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:13px;color:#52637d;">Regiao do corpo</td>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:14px;color:#18243a;">${safeBodyPart}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:13px;color:#52637d;">Tamanho estimado</td>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:14px;color:#18243a;">${safeSizeEstimate}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:13px;color:#52637d;">Data da solicitacao</td>
                    <td style="padding:12px 14px;background:#f7f9fd;border:1px solid #e4eaf4;border-radius:10px;font-size:14px;color:#18243a;">${quoteCreatedAt}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 18px;">
                <div style="border:1px solid #e4eaf4;border-radius:12px;padding:16px;background:#fcfdff;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7b95;margin-bottom:8px;">Pedido enviado por voce</div>
                  <div style="font-size:14px;line-height:1.65;color:#22324b;">${safeRequestDescription}</div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 28px;">
                <div style="border:1px solid #d8e5ff;border-radius:12px;padding:16px;background:#eef4ff;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#4462a8;margin-bottom:8px;">Consideracoes do tatuador</div>
                  <div style="font-size:14px;line-height:1.65;color:#1f3158;">${safeResponseText}</div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px;background:#fafbfd;border-top:1px solid #e7edf6;color:#60708b;font-size:13px;line-height:1.6;">
                Se quiser ajustar detalhes ou confirmar o atendimento, responda este e-mail.
                <br/>
                <strong style="color:#22324b;">InkApp</strong> | Gestao para estudios de tatuagem e piercing
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

function canSendEmail(settings) {
  const smtpConfig = getSmtpConfig(settings);
  return Boolean(smtpConfig.host && settings.smtpFrom);
}

function getSmtpTransporter(settings) {
  const smtpConfig = getSmtpConfig(settings);
  const cacheKey = [smtpConfig.host, smtpConfig.port, smtpConfig.secure, smtpConfig.user, smtpConfig.pass].join("|");
  if (smtpTransporter && smtpTransporterCacheKey === cacheKey) {
    return smtpTransporter;
  }

  if (!smtpConfig.host) return null;

  const auth = smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined;
  smtpTransporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth
  });
  smtpTransporterCacheKey = cacheKey;

  return smtpTransporter;
}

async function sendEmailResponse({ quote, to, messageText, emailHtml, settings }) {
  if (!to) {
    return { channel: "email", status: "skipped", reason: "missing_email" };
  }

  if (!canSendEmail(settings)) {
    return { channel: "email", status: "skipped", reason: "smtp_not_configured" };
  }

  const transporter = getSmtpTransporter(settings);
  if (!transporter) {
    return { channel: "email", status: "skipped", reason: "smtp_not_configured" };
  }

  try {
    await transporter.sendMail({
      from: settings.smtpFrom,
      to,
      replyTo: toOptionalText(settings.smtpReplyTo) || undefined,
      subject: `Resposta do orcamento #${quote.id} - InkApp`,
      text: messageText,
      html: emailHtml
    });
    return { channel: "email", status: "sent" };
  } catch (error) {
    return { channel: "email", status: "failed", reason: error.message };
  }
}

function buildWppEndpoint(settings, path) {
  const baseUrl = String(settings.wppConnectApiUrl || "").trim();
  const session = String(settings.wppConnectSession || "").trim();
  if (!baseUrl || !session) return null;

  const normalizedPath = String(path || "")
    .trim()
    .replace("{session}", encodeURIComponent(session))
    .replace(/^\/+/, "");

  if (!normalizedPath) return null;
  return `${baseUrl.replace(/\/+$/, "")}/${normalizedPath}`;
}

function getWppMissingFields(settings) {
  const missing = [];
  if (!String(settings?.wppConnectApiUrl || "").trim()) {
    missing.push("wppConnectApiUrl");
  }
  if (!String(settings?.wppConnectSession || "").trim()) {
    missing.push("wppConnectSession");
  }
  return missing;
}

function buildWppHeaders(settings) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (settings.wppConnectToken) {
    headers.Authorization = `Bearer ${settings.wppConnectToken}`;
  }
  if (settings.wppConnectSecretKey) {
    headers.secretkey = settings.wppConnectSecretKey;
    headers.SecretKey = settings.wppConnectSecretKey;
  }

  return headers;
}

async function sendWhatsappResponse({ to, messageText, settings }) {
  if (!settings.wppConnectEnabled) {
    return { channel: "whatsapp", status: "skipped", reason: "wpp_connect_disabled" };
  }
  if (!to) {
    return { channel: "whatsapp", status: "skipped", reason: "missing_whatsapp" };
  }

  const endpoint = buildWppEndpoint(settings, settings.wppConnectSendPath);
  if (!endpoint) {
    return { channel: "whatsapp", status: "skipped", reason: "wpp_connect_not_configured" };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildWppHeaders(settings),
      body: JSON.stringify({
        phone: to,
        number: to,
        isGroup: false,
        message: messageText
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      return {
        channel: "whatsapp",
        status: "failed",
        reason: `HTTP ${response.status}: ${String(responseText || "").slice(0, 180)}`
      };
    }

    return { channel: "whatsapp", status: "sent" };
  } catch (error) {
    return { channel: "whatsapp", status: "failed", reason: error.message };
  }
}

async function checkWppConnection(settingsInput = null) {
  const settings = settingsInput || getIntegrationSettings();

  if (!settings.wppConnectEnabled) {
    return {
      ok: false,
      reason: "wpp_connect_disabled",
      details: "WPP Connect desativado nas configuracoes."
    };
  }

  const missingFields = getWppMissingFields(settings);
  const endpoint = buildWppEndpoint(settings, settings.wppConnectStatusPath);
  if (!endpoint) {
    const details =
      missingFields.length > 0
        ? `Preencha os campos obrigatorios do WPP Connect: ${missingFields.join(", ")}.`
        : "Configure URL da API e sessao do WPP Connect.";
    return {
      ok: false,
      reason: "wpp_connect_not_configured",
      details,
      missingFields
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: buildWppHeaders(settings)
    });

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch (_error) {
      payload = rawText || null;
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: "wpp_connect_http_error",
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
  } catch (error) {
    const causeMessage = error?.cause?.message ? ` | cause: ${error.cause.message}` : "";
    const connectionHint =
      error?.cause?.code === "ECONNREFUSED"
        ? "Conexao recusada. Verifique se o servidor WPP Connect esta em execucao no host/porta configurados."
        : null;

    return {
      ok: false,
      reason: "wpp_connect_request_failed",
      details: `${error.message}${causeMessage}`,
      endpoint,
      hint: connectionHint
    };
  }
}

async function sendQuoteResponseDelivery({
  quote,
  artistName,
  responseText,
  responseAmount,
  sendEmail,
  sendWhatsapp
}) {
  const settings = getIntegrationSettings();
  const contact = extractQuoteContact(quote);
  const normalizedResponseText = toOptionalText(responseText) || toOptionalText(quote?.response);
  const messageText = buildResponseMessage({
    quote,
    artistName,
    responseText: normalizedResponseText,
    responseAmount
  });
  const emailHtml = buildResponseEmailHtml({
    quote,
    artistName,
    responseText: normalizedResponseText,
    responseAmount
  });

  const results = [];
  if (sendEmail) {
    results.push(await sendEmailResponse({ quote, to: contact.email, messageText, emailHtml, settings }));
  }
  if (sendWhatsapp) {
    results.push(await sendWhatsappResponse({ to: contact.whatsapp, messageText, settings }));
  }

  return { contact, results };
}

module.exports = {
  extractQuoteContact,
  sendQuoteResponseDelivery,
  checkWppConnection
};
