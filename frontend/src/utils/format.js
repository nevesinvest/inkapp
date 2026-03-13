import { SAO_PAULO_TIMEZONE, normalizeDateValue } from "./timezone";

export function parseCurrency(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const negative = raw.includes("-");
  const unsigned = raw.replace(/[^\d.,]/g, "");
  if (!unsigned) return 0;

  const lastCommaIndex = unsigned.lastIndexOf(",");
  const lastDotIndex = unsigned.lastIndexOf(".");
  const separatorIndex = Math.max(lastCommaIndex, lastDotIndex);

  let parsed = 0;

  if (separatorIndex === -1) {
    parsed = Number(unsigned.replace(/[^\d]/g, "") || 0);
  } else {
    const integerPart = unsigned.slice(0, separatorIndex).replace(/[^\d]/g, "");
    const fractionPart = unsigned.slice(separatorIndex + 1).replace(/[^\d]/g, "");

    if (!fractionPart || fractionPart.length > 2) {
      parsed = Number(unsigned.replace(/[^\d]/g, "") || 0);
    } else {
      parsed = Number(`${integerPart || "0"}.${fractionPart.padEnd(2, "0")}`);
    }
  }

  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.round(parsed * 100) / 100;
  return negative ? rounded * -1 : rounded;
}

export function formatCurrency(value) {
  const numericValue =
    typeof value === "number" && Number.isFinite(value) ? value : parseCurrency(value);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(numericValue);
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = normalizeDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

export function formatDate(value) {
  if (!value) return "-";
  const date = normalizeDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    dateStyle: "medium"
  }).format(date);
}

export function formatDateShort(value) {
  if (!value) return "-";
  const date = normalizeDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}
