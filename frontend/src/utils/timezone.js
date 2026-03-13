export const SAO_PAULO_TIMEZONE = "America/Sao_Paulo";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseDateOnlyString(value) {
  if (!DATE_ONLY_PATTERN.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map((item) => Number(item));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function getSaoPauloParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const mapped = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      mapped[part.type] = part.value;
    }
  });

  return {
    year: mapped.year,
    month: mapped.month,
    day: mapped.day,
    hour: mapped.hour,
    minute: mapped.minute
  };
}

function parseShortOffset(offsetText) {
  const match = String(offsetText || "").match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return 0;

  const signal = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);

  return signal * (hours * 60 + minutes);
}

function getTimeZoneOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIMEZONE,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const offsetPart = parts.find((part) => part.type === "timeZoneName");
  return parseShortOffset(offsetPart?.value);
}

export function normalizeDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const parsedDateOnly = parseDateOnlyString(value);
    if (parsedDateOnly) {
      const { year, month, day } = parsedDateOnly;
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateInputSaoPaulo(value = new Date()) {
  const date = normalizeDateValue(value);
  if (!date) return "";
  const parts = getSaoPauloParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isoToDateTimeLocalSaoPaulo(value) {
  const date = normalizeDateValue(value);
  if (!date) return "";
  const parts = getSaoPauloParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateTimeLocalSaoPauloToIso(value) {
  const match = String(value || "").match(DATETIME_LOCAL_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const initialOffset = getTimeZoneOffsetMinutes(new Date(utcMs));
  utcMs -= initialOffset * 60 * 1000;

  const correctedOffset = getTimeZoneOffsetMinutes(new Date(utcMs));
  if (correctedOffset !== initialOffset) {
    utcMs -= (correctedOffset - initialOffset) * 60 * 1000;
  }

  return new Date(utcMs).toISOString();
}

export function addMinutesToDateTimeLocalSaoPaulo(value, minutes) {
  const iso = dateTimeLocalSaoPauloToIso(value);
  if (!iso) return "";
  const result = new Date(new Date(iso).getTime() + Number(minutes || 0) * 60 * 1000);
  return isoToDateTimeLocalSaoPaulo(result);
}
