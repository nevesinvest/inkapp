const db = require("../../db/connection");
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_REPLY_TO,
  WPP_CONNECT_ENABLED,
  WPP_CONNECT_API_URL,
  WPP_CONNECT_SESSION,
  WPP_CONNECT_TOKEN,
  WPP_CONNECT_SECRET_KEY,
  WPP_CONNECT_SEND_PATH
} = require("../../config/env");

const DEFAULT_WPP_STATUS_PATH = "/api/{session}/check-connection-session";

const SETTING_KEY_BY_FIELD = {
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpSecure: "smtp_secure",
  smtpUser: "smtp_user",
  smtpPass: "smtp_pass",
  smtpFrom: "smtp_from",
  smtpReplyTo: "smtp_reply_to",
  wppConnectEnabled: "wpp_connect_enabled",
  wppConnectApiUrl: "wpp_connect_api_url",
  wppConnectSession: "wpp_connect_session",
  wppConnectToken: "wpp_connect_token",
  wppConnectSecretKey: "wpp_connect_secret_key",
  wppConnectSendPath: "wpp_connect_send_path",
  wppConnectStatusPath: "wpp_connect_status_path"
};

const FIELD_BY_SETTING_KEY = Object.fromEntries(
  Object.entries(SETTING_KEY_BY_FIELD).map(([field, key]) => [key, field])
);

const BOOLEAN_FIELDS = new Set(["smtpSecure", "wppConnectEnabled"]);
const NUMBER_FIELDS = new Set(["smtpPort"]);
const PATH_FIELDS = new Set(["wppConnectSendPath", "wppConnectStatusPath"]);

const DEFAULT_INTEGRATION_SETTINGS = {
  smtpHost: String(SMTP_HOST || "").trim(),
  smtpPort: Number(SMTP_PORT) || 587,
  smtpSecure: Boolean(SMTP_SECURE),
  smtpUser: String(SMTP_USER || "").trim(),
  smtpPass: String(SMTP_PASS || "").trim(),
  smtpFrom: String(SMTP_FROM || "").trim(),
  smtpReplyTo: String(SMTP_REPLY_TO || "").trim(),
  wppConnectEnabled: Boolean(WPP_CONNECT_ENABLED),
  wppConnectApiUrl: String(WPP_CONNECT_API_URL || "").trim(),
  wppConnectSession: String(WPP_CONNECT_SESSION || "").trim(),
  wppConnectToken: String(WPP_CONNECT_TOKEN || "").trim(),
  wppConnectSecretKey: String(WPP_CONNECT_SECRET_KEY || "").trim(),
  wppConnectSendPath: String(WPP_CONNECT_SEND_PATH || "").trim() || "/api/{session}/send-message",
  wppConnectStatusPath: DEFAULT_WPP_STATUS_PATH
};

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizePath(value, fallback = null) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return fallback;
  if (normalized.startsWith("/")) return normalized;
  return `/${normalized}`;
}

function parseInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

const upsertSettingStmt = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = datetime('now')
`);

const deleteSettingStmt = db.prepare(`
  DELETE FROM app_settings
  WHERE key = ?
`);

const selectSettingsStmt = db.prepare(`
  SELECT key, value
  FROM app_settings
  WHERE key IN (${Object.values(SETTING_KEY_BY_FIELD)
    .map(() => "?")
    .join(", ")})
`);

const saveSettingsTx = db.transaction((pairs) => {
  pairs.forEach(({ key, value }) => {
    if (value === null || value === undefined || value === "") {
      deleteSettingStmt.run(key);
      return;
    }
    upsertSettingStmt.run(key, String(value));
  });
});

function getIntegrationSettings() {
  const settings = { ...DEFAULT_INTEGRATION_SETTINGS };
  const rows = selectSettingsStmt.all(...Object.values(SETTING_KEY_BY_FIELD));

  rows.forEach((row) => {
    const field = FIELD_BY_SETTING_KEY[row.key];
    if (!field) return;

    if (BOOLEAN_FIELDS.has(field)) {
      settings[field] = parseBoolean(row.value, settings[field]);
      return;
    }

    if (PATH_FIELDS.has(field)) {
      settings[field] = normalizePath(row.value, settings[field]);
      return;
    }

    if (NUMBER_FIELDS.has(field)) {
      settings[field] = parseInteger(row.value, settings[field]);
      return;
    }

    settings[field] = String(row.value || "").trim();
  });

  if (!settings.wppConnectSendPath) {
    settings.wppConnectSendPath = "/api/{session}/send-message";
  }
  if (!settings.wppConnectStatusPath) {
    settings.wppConnectStatusPath = DEFAULT_WPP_STATUS_PATH;
  }

  return settings;
}

function saveIntegrationSettings(payload = {}) {
  const pairs = [];

  Object.entries(SETTING_KEY_BY_FIELD).forEach(([field, key]) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;

    const rawValue = payload[field];
    let normalizedValue = null;

    if (BOOLEAN_FIELDS.has(field)) {
      normalizedValue = parseBoolean(rawValue, false) ? "true" : "false";
    } else if (PATH_FIELDS.has(field)) {
      normalizedValue = normalizePath(rawValue, null);
    } else if (NUMBER_FIELDS.has(field)) {
      const parsed = parseInteger(rawValue, null);
      normalizedValue = parsed === null ? null : String(parsed);
    } else {
      normalizedValue = normalizeOptionalText(rawValue);
    }

    pairs.push({ key, value: normalizedValue });
  });

  if (pairs.length > 0) {
    saveSettingsTx(pairs);
  }

  return getIntegrationSettings();
}

function mergeIntegrationSettings(baseSettings = {}, payload = {}) {
  const merged = {
    ...DEFAULT_INTEGRATION_SETTINGS,
    ...baseSettings
  };

  Object.keys(SETTING_KEY_BY_FIELD).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;

    const rawValue = payload[field];
    if (BOOLEAN_FIELDS.has(field)) {
      merged[field] = parseBoolean(rawValue, false);
      return;
    }
    if (PATH_FIELDS.has(field)) {
      const fallback = field === "wppConnectSendPath" ? "/api/{session}/send-message" : DEFAULT_WPP_STATUS_PATH;
      merged[field] = normalizePath(rawValue, fallback);
      return;
    }
    if (NUMBER_FIELDS.has(field)) {
      merged[field] = parseInteger(rawValue, merged[field]);
      return;
    }
    merged[field] = String(rawValue || "").trim();
  });

  if (!merged.wppConnectSendPath) {
    merged.wppConnectSendPath = "/api/{session}/send-message";
  }
  if (!merged.wppConnectStatusPath) {
    merged.wppConnectStatusPath = DEFAULT_WPP_STATUS_PATH;
  }

  return merged;
}

module.exports = {
  getIntegrationSettings,
  saveIntegrationSettings,
  mergeIntegrationSettings
};
