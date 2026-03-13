const bankCatalog = require("./brazil-banks.json");

const INTERNAL_CASH_BANK = {
  code: "000",
  name: "Caixa Interno (nao bancario)"
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeBankCode(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(3, "0").slice(-3);
}

function toBankLabel(bank) {
  return `${bank.code} - ${bank.name}`;
}

const BRAZIL_BANK_OPTIONS = [INTERNAL_CASH_BANK, ...(bankCatalog?.banks || [])]
  .map((bank) => ({
    code: normalizeBankCode(bank.code),
    name: String(bank.name || "").trim()
  }))
  .filter((bank) => bank.code && bank.name)
  .sort((a, b) => {
    if (a.code === "000") return -1;
    if (b.code === "000") return 1;
    return a.code.localeCompare(b.code, "pt-BR", { numeric: true });
  })
  .map((bank) => ({
    ...bank,
    label: toBankLabel(bank)
  }));

const BANK_BY_CODE = new Map(BRAZIL_BANK_OPTIONS.map((bank) => [bank.code, bank]));
const BANK_BY_NORMALIZED_NAME = new Map(
  BRAZIL_BANK_OPTIONS.map((bank) => [normalizeText(bank.name), bank])
);
const BANK_BY_NORMALIZED_LABEL = new Map(
  BRAZIL_BANK_OPTIONS.map((bank) => [normalizeText(bank.label), bank])
);
const BANK_ALIAS_TO_CODE = new Map([
  ["NUBANK", "260"],
  ["CAIXA INTERNO", "000"],
  ["CAIXA INTERNA", "000"],
  ["CAIXA FISICO", "000"]
]);

function findBankByCode(value) {
  const code = normalizeBankCode(value);
  return code ? BANK_BY_CODE.get(code) || null : null;
}

function findBankByNameOrLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const byLabelOrName =
    BANK_BY_NORMALIZED_LABEL.get(normalized) || BANK_BY_NORMALIZED_NAME.get(normalized) || null;
  if (byLabelOrName) return byLabelOrName;
  const aliasCode = BANK_ALIAS_TO_CODE.get(normalized);
  return aliasCode ? BANK_BY_CODE.get(aliasCode) || null : null;
}

function resolveBank(value = {}) {
  return findBankByCode(value.bankCode) || findBankByNameOrLabel(value.bankName);
}

module.exports = {
  BRAZIL_BANK_CATALOG_METADATA: {
    source: bankCatalog?.source || "",
    sourceUrl: bankCatalog?.sourceUrl || "",
    fetchedOn: bankCatalog?.fetchedOn || ""
  },
  BRAZIL_BANK_OPTIONS,
  findBankByCode,
  findBankByNameOrLabel,
  resolveBank,
  normalizeBankCode
};
