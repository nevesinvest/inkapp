import { useEffect, useState } from "react";
import { formatCurrency, parseCurrency } from "../utils/format";

function formatDecimal(value) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function clampMinValue(value, min) {
  if (typeof min === "number" && Number.isFinite(min)) {
    return Math.max(min, value);
  }
  return value;
}

function normalizeExternalValue(rawValue, min) {
  return clampMinValue(parseCurrency(rawValue), min);
}

function parseDigitsAsCurrency(rawValue, min) {
  const digits = String(rawValue ?? "").replace(/\D/g, "");
  if (!digits) return clampMinValue(0, min);
  const parsedValue = Number(digits) / 100;
  return clampMinValue(parsedValue, min);
}

export function CurrencyInput({
  value,
  onValueChange,
  min = 0,
  disabled = false,
  required = false,
  placeholder = "R$ 0,00",
  inputRef = null
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(
    formatCurrency(normalizeExternalValue(value, min))
  );

  useEffect(() => {
    const normalizedValue = normalizeExternalValue(value, min);
    setDisplayValue(isFocused ? formatDecimal(normalizedValue) : formatCurrency(normalizedValue));
  }, [value, isFocused, min]);

  function handleChange(event) {
    const rawValue = event.target.value;
    const digits = String(rawValue ?? "").replace(/\D/g, "");
    if (!digits) {
      const normalizedValue = clampMinValue(0, min);
      onValueChange(normalizedValue);
      setDisplayValue(normalizedValue === 0 ? "" : formatDecimal(normalizedValue));
      return;
    }

    const normalizedValue = parseDigitsAsCurrency(rawValue, min);
    onValueChange(normalizedValue);
    setDisplayValue(formatDecimal(normalizedValue));
  }

  function handleFocus() {
    const normalizedValue = normalizeExternalValue(value, min);
    setIsFocused(true);
    setDisplayValue(normalizedValue === 0 ? "" : formatDecimal(normalizedValue));
  }

  function handleBlur() {
    const normalizedValue = normalizeExternalValue(displayValue || 0, min);
    setIsFocused(false);
    onValueChange(normalizedValue);
    setDisplayValue(formatCurrency(normalizedValue));
  }

  return (
    <input
      ref={inputRef}
      disabled={disabled}
      inputMode="numeric"
      onBlur={handleBlur}
      onChange={handleChange}
      onFocus={handleFocus}
      placeholder={placeholder}
      required={required}
      type="text"
      value={displayValue}
    />
  );
}
