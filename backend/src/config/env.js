const path = require("path");

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "inkapp-dev-secret";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "inkapp.db");

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = parseBoolean(process.env.SMTP_SECURE, false);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "";
const SMTP_REPLY_TO = process.env.SMTP_REPLY_TO || "";

const WPP_CONNECT_ENABLED = parseBoolean(process.env.WPP_CONNECT_ENABLED, false);
const WPP_CONNECT_API_URL = process.env.WPP_CONNECT_API_URL || "";
const WPP_CONNECT_SESSION = process.env.WPP_CONNECT_SESSION || "";
const WPP_CONNECT_TOKEN = process.env.WPP_CONNECT_TOKEN || "";
const WPP_CONNECT_SECRET_KEY = process.env.WPP_CONNECT_SECRET_KEY || "";
const WPP_CONNECT_SEND_PATH =
  process.env.WPP_CONNECT_SEND_PATH || "/api/{session}/send-message";

module.exports = {
  PORT,
  JWT_SECRET,
  CORS_ORIGIN,
  DB_PATH,
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
};
