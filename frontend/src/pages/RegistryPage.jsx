import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useDialog } from "../context/DialogContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateShort, formatDateTime } from "../utils/format";

const TABS = [
  { id: "clients", label: "Clientes" },
  { id: "suppliers", label: "Fornecedores" },
  { id: "saleProducts", label: "Produtos de Venda" },
  { id: "consumables", label: "Material de Consumo" },
  { id: "expenseTypes", label: "Tipos de Despesas" },
  { id: "banks", label: "Bancos" }
];
const BR_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO"
];

function isActiveValue(value) {
  return value === true || value === 1 || value === "1";
}

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function toOptionalDate(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function toDateInputValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function parseBirthDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split("-").map((item) => Number(item));
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  const isValid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;

  return isValid ? date : null;
}

function getAgeFromBirthDate(value, today = new Date()) {
  const birthDate = parseBirthDate(value);
  if (!birthDate) return null;

  let age = today.getFullYear() - birthDate.getFullYear();
  const currentMonth = today.getMonth();
  const birthMonth = birthDate.getMonth();

  if (
    currentMonth < birthMonth ||
    (currentMonth === birthMonth && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return age;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCpf(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeCpf(value) {
  return onlyDigits(value).slice(0, 11);
}

function formatCnpj(value) {
  const digits = onlyDigits(value).slice(0, 14);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function normalizeCnpj(value) {
  return onlyDigits(value).slice(0, 14);
}

function isValidCpf(cpf) {
  const value = normalizeCpf(cpf);
  if (!value || value.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(value)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(value[i]) * (10 - i);
  }
  let firstDigit = (sum * 10) % 11;
  if (firstDigit === 10) firstDigit = 0;
  if (firstDigit !== Number(value[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(value[i]) * (11 - i);
  }
  let secondDigit = (sum * 10) % 11;
  if (secondDigit === 10) secondDigit = 0;
  return secondDigit === Number(value[10]);
}

function isValidCnpj(cnpj) {
  const value = normalizeCnpj(cnpj);
  if (!value || value.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(value)) return false;

  const calculateDigit = (base, weights) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += Number(base[i]) * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstDigit !== Number(value[12])) return false;

  const secondDigit = calculateDigit(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondDigit === Number(value[13]);
}

function formatSupplierDocument(personType, value) {
  return personType === "pj" ? formatCnpj(value) : formatCpf(value);
}

function normalizeSupplierDocument(personType, value) {
  return personType === "pj" ? normalizeCnpj(value) : normalizeCpf(value);
}

function isValidSupplierDocument(personType, value) {
  return personType === "pj" ? isValidCnpj(value) : isValidCpf(value);
}

function supplierDocumentLabel(personType) {
  return personType === "pj" ? "CNPJ" : "CPF";
}

function formatBrazilPhone(value) {
  const digits = onlyDigits(value).slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

function normalizeBrazilPhone(value) {
  return onlyDigits(value).slice(0, 10);
}

function formatBrazilMobile(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizeBrazilMobile(value) {
  return onlyDigits(value).slice(0, 11);
}

function formatCep(value) {
  const digits = onlyDigits(value).slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function normalizeCep(value) {
  return onlyDigits(value).slice(0, 8);
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("NÃ£o foi possÃ­vel ler o arquivo da imagem."));
    reader.readAsDataURL(file);
  });
}

function tabsButtonClass(active) {
  return `button button-outline small ${active ? "active" : ""}`;
}

const REGISTRY_SORT_OPTIONS = [
  { value: "az", label: "A-Z" },
  { value: "za", label: "Z-A" },
  { value: "recent", label: "Mais recentes" }
];

const CLIENTS_PAGE_SIZE = 6;

function sortRegistryRows(rows, sortMode, getLabel) {
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const list = [...rows];

  list.sort((a, b) => {
    if (sortMode === "az") {
      return collator.compare(String(getLabel(a) || ""), String(getLabel(b) || ""));
    }
    if (sortMode === "za") {
      return collator.compare(String(getLabel(b) || ""), String(getLabel(a) || ""));
    }

    const createdAtA = new Date(a.created_at || 0).getTime();
    const createdAtB = new Date(b.created_at || 0).getTime();
    const safeCreatedAtA = Number.isFinite(createdAtA) ? createdAtA : 0;
    const safeCreatedAtB = Number.isFinite(createdAtB) ? createdAtB : 0;
    if (safeCreatedAtA !== safeCreatedAtB) {
      return safeCreatedAtB - safeCreatedAtA;
    }

    const idA = Number(a.id || 0);
    const idB = Number(b.id || 0);
    if (idA !== idB) {
      return idB - idA;
    }
    return collator.compare(String(getLabel(a) || ""), String(getLabel(b) || ""));
  });

  return list;
}

function CrudActionIcon({ type }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  if (type === "save") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 4h13l3 3v13H4z" {...commonProps} />
        <path d="M8 4v6h8V4" {...commonProps} />
        <path d="M9 16h6" {...commonProps} />
      </svg>
    );
  }

  if (type === "new") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 5v14" {...commonProps} />
        <path d="M5 12h14" {...commonProps} />
      </svg>
    );
  }

  if (type === "cancel") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M18 6L6 18" {...commonProps} />
        <path d="M6 6l12 12" {...commonProps} />
      </svg>
    );
  }

  if (type === "edit") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 20h9" {...commonProps} />
        <path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4z" {...commonProps} />
      </svg>
    );
  }

  if (type === "view") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12z" {...commonProps} />
        <circle cx="12" cy="12" r="2.5" {...commonProps} />
      </svg>
    );
  }

  if (type === "history") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3 12a9 9 0 109-9" {...commonProps} />
        <path d="M3 4v5h5" {...commonProps} />
        <path d="M12 7v5l3 2" {...commonProps} />
      </svg>
    );
  }

  if (type === "delete") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3 6h18" {...commonProps} />
        <path d="M8 6V4h8v2" {...commonProps} />
        <path d="M19 6l-1 14H6L5 6" {...commonProps} />
        <path d="M10 10v6" {...commonProps} />
        <path d="M14 10v6" {...commonProps} />
      </svg>
    );
  }

  return null;
}

function RegistryViewDialog({ open, title, fields, onClose }) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card client-dialog">
        <header className="dialog-header">
          <h3>{title}</h3>
        </header>
        <div className="dialog-body">
          <div className="registry-view-grid">
            {fields.map((field) => (
              <p key={`${title}-${field.label}`}>
                <strong>{field.label}:</strong> {field.value ?? "-"}
              </p>
            ))}
          </div>
        </div>
        <footer className="dialog-actions">
          <button className="button button-outline" onClick={onClose} type="button">
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}

export function RegistryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user } = useAuth();
  const clientsOnlyMode = user?.role === "tatuador";
  const availableTabs = clientsOnlyMode ? TABS.filter((tab) => tab.id === "clients") : TABS;
  const flowState = location.state?.clientRegistrationFlow || null;
  const clientRegistrationPrefill = useMemo(() => {
    if (!flowState || flowState.source !== "quote-schedule") return null;
    const quoteId = Number(flowState.quoteId);
    return {
      quoteId: Number.isInteger(quoteId) && quoteId > 0 ? quoteId : null,
      name: String(flowState.clientName || "").trim(),
      email: String(flowState.clientEmail || "").trim(),
      phone: String(flowState.clientWhatsapp || "").trim()
    };
  }, [flowState]);
  const [activeTab, setActiveTab] = useState("clients");

  useEffect(() => {
    if (clientsOnlyMode && activeTab !== "clients") {
      setActiveTab("clients");
    }
  }, [clientsOnlyMode, activeTab]);

  function handleClientRegistrationComplete(savedClient) {
    if (!clientRegistrationPrefill?.quoteId) return;
    navigate("/painel-tatuador", {
      replace: true,
      state: {
        resumeQuoteSchedule: {
          quoteId: clientRegistrationPrefill.quoteId,
          clientId: savedClient?.id || null
        }
      }
    });
  }

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Cadastros</h1>
          <p>Gerencie clientes, fornecedores, produtos, materiais e bancos.</p>
        </div>

        <div className="registry-tabs">
          {availableTabs.map((tab) => (
            <button
              className={tabsButtonClass(activeTab === tab.id)}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "clients" ? (
          <ClientsRegistry
            token={token}
            prefill={clientRegistrationPrefill}
            onRegistrationComplete={
              clientRegistrationPrefill?.quoteId ? handleClientRegistrationComplete : null
            }
            clientsOnlyMode={clientsOnlyMode}
          />
        ) : null}
        {activeTab === "suppliers" ? <SuppliersRegistry token={token} /> : null}
        {activeTab === "saleProducts" ? <SaleProductsRegistry token={token} /> : null}
        {activeTab === "consumables" ? <ConsumablesRegistry token={token} /> : null}
        {activeTab === "expenseTypes" ? <ExpenseTypesRegistry token={token} /> : null}
        {activeTab === "banks" ? <BanksRegistry token={token} /> : null}
      </div>
    </section>
  );
}

function ClientsRegistry({
  token,
  prefill = null,
  onRegistrationComplete = null,
  clientsOnlyMode = false
}) {
  const { showAlert, showConfirm } = useDialog();
  const initialForm = {
    cpf: "",
    name: "",
    email: "",
    phone: "",
    password: "123456",
    birthDate: "",
    emergencyContact: "",
    emergencyPhone: "",
    address: "",
    neighborhood: "",
    city: "",
    state: "",
    postalCode: "",
    notes: "",
    active: true
  };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState("recent");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deletingClientId, setDeletingClientId] = useState(null);
  const [cpfLookupLoading, setCpfLookupLoading] = useState(false);
  const [cpfConflictName, setCpfConflictName] = useState("");
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [viewClient, setViewClient] = useState(null);
  const [historyClient, setHistoryClient] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const cpfInputRef = useRef(null);
  const showClientsTable = !clientsOnlyMode;

  async function loadRows(showInactive = includeInactive) {
    if (!token) return;
    if (!showClientsTable) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const query = showInactive ? "?includeInactive=true" : "";
      const data = await api.request(`/registry/clients${query}`, { token });
      setRows(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, [token, includeInactive, showClientsTable]);

  useEffect(() => {
    if (!prefill?.quoteId) {
      setPrefillApplied(false);
      return;
    }
    setPrefillApplied(false);
  }, [prefill?.quoteId]);

  useEffect(() => {
    if (!prefill || prefillApplied || editingId) return;

    setForm((current) => ({
      ...current,
      name: prefill.name || current.name,
      email: prefill.email || current.email,
      phone: prefill.phone ? formatBrazilMobile(prefill.phone) : current.phone,
      notes: prefill.quoteId
        ? `Cadastro iniciado a partir do orcamento #${prefill.quoteId}.`
        : current.notes
    }));
    setPrefillApplied(true);
  }, [prefill, prefillApplied, editingId]);

  const filteredRows = useMemo(() => {
    const query = String(searchTerm || "").trim().toLowerCase();
    if (!query) return rows;

    const queryDigits = normalizeCpf(query);
    return rows.filter((row) => {
      const nameMatches = String(row.name || "").toLowerCase().includes(query);
      const rawCpf = normalizeCpf(row.cpf || "");
      const cpfMatchesRaw = queryDigits ? rawCpf.includes(queryDigits) : false;
      const cpfMatchesMasked = formatCpf(rawCpf).includes(query);
      return nameMatches || cpfMatchesRaw || cpfMatchesMasked;
    });
  }, [rows, searchTerm]);

  const sortedRows = useMemo(
    () => sortRegistryRows(filteredRows, sortMode, (row) => row.name),
    [filteredRows, sortMode]
  );

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / CLIENTS_PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * CLIENTS_PAGE_SIZE;
    return sortedRows.slice(start, start + CLIENTS_PAGE_SIZE);
  }, [sortedRows, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortMode, includeInactive]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
    setCpfConflictName("");
  }

  function focusCpfInput(clearValue = false) {
    if (clearValue) {
      setForm((current) => ({ ...current, cpf: "" }));
      setCpfConflictName("");
    }

    setTimeout(() => {
      if (cpfInputRef.current) {
        cpfInputRef.current.focus();
      }
    }, 0);
  }

  function updateCpfField(value) {
    setCpfConflictName("");
    updateField("cpf", formatCpf(value));
  }

  function updatePhoneField(value) {
    updateField("phone", formatBrazilMobile(value));
  }

  function updatePostalCodeField(value) {
    updateField("postalCode", formatCep(value));
  }

  async function checkCpfConflict(rawCpf = form.cpf) {
    const normalizedCpf = normalizeCpf(rawCpf);
    if (normalizedCpf.length !== 11) return null;

    setCpfLookupLoading(true);
    try {
      const params = new URLSearchParams({ cpf: normalizedCpf });
      if (editingId) {
        params.set("excludeId", String(editingId));
      }
      const response = await api.request(`/registry/clients/check-cpf?${params.toString()}`, { token });
      if (response.exists && response.client) {
        return response.client;
      }
      return null;
    } catch (_requestError) {
      return null;
    } finally {
      setCpfLookupLoading(false);
    }
  }

  async function handleCpfBlur() {
    if (editingId) return;

    const normalizedCpf = normalizeCpf(form.cpf);
    if (!normalizedCpf) {
      setCpfConflictName("");
      return;
    }

    if (!isValidCpf(normalizedCpf)) {
      await showAlert({
        title: "CPF invÃ¡lido",
        message: "O CPF informado Ã© invÃ¡lido. Verifique e tente novamente."
      });
      setError("CPF invÃ¡lido.");
      setCpfConflictName("");
      focusCpfInput(false);
      return;
    }

    const conflict = await checkCpfConflict(form.cpf);
    if (conflict) {
      await showAlert({
        title: "CPF jÃ¡ cadastrado",
        message: `JÃ¡ existe cliente cadastrado com este CPF: ${conflict.name}.`
      });
      setError(`CPF jÃ¡ cadastrado para ${conflict.name}. Informe um novo CPF.`);
      setCpfConflictName("");
      focusCpfInput(true);
    } else {
      setCpfConflictName("");
    }
  }

  function startEdit(row) {
    setEditingId(row.id);
    setError("");
    setSuccess("");
    setForm({
      cpf: formatCpf(row.cpf || ""),
      name: row.name || "",
      email: row.email || "",
      phone: formatBrazilMobile(row.phone || ""),
      password: "",
      birthDate: toDateInputValue(row.birth_date),
      emergencyContact: row.emergency_contact || "",
      emergencyPhone: row.emergency_phone || "",
      address: row.address || "",
      neighborhood: row.neighborhood || "",
      city: row.city || "",
      state: row.state || "",
      postalCode: formatCep(row.postal_code || ""),
      notes: row.notes || "",
      active: isActiveValue(row.active)
    });
  }

  function openClientView(row) {
    setViewClient(row);
  }

  function closeClientView() {
    setViewClient(null);
  }

  async function openClientHistory(row) {
    setError("");
    setHistoryClient(row);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const response = await api.request(`/registry/clients/${row.id}/history`, { token });
      setHistoryRows(Array.isArray(response?.history) ? response.history : []);
    } catch (requestError) {
      setError(requestError.message);
      setHistoryClient(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeClientHistory() {
    setHistoryClient(null);
    setHistoryRows([]);
    setHistoryLoading(false);
  }

  async function inactivateClient(row) {
    await api.request(`/registry/clients/${row.id}`, {
      method: "PATCH",
      token,
      body: { active: false }
    });

    if (Number(editingId) === Number(row.id)) {
      resetForm();
    }
    setSuccess("Cliente inativado com sucesso.");
    await loadRows();
  }

  async function handleDeleteClient(row) {
    setError("");
    setSuccess("");

    const shouldDelete = await showConfirm({
      title: "Excluir cliente",
      message: `Deseja realmente excluir o cadastro de ${row.name}?`,
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar"
    });
    if (!shouldDelete) return;

    setDeletingClientId(row.id);
    try {
      await api.request(`/registry/clients/${row.id}`, {
        method: "DELETE",
        token
      });

      if (Number(editingId) === Number(row.id)) {
        resetForm();
      }
      if (Number(viewClient?.id) === Number(row.id)) {
        closeClientView();
      }
      if (Number(historyClient?.id) === Number(row.id)) {
        closeClientHistory();
      }

      setSuccess("Cliente excluido com sucesso.");
      await loadRows();
    } catch (requestError) {
      if (requestError.code === "client_has_appointments") {
        const appointmentsCount = Number(requestError?.payload?.appointmentsCount || 0);
        const shouldInactivate = await showConfirm({
          title: "Cliente possui agendamentos",
          message: appointmentsCount
            ? `Este cliente nao pode ser excluido porque possui ${appointmentsCount} agendamento(s). Deseja inativar o cadastro?`
            : "Este cliente nao pode ser excluido porque possui agendamentos. Deseja inativar o cadastro?",
          confirmLabel: "Inativar",
          cancelLabel: "Cancelar"
        });
        if (shouldInactivate) {
          try {
            await inactivateClient(row);
          } catch (inactivateError) {
            setError(inactivateError.message);
          }
        }
      } else {
        setError(requestError.message);
      }
    } finally {
      setDeletingClientId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const normalizedCpf = normalizeCpf(form.cpf);
      if (!normalizedCpf || !form.name.trim() || !form.email.trim()) {
        throw new Error("Informe CPF, nome e e-mail.");
      }
      if (!isValidCpf(normalizedCpf)) {
        throw new Error("CPF invÃ¡lido.");
      }

      if (cpfConflictName) {
        throw new Error(`CPF jÃ¡ cadastrado para ${cpfConflictName}.`);
      }

      const age = getAgeFromBirthDate(form.birthDate);
      if (age !== null && age < 18) {
        const shouldContinue = await showConfirm({
          title: "Cliente menor de idade",
          message: `Cliente com ${age} anos (menor de 18). Deseja continuar o cadastro?`,
          confirmLabel: "Sim, continuar",
          cancelLabel: "NÃ£o, cancelar"
        });
        if (!shouldContinue) {
          resetForm();
          setSuccess("Cadastro cancelado e formulario reiniciado.");
          return;
        }
      }

      const payload = {
        cpf: normalizedCpf,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: toOptionalText(normalizeBrazilMobile(form.phone)),
        birthDate: toOptionalDate(form.birthDate),
        emergencyContact: toOptionalText(form.emergencyContact),
        emergencyPhone: toOptionalText(form.emergencyPhone),
        address: toOptionalText(form.address),
        neighborhood: toOptionalText(form.neighborhood),
        city: toOptionalText(form.city),
        state: toOptionalText(form.state),
        postalCode: toOptionalText(normalizeCep(form.postalCode)),
        notes: toOptionalText(form.notes),
        active: form.active
      };

      let savedClient = null;
      if (!editingId) {
        const passwordValue = form.password.trim();
        if (passwordValue) {
          payload.password = passwordValue;
        }
        savedClient = await api.request("/registry/clients", {
          method: "POST",
          token,
          body: payload
        });
      } else {
        savedClient = await api.request(`/registry/clients/${editingId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingId ? "Cliente atualizado com sucesso." : "Cliente criado com sucesso.");
      if (onRegistrationComplete) {
        onRegistrationComplete(savedClient);
        return;
      }
      resetForm();
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel clients-panel">
      <div className="registry-panel-header">
        <h2>Clientes</h2>
        {!showClientsTable ? (
          <p className="muted">Finalize o cadastro do cliente para seguir com o agendamento.</p>
        ) : null}
      </div>

      <div className={`clients-crud-layout${showClientsTable ? "" : " single-column"}`}>
      <form className="form clients-form" onSubmit={handleSubmit}>
        <div className="grid-3">
          <label>
            CPF
            <input
              ref={cpfInputRef}
              onBlur={handleCpfBlur}
              onChange={(event) => updateCpfField(event.target.value)}
              required
              type="text"
              value={form.cpf}
              disabled={Boolean(editingId)}
            />
          </label>
          <label>
            Nome
            <input
              onChange={(event) => updateField("name", event.target.value)}
              required
              type="text"
              value={form.name}
            />
          </label>
          <label>
            E-mail
            <input
              onChange={(event) => updateField("email", event.target.value)}
              required
              type="email"
              value={form.email}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Celular / Whatsapp
            <input
              onChange={(event) => updatePhoneField(event.target.value)}
              type="text"
              value={form.phone}
            />
          </label>
          <label>
            Data de nascimento
            <input
              onChange={(event) => updateField("birthDate", event.target.value)}
              type="date"
              value={form.birthDate}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Senha inicial
            <input
              onChange={(event) => updateField("password", event.target.value)}
              placeholder="Padrao: 123456"
              type="text"
              value={form.password}
            />
          </label>
          <label>
            Contato de emergencia
            <input
              onChange={(event) => updateField("emergencyContact", event.target.value)}
              type="text"
              value={form.emergencyContact}
            />
          </label>
        </div>

        <label>
          Telefone emergencia
          <input
            onChange={(event) => updateField("emergencyPhone", event.target.value)}
            type="text"
            value={form.emergencyPhone}
          />
        </label>

        <label>
          EndereÃ§o
          <input
            onChange={(event) => updateField("address", event.target.value)}
            type="text"
            value={form.address}
          />
        </label>

        <div className="grid-2">
          <label>
            Bairro
            <input
              onChange={(event) => updateField("neighborhood", event.target.value)}
              type="text"
              value={form.neighborhood}
            />
          </label>
          <label>
            Cidade
            <input
              onChange={(event) => updateField("city", event.target.value)}
              type="text"
              value={form.city}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Estado
            <select
              onChange={(event) => updateField("state", event.target.value)}
              value={form.state}
            >
              <option value="">Selecione</option>
              {BR_STATES.map((stateValue) => (
                <option key={stateValue} value={stateValue}>
                  {stateValue}
                </option>
              ))}
            </select>
          </label>
          <label>
            CEP
            <input
              onChange={(event) => updatePostalCodeField(event.target.value)}
              type="text"
              value={form.postalCode}
            />
          </label>
        </div>

        <label>
          Observacoes
          <textarea
            onChange={(event) => updateField("notes", event.target.value)}
            rows={2}
            value={form.notes}
          />
        </label>

        {cpfLookupLoading ? <p className="muted clients-inline-note">Validando CPF...</p> : null}
        {editingId ? (
          <p className="muted clients-inline-note">CPF nao pode ser alterado apos o cadastro.</p>
        ) : null}

        <label className="inline-check">
          <input
            checked={form.active}
            onChange={(event) => updateField("active", event.target.checked)}
            type="checkbox"
          />
          Cliente ativo
        </label>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <div className="clients-form-footer">
          <div className="clients-form-actions">
            <button
              aria-label={editingId ? "Atualizar cliente" : "Criar cliente"}
              className="button button-primary small clients-action-button"
              disabled={saving}
              title={saving ? "Salvando..." : editingId ? "Atualizar cliente" : "Criar cliente"}
              type="submit"
            >
              <CrudActionIcon type="save" />
            </button>
            <button
              aria-label="Novo cadastro"
              className="button button-outline small clients-action-button"
              disabled={saving}
              onClick={resetForm}
              title="Novo cadastro"
              type="button"
            >
              <CrudActionIcon type="new" />
            </button>
            {editingId ? (
              <button
                aria-label="Cancelar edicao"
                className="button button-outline small clients-action-button"
                disabled={saving}
                onClick={resetForm}
                title="Cancelar edicao"
                type="button"
              >
                <CrudActionIcon type="cancel" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {showClientsTable ? (
        <div className="table-wrapper registry-table clients-table-panel">
        <div className="registry-search registry-search-compact">
          <label>
            Buscar cliente por nome ou CPF
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Ex: Maria ou 123.456.789-09"
              type="text"
              value={searchTerm}
            />
          </label>
          <label>
            Ordenar por
            <select onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
              {REGISTRY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-check">
            <input
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
              type="checkbox"
            />
            Mostrar inativos
          </label>
        </div>

        {loading ? <p>Carregando clientes...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">Nenhum cliente encontrado.</p> : null}
        {!loading && rows.length > 0 && sortedRows.length === 0 ? (
          <p className="muted">Nenhum cliente encontrado para a busca informada.</p>
        ) : null}
        {sortedRows.length > 0 ? (
          <table className="registry-clients-table clients-compact-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Celular / Whatsapp</th>
                <th>CPF</th>
                <th>Nascimento</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => {
                const age = getAgeFromBirthDate(row.birth_date);
                const isMinor = age !== null && age < 18;
                const isEditing = Number(editingId) === Number(row.id);
                return (
                  <tr
                    className={`${isMinor ? "registry-minor-row" : ""}${isEditing ? " registry-editing-row" : ""}`}
                    key={row.id}
                  >
                    <td>
                      {row.name}
                      {isMinor ? <span className="minor-tag">Menor de idade</span> : null}
                    </td>
                    <td>{row.email}</td>
                    <td>{row.phone ? formatBrazilMobile(row.phone) : "-"}</td>
                    <td>{row.cpf ? formatCpf(row.cpf) : "-"}</td>
                    <td>
                      {row.birth_date ? formatDateShort(row.birth_date) : "-"}
                      {isMinor ? ` (${age} anos)` : ""}
                    </td>
                    <td>
                      <div className="clients-row-actions">
                        <button
                          aria-label={`Visualizar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action view"
                          onClick={() => openClientView(row)}
                          title="Visualizar"
                          type="button"
                        >
                          <CrudActionIcon type="view" />
                        </button>
                        <button
                          aria-label={`Editar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action edit"
                          onClick={() => startEdit(row)}
                          title="Editar"
                          type="button"
                        >
                          <CrudActionIcon type="edit" />
                        </button>
                        <button
                          aria-label={`Historico de ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action history"
                          onClick={() => openClientHistory(row)}
                          title="Historico"
                          type="button"
                        >
                          <CrudActionIcon type="history" />
                        </button>
                        <button
                          aria-label={`Excluir ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action delete"
                          onClick={() => handleDeleteClient(row)}
                          title="Excluir"
                          disabled={deletingClientId === row.id}
                          type="button"
                        >
                          <CrudActionIcon type="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {sortedRows.length > 0 ? (
          <div className="clients-pagination">
            <span className="muted">
              Mostrando {paginatedRows.length} de {sortedRows.length} clientes
            </span>
            <div className="clients-pagination-controls">
              <button
                className="button button-outline small"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                type="button"
              >
                Anterior
              </button>
              <span className="muted">
                Pagina {currentPage} de {totalPages}
              </span>
              <button
                className="button button-outline small"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                type="button"
              >
                Proxima
              </button>
            </div>
          </div>
        ) : null}
        </div>
      ) : null}

      {viewClient ? (
        <div className="dialog-backdrop">
          <div className="dialog-card client-dialog">
            <header className="dialog-header">
              <h3>Cadastro do cliente</h3>
            </header>
            <div className="dialog-body">
              <div className="client-dialog-grid">
                <p><strong>Nome:</strong> {viewClient.name || "-"}</p>
                <p><strong>E-mail:</strong> {viewClient.email || "-"}</p>
                <p><strong>WhatsApp:</strong> {viewClient.phone ? formatBrazilMobile(viewClient.phone) : "-"}</p>
                <p><strong>CPF:</strong> {viewClient.cpf ? formatCpf(viewClient.cpf) : "-"}</p>
                <p><strong>Nascimento:</strong> {viewClient.birth_date ? formatDateShort(viewClient.birth_date) : "-"}</p>
                <p><strong>Status:</strong> {isActiveValue(viewClient.active) ? "Ativo" : "Inativo"}</p>
                <p><strong>Contato emergencia:</strong> {viewClient.emergency_contact || "-"}</p>
                <p><strong>Telefone emergencia:</strong> {viewClient.emergency_phone || "-"}</p>
                <p><strong>Endereco:</strong> {viewClient.address || "-"}</p>
                <p><strong>Bairro:</strong> {viewClient.neighborhood || "-"}</p>
                <p><strong>Cidade:</strong> {viewClient.city || "-"}</p>
                <p><strong>Estado:</strong> {viewClient.state || "-"}</p>
                <p><strong>CEP:</strong> {viewClient.postal_code ? formatCep(viewClient.postal_code) : "-"}</p>
              </div>
              <p><strong>Observacoes:</strong> {viewClient.notes || "-"}</p>
            </div>
            <footer className="dialog-actions">
              <button className="button button-outline" onClick={closeClientView} type="button">
                Fechar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {historyClient ? (
        <div className="dialog-backdrop">
          <div className="dialog-card client-history-dialog">
            <header className="dialog-header">
              <h3>Historico de {historyClient.name}</h3>
            </header>
            <div className="dialog-body">
              {historyLoading ? <p>Carregando historico...</p> : null}
              {!historyLoading && historyRows.length === 0 ? (
                <p className="muted">Nenhum agendamento encontrado para este cliente.</p>
              ) : null}
              {!historyLoading && historyRows.length > 0 ? (
                <div className="table-wrapper">
                  <table className="clients-history-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Artista</th>
                        <th>Servico</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((item) => (
                        <tr key={`history-${historyClient.id}-${item.id}`}>
                          <td>{formatDateTime(item.start_at)}</td>
                          <td>{item.artist_name || "-"}</td>
                          <td>{item.service_name || "-"}</td>
                          <td>{formatCurrency(item.total_value || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            <footer className="dialog-actions">
              <button className="button button-outline" onClick={closeClientHistory} type="button">
                Fechar
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      </div>
    </section>
  );
}

function SuppliersRegistry({ token }) {
  const { showAlert, showConfirm } = useDialog();
  const initialForm = {
    personType: "pf",
    document: "",
    name: "",
    email: "",
    phone: "",
    mobile: "",
    address: "",
    neighborhood: "",
    city: "",
    state: "",
    postalCode: "",
    notes: "",
    active: true
  };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState("recent");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState(null);
  const [documentLookupLoading, setDocumentLookupLoading] = useState(false);
  const [documentConflictName, setDocumentConflictName] = useState("");
  const documentInputRef = useRef(null);

  async function loadRows(showInactive = includeInactive) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const query = showInactive ? "?includeInactive=true" : "";
      const data = await api.request(`/registry/suppliers${query}`, { token });
      setRows(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, [token, includeInactive]);

  const filteredRows = useMemo(() => {
    const query = String(searchTerm || "").trim().toLowerCase();
    if (!query) return rows;

    const queryDigits = onlyDigits(query);
    return rows.filter((row) => {
      const nameMatches = String(row.name || "").toLowerCase().includes(query);
      const documentMasked = formatSupplierDocument(row.person_type, row.document || "").toLowerCase();
      const documentRaw = String(row.document || "");
      const documentMatchesMasked = documentMasked.includes(query);
      const documentMatchesRaw = queryDigits ? documentRaw.includes(queryDigits) : false;
      return nameMatches || documentMatchesMasked || documentMatchesRaw;
    });
  }, [rows, searchTerm]);

  const sortedRows = useMemo(
    () => sortRegistryRows(filteredRows, sortMode, (row) => row.name),
    [filteredRows, sortMode]
  );

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
    setDocumentConflictName("");
  }

  function focusDocumentInput(clearValue = false) {
    if (clearValue) {
      setForm((current) => ({ ...current, document: "" }));
      setDocumentConflictName("");
    }

    setTimeout(() => {
      if (documentInputRef.current) {
        documentInputRef.current.focus();
      }
    }, 0);
  }

  function updatePersonType(value) {
    setDocumentConflictName("");
    setError("");
    setForm((current) => ({
      ...current,
      personType: value,
      document: ""
    }));
  }

  function updateDocumentField(value) {
    setDocumentConflictName("");
    setError("");
    setForm((current) => ({
      ...current,
      document: formatSupplierDocument(current.personType, value)
    }));
  }

  function updatePhoneField(value) {
    updateField("phone", formatBrazilPhone(value));
  }

  function updateMobileField(value) {
    updateField("mobile", formatBrazilMobile(value));
  }

  function updatePostalCodeField(value) {
    updateField("postalCode", formatCep(value));
  }

  async function checkDocumentConflict(rawDocument = form.document, personType = form.personType) {
    const normalizedDocument = normalizeSupplierDocument(personType, rawDocument);
    const expectedLength = personType === "pj" ? 14 : 11;
    if (normalizedDocument.length !== expectedLength) return null;

    setDocumentLookupLoading(true);
    try {
      const params = new URLSearchParams({
        personType,
        document: normalizedDocument
      });
      if (editingId) {
        params.set("excludeId", String(editingId));
      }
      const response = await api.request(`/registry/suppliers/check-document?${params.toString()}`, {
        token
      });
      if (response.exists && response.supplier) {
        return response.supplier;
      }
      return null;
    } catch (_requestError) {
      return null;
    } finally {
      setDocumentLookupLoading(false);
    }
  }

  async function handleDocumentBlur() {
    if (editingId) return;

    const documentLabel = supplierDocumentLabel(form.personType);
    const normalizedDocument = normalizeSupplierDocument(form.personType, form.document);
    const expectedLength = form.personType === "pj" ? 14 : 11;
    if (!normalizedDocument) {
      setDocumentConflictName("");
      return;
    }

    if (normalizedDocument.length < expectedLength) {
      setDocumentConflictName("");
      return;
    }

    if (!isValidSupplierDocument(form.personType, normalizedDocument)) {
      await showAlert({
        title: `${documentLabel} invÃ¡lido`,
        message: `O ${documentLabel} informado Ã© invÃ¡lido. Verifique e tente novamente.`
      });
      setError(`${documentLabel} invÃ¡lido.`);
      setDocumentConflictName("");
      return;
    }

    const conflict = await checkDocumentConflict(form.document, form.personType);
    if (conflict) {
      await showAlert({
        title: `${documentLabel} jÃ¡ cadastrado`,
        message: `JÃ¡ existe fornecedor cadastrado com este ${documentLabel}: ${conflict.name}.`
      });
      setError(`${documentLabel} jÃ¡ cadastrado para ${conflict.name}. Informe um novo ${documentLabel}.`);
      setDocumentConflictName("");
      focusDocumentInput(true);
    } else {
      setDocumentConflictName("");
    }
  }

  function startEdit(row) {
    setEditingId(row.id);
    setError("");
    setSuccess("");
    setDocumentConflictName("");
    setForm({
      personType: row.person_type || "pf",
      document: formatSupplierDocument(row.person_type, row.document || ""),
      name: row.name || "",
      email: row.email || "",
      phone: formatBrazilPhone(row.phone || ""),
      mobile: formatBrazilMobile(row.mobile || ""),
      address: row.address || "",
      neighborhood: row.neighborhood || "",
      city: row.city || "",
      state: row.state || "",
      postalCode: formatCep(row.postal_code || ""),
      notes: row.notes || "",
      active: isActiveValue(row.active)
    });
  }

  async function handleDelete(row) {
    const confirmed = await showConfirm({
      title: "Excluir fornecedor",
      message: `Deseja realmente excluir ${row.name}?`,
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setDeletingRowId(row.id);
    try {
      await api.request(`/registry/suppliers/${row.id}`, { method: "DELETE", token });
      if (Number(editingId) === Number(row.id)) {
        resetForm();
      }
      if (Number(viewRow?.id) === Number(row.id)) {
        setViewRow(null);
      }
      setSuccess("Fornecedor excluido com sucesso.");
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingRowId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const documentLabel = supplierDocumentLabel(form.personType);
      const normalizedDocument = normalizeSupplierDocument(form.personType, form.document);

      if (!form.personType || !normalizedDocument || !form.name.trim()) {
        throw new Error(`Informe tipo de pessoa, ${documentLabel} e nome.`);
      }

      if (!isValidSupplierDocument(form.personType, normalizedDocument)) {
        throw new Error(`${documentLabel} invÃ¡lido.`);
      }

      if (documentConflictName) {
        throw new Error(`${documentLabel} jÃ¡ cadastrado para ${documentConflictName}.`);
      }

      const payload = {
        personType: form.personType,
        document: normalizedDocument,
        name: form.name.trim(),
        email: toOptionalText(form.email),
        phone: toOptionalText(normalizeBrazilPhone(form.phone)),
        mobile: toOptionalText(normalizeBrazilMobile(form.mobile)),
        address: toOptionalText(form.address),
        neighborhood: toOptionalText(form.neighborhood),
        city: toOptionalText(form.city),
        state: toOptionalText(form.state),
        postalCode: toOptionalText(normalizeCep(form.postalCode)),
        notes: toOptionalText(form.notes),
        active: form.active
      };

      if (!editingId) {
        await api.request("/registry/suppliers", {
          method: "POST",
          token,
          body: payload
        });
      } else {
        await api.request(`/registry/suppliers/${editingId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingId ? "Fornecedor atualizado com sucesso." : "Fornecedor criado com sucesso.");
      resetForm();
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="registry-panel-header">
        <h2>Fornecedores</h2>
        <label className="inline-check">
          <input
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            type="checkbox"
          />
          Mostrar inativos
        </label>
      </div>

      <form className="form clients-form suppliers-form" onSubmit={handleSubmit}>
        <div className="grid-3">
          <label>
            Tipo de pessoa
            <select
              onChange={(event) => updatePersonType(event.target.value)}
              value={form.personType}
              disabled={Boolean(editingId)}
            >
              <option value="pf">Pessoa FÃ­sica</option>
              <option value="pj">Pessoa JurÃ­dica</option>
            </select>
          </label>
          <label>
            {supplierDocumentLabel(form.personType)}
            <input
              ref={documentInputRef}
              onBlur={handleDocumentBlur}
              onChange={(event) => updateDocumentField(event.target.value)}
              inputMode="numeric"
              maxLength={form.personType === "pj" ? 18 : 14}
              required
              type="text"
              value={form.document}
              disabled={Boolean(editingId)}
            />
          </label>
          <label>
            Nome
            <input
              onChange={(event) => updateField("name", event.target.value)}
              required
              type="text"
              value={form.name}
            />
          </label>
        </div>

        <div className="grid-3">
          <label>
            E-mail
            <input
              onChange={(event) => updateField("email", event.target.value)}
              type="email"
              value={form.email}
            />
          </label>
          <label>
            Telefone
            <input
              onChange={(event) => updatePhoneField(event.target.value)}
              inputMode="numeric"
              maxLength={14}
              placeholder="(99) 9999-9999"
              type="text"
              value={form.phone}
            />
          </label>
          <label>
            Celular / Whatsapp
            <input
              onChange={(event) => updateMobileField(event.target.value)}
              inputMode="numeric"
              maxLength={15}
              placeholder="(99) 99999-9999"
              type="text"
              value={form.mobile}
            />
          </label>
        </div>

        <label>
          EndereÃ§o
          <input
            onChange={(event) => updateField("address", event.target.value)}
            type="text"
            value={form.address}
          />
        </label>

        <div className="grid-2">
          <label>
            Bairro
            <input
              onChange={(event) => updateField("neighborhood", event.target.value)}
              type="text"
              value={form.neighborhood}
            />
          </label>
          <label>
            Cidade
            <input
              onChange={(event) => updateField("city", event.target.value)}
              type="text"
              value={form.city}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Estado
            <select
              onChange={(event) => updateField("state", event.target.value)}
              value={form.state}
            >
              <option value="">Selecione</option>
              {BR_STATES.map((stateValue) => (
                <option key={stateValue} value={stateValue}>
                  {stateValue}
                </option>
              ))}
            </select>
          </label>
          <label>
            CEP
            <input
              onChange={(event) => updatePostalCodeField(event.target.value)}
              inputMode="numeric"
              maxLength={9}
              type="text"
              value={form.postalCode}
            />
          </label>
        </div>

        <label>
          ObservaÃ§Ãµes
          <textarea
            onChange={(event) => updateField("notes", event.target.value)}
            rows={3}
            value={form.notes}
          />
        </label>

        {editingId ? (
          <p className="muted">Tipo de pessoa e CPF/CNPJ nÃ£o podem ser alterados apÃ³s o cadastro.</p>
        ) : null}
        {documentLookupLoading ? <p className="muted">Validando CPF/CNPJ...</p> : null}

        <label className="inline-check">
          <input
            checked={form.active}
            onChange={(event) => updateField("active", event.target.checked)}
            type="checkbox"
          />
          Fornecedor ativo
        </label>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <div className="clients-form-footer">
          <div className="clients-form-actions">
            <button
              aria-label={editingId ? "Atualizar fornecedor" : "Criar fornecedor"}
              className="button button-primary small clients-action-button"
              disabled={saving}
              title={saving ? "Salvando..." : editingId ? "Atualizar fornecedor" : "Criar fornecedor"}
              type="submit"
            >
              <CrudActionIcon type="save" />
            </button>
            <button
              aria-label="Novo cadastro"
              className="button button-outline small clients-action-button"
              disabled={saving}
              onClick={resetForm}
              title="Novo cadastro"
              type="button"
            >
              <CrudActionIcon type="new" />
            </button>
            {editingId ? (
              <button
                aria-label="Cancelar edicao"
                className="button button-outline small clients-action-button"
                disabled={saving}
                onClick={resetForm}
                title="Cancelar edicao"
                type="button"
              >
                <CrudActionIcon type="cancel" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="table-wrapper registry-table clients-table-panel suppliers-table-panel">
        <div className="registry-search registry-search-compact suppliers-search-compact">
          <label>
            Buscar fornecedor por nome ou CPF/CNPJ
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Ex: Studio XYZ ou 12.345.678/0001-90"
              type="text"
              value={searchTerm}
            />
          </label>
          <label>
            Ordenar por
            <select onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
              {REGISTRY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? <p>Carregando fornecedores...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">Nenhum fornecedor encontrado.</p> : null}
        {!loading && rows.length > 0 && sortedRows.length === 0 ? (
          <p className="muted">Nenhum fornecedor encontrado para a busca informada.</p>
        ) : null}

        {sortedRows.length > 0 ? (
          <table className="registry-clients-table clients-compact-table suppliers-compact-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>CPF/CNPJ</th>
                <th>Contato</th>
                <th>Cidade/UF</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const cityState = [row.city, row.state].filter(Boolean).join(" / ");
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.person_type === "pj" ? "Pessoa JurÃ­dica" : "Pessoa FÃ­sica"}</td>
                    <td>{formatSupplierDocument(row.person_type, row.document || "") || "-"}</td>
                    <td className="suppliers-contact-cell">
                      <span>{row.phone ? formatBrazilPhone(row.phone) : "-"}</span>
                      <span>{row.mobile ? formatBrazilMobile(row.mobile) : "-"}</span>
                    </td>
                    <td>{cityState || "-"}</td>
                    <td>
                      <div className="clients-row-actions">
                        <button
                          aria-label={`Visualizar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action view"
                          onClick={() => setViewRow(row)}
                          title="Visualizar"
                          type="button"
                        >
                          <CrudActionIcon type="view" />
                        </button>
                        <button
                          aria-label={`Editar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action edit"
                          onClick={() => startEdit(row)}
                          title="Editar"
                          type="button"
                        >
                          <CrudActionIcon type="edit" />
                        </button>
                        <button
                          aria-label={`Excluir ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action delete"
                          onClick={() => handleDelete(row)}
                          disabled={deletingRowId === row.id}
                          title="Excluir"
                          type="button"
                        >
                          <CrudActionIcon type="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <RegistryViewDialog
        open={Boolean(viewRow)}
        title="Fornecedor"
        fields={
          viewRow
            ? [
                { label: "Nome", value: viewRow.name || "-" },
                { label: "Tipo", value: viewRow.person_type === "pj" ? "Pessoa Juridica" : "Pessoa Fisica" },
                { label: "CPF/CNPJ", value: formatSupplierDocument(viewRow.person_type, viewRow.document || "") || "-" },
                { label: "E-mail", value: viewRow.email || "-" },
                { label: "Telefone", value: viewRow.phone ? formatBrazilPhone(viewRow.phone) : "-" },
                { label: "WhatsApp", value: viewRow.mobile ? formatBrazilMobile(viewRow.mobile) : "-" },
                { label: "Endereco", value: viewRow.address || "-" },
                { label: "Bairro", value: viewRow.neighborhood || "-" },
                { label: "Cidade", value: viewRow.city || "-" },
                { label: "Estado", value: viewRow.state || "-" },
                { label: "CEP", value: viewRow.postal_code ? formatCep(viewRow.postal_code) : "-" },
                { label: "Status", value: isActiveValue(viewRow.active) ? "Ativo" : "Inativo" }
              ]
            : []
        }
        onClose={() => setViewRow(null)}
      />
    </section>
  );
}

function SaleProductsRegistry({ token }) {
  const { showAlert, showConfirm } = useDialog();
  const initialForm = {
    name: "",
    category: "",
    description: "",
    imageUrl: "",
    price: 0,
    costPrice: 0,
    sku: "",
    supplierId: "",
    stock: "0",
    lowStockThreshold: "3",
    active: true
  };

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState(null);
  const [skuLookupLoading, setSkuLookupLoading] = useState(false);
  const [skuConflictName, setSkuConflictName] = useState("");

  async function loadRows(showInactive = includeInactive) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const query = showInactive ? "?includeInactive=true" : "";
      const [productsData, suppliersData] = await Promise.all([
        api.request(`/registry/sale-products${query}`, { token }),
        api.request("/registry/suppliers?includeInactive=true", { token })
      ]);
      setRows(productsData);
      setSuppliers(suppliersData);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, [token, includeInactive]);

  const sortedRows = useMemo(
    () => sortRegistryRows(rows, sortMode, (row) => row.name),
    [rows, sortMode]
  );

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
    setSkuConflictName("");
  }

  function updateSkuField(value) {
    setSkuConflictName("");
    updateField("sku", normalizeSku(value));
  }

  async function checkSkuConflict(rawSku = form.sku) {
    const normalizedSku = normalizeSku(rawSku);
    if (!normalizedSku) return null;

    setSkuLookupLoading(true);
    try {
      const params = new URLSearchParams({ sku: normalizedSku });
      if (editingId) {
        params.set("excludeId", String(editingId));
      }
      const response = await api.request(`/registry/sale-products/check-sku?${params.toString()}`, {
        token
      });
      if (response.exists && response.product) {
        return response.product;
      }
      return null;
    } catch (_requestError) {
      return null;
    } finally {
      setSkuLookupLoading(false);
    }
  }

  async function handleSkuBlur() {
    const normalizedSku = normalizeSku(form.sku);
    if (!normalizedSku) {
      setSkuConflictName("");
      return;
    }

    const conflict = await checkSkuConflict(normalizedSku);
    if (conflict) {
      await showAlert({
        title: "SKU jÃ¡ existe",
        message: `SKU jÃ¡ existe e estÃ¡ vinculado ao produto: ${conflict.name}.`
      });
      setError(`SKU jÃ¡ existe e estÃ¡ vinculado ao produto: ${conflict.name}.`);
      setSkuConflictName(conflict.name);
    } else {
      setSkuConflictName("");
    }
  }

  async function handleImageFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem vÃ¡lido.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("A imagem deve ter no mÃ¡ximo 5 MB.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateField("imageUrl", dataUrl);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function startEdit(row) {
    setEditingId(row.id);
    setError("");
    setSuccess("");
    setSkuConflictName("");
    setForm({
      name: row.name || "",
      category: row.category || "",
      description: row.description || "",
      imageUrl: row.image_url || "",
      price: Number(row.price ?? 0),
      costPrice: Number(row.cost_price ?? 0),
      sku: row.sku || "",
      supplierId: row.supplier_id ? String(row.supplier_id) : "",
      stock: String(row.stock ?? 0),
      lowStockThreshold: String(row.low_stock_threshold ?? 0),
      active: isActiveValue(row.active)
    });
  }

  async function handleDelete(row) {
    const confirmed = await showConfirm({
      title: "Excluir produto",
      message: `Deseja realmente excluir ${row.name}?`,
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setDeletingRowId(row.id);
    try {
      await api.request(`/registry/sale-products/${row.id}`, { method: "DELETE", token });
      if (Number(editingId) === Number(row.id)) {
        resetForm();
      }
      if (Number(viewRow?.id) === Number(row.id)) {
        setViewRow(null);
      }
      setSuccess("Produto excluido com sucesso.");
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingRowId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.name.trim() || !form.category.trim()) {
        throw new Error("Informe nome e categoria.");
      }

      if (skuConflictName) {
        throw new Error(`SKU jÃ¡ existe e estÃ¡ vinculado ao produto: ${skuConflictName}.`);
      }

      const normalizedSku = normalizeSku(form.sku);
      if (normalizedSku) {
        const conflict = await checkSkuConflict(normalizedSku);
        if (conflict) {
          throw new Error(`SKU jÃ¡ existe e estÃ¡ vinculado ao produto: ${conflict.name}.`);
        }
      }

      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        imageUrl: toOptionalText(form.imageUrl),
        price: Number(form.price || 0),
        costPrice: Number(form.costPrice || 0),
        sku: normalizedSku || null,
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        stock: Number(form.stock || 0),
        lowStockThreshold: Number(form.lowStockThreshold || 0),
        active: form.active
      };

      if (!editingId) {
        await api.request("/registry/sale-products", {
          method: "POST",
          token,
          body: payload
        });
      } else {
        await api.request(`/registry/sale-products/${editingId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingId ? "Produto atualizado com sucesso." : "Produto criado com sucesso.");
      resetForm();
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="registry-panel-header">
        <h2>Produtos de Venda</h2>
        <label className="inline-check">
          <input
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            type="checkbox"
          />
          Mostrar inativos
        </label>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="grid-2">
          <label>
            Nome
            <input
              onChange={(event) => updateField("name", event.target.value)}
              required
              type="text"
              value={form.name}
            />
          </label>
          <label>
            Categoria
            <input
              onChange={(event) => updateField("category", event.target.value)}
              required
              type="text"
              value={form.category}
            />
          </label>
        </div>

        <div className="grid-3">
          <label>
            PreÃ§o de venda (R$)
            <CurrencyInput min={0} onValueChange={(value) => updateField("price", value)} value={form.price} />
          </label>
          <label>
            Custo (R$)
            <CurrencyInput
              min={0}
              onValueChange={(value) => updateField("costPrice", value)}
              value={form.costPrice}
            />
          </label>
          <label>
            Estoque
            <input
              min={0}
              onChange={(event) => updateField("stock", event.target.value)}
              step="1"
              type="number"
              value={form.stock}
            />
          </label>
        </div>

        <div className="grid-3">
          <label>
            Estoque mÃ­nimo
            <input
              min={0}
              onChange={(event) => updateField("lowStockThreshold", event.target.value)}
              step="1"
              type="number"
              value={form.lowStockThreshold}
            />
          </label>
          <label>
            SKU
            <input
              onBlur={handleSkuBlur}
              onChange={(event) => updateSkuField(event.target.value)}
              placeholder="Deixe em branco para geraÃ§Ã£o automÃ¡tica"
              type="text"
              value={form.sku}
            />
          </label>
          <label>
            Fornecedor
            <select
              onChange={(event) => updateField("supplierId", event.target.value)}
              value={form.supplierId}
            >
              <option value="">Selecione</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({supplier.person_type === "pj" ? "PJ" : "PF"})
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Imagem do produto
          <input accept="image/*" onChange={handleImageFileChange} type="file" />
        </label>
        {form.imageUrl ? (
          <div className="table-actions">
            <img
              alt="PrÃ©-visualizaÃ§Ã£o"
              src={form.imageUrl}
              style={{ borderRadius: "10px", maxHeight: "120px", maxWidth: "220px", objectFit: "cover" }}
            />
            <button className="button button-outline" onClick={() => updateField("imageUrl", "")} type="button">
              Remover imagem
            </button>
          </div>
        ) : null}

        <label>
          DescriÃ§Ã£o
          <textarea
            onChange={(event) => updateField("description", event.target.value)}
            rows={3}
            value={form.description}
          />
        </label>

        <label className="inline-check">
          <input
            checked={form.active}
            onChange={(event) => updateField("active", event.target.checked)}
            type="checkbox"
          />
          Produto ativo
        </label>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />
        {skuLookupLoading ? <p className="muted">Validando SKU...</p> : null}

        <div className="clients-form-footer">
          <div className="clients-form-actions">
            <button
              aria-label={editingId ? "Atualizar produto" : "Criar produto"}
              className="button button-primary small clients-action-button"
              disabled={saving}
              title={saving ? "Salvando..." : editingId ? "Atualizar produto" : "Criar produto"}
              type="submit"
            >
              <CrudActionIcon type="save" />
            </button>
            <button
              aria-label="Novo cadastro"
              className="button button-outline small clients-action-button"
              disabled={saving}
              onClick={resetForm}
              title="Novo cadastro"
              type="button"
            >
              <CrudActionIcon type="new" />
            </button>
            {editingId ? (
              <button
                aria-label="Cancelar edicao"
                className="button button-outline small clients-action-button"
                disabled={saving}
                onClick={resetForm}
                title="Cancelar edicao"
                type="button"
              >
                <CrudActionIcon type="cancel" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="table-wrapper registry-table">
        <div className="registry-search registry-search-compact suppliers-search-compact">
          <label>
            Ordenar por
            <select onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
              {REGISTRY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p>Carregando produtos...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">Nenhum produto encontrado.</p> : null}
        {sortedRows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>SKU</th>
                <th>Fornecedor</th>
                <th>PreÃ§o</th>
                <th>Custo</th>
                <th>Estoque</th>
                <th>MÃ­nimo</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const active = isActiveValue(row.active);
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.category}</td>
                    <td>{row.sku || "-"}</td>
                    <td>{row.supplier_name || "-"}</td>
                    <td>{formatCurrency(row.price)}</td>
                    <td>{formatCurrency(row.cost_price)}</td>
                    <td>{row.stock}</td>
                    <td>{row.low_stock_threshold}</td>
                    <td>{active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <div className="clients-row-actions">
                        <button
                          aria-label={`Visualizar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action view"
                          onClick={() => setViewRow(row)}
                          title="Visualizar"
                          type="button"
                        >
                          <CrudActionIcon type="view" />
                        </button>
                        <button
                          aria-label={`Editar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action edit"
                          onClick={() => startEdit(row)}
                          title="Editar"
                          type="button"
                        >
                          <CrudActionIcon type="edit" />
                        </button>
                        <button
                          aria-label={`Excluir ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action delete"
                          onClick={() => handleDelete(row)}
                          disabled={deletingRowId === row.id}
                          title="Excluir"
                          type="button"
                        >
                          <CrudActionIcon type="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <RegistryViewDialog
        open={Boolean(viewRow)}
        title="Produto de Venda"
        fields={
          viewRow
            ? [
                { label: "Nome", value: viewRow.name || "-" },
                { label: "Categoria", value: viewRow.category || "-" },
                { label: "SKU", value: viewRow.sku || "-" },
                { label: "Fornecedor", value: viewRow.supplier_name || "-" },
                { label: "Preco", value: formatCurrency(viewRow.price || 0) },
                { label: "Custo", value: formatCurrency(viewRow.cost_price || 0) },
                { label: "Estoque", value: String(viewRow.stock ?? "-") },
                { label: "Estoque minimo", value: String(viewRow.low_stock_threshold ?? "-") },
                { label: "Status", value: isActiveValue(viewRow.active) ? "Ativo" : "Inativo" }
              ]
            : []
        }
        onClose={() => setViewRow(null)}
      />
    </section>
  );
}

function ConsumablesRegistry({ token }) {
  const { showConfirm } = useDialog();
  const initialForm = {
    name: "",
    category: "",
    unit: "un",
    description: "",
    currentStock: "0",
    minStock: "0",
    costPerUnit: 0,
    supplierId: "",
    lastPurchaseOn: "",
    active: true
  };

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState(null);

  async function loadRows(showInactive = includeInactive) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const query = showInactive ? "?includeInactive=true" : "";
      const [materialsData, suppliersData] = await Promise.all([
        api.request(`/registry/consumables${query}`, { token }),
        api.request("/registry/suppliers?includeInactive=true", { token })
      ]);
      setRows(materialsData);
      setSuppliers(suppliersData);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, [token, includeInactive]);

  const sortedRows = useMemo(
    () => sortRegistryRows(rows, sortMode, (row) => row.name),
    [rows, sortMode]
  );

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
  }

  function startEdit(row) {
    setEditingId(row.id);
    setError("");
    setSuccess("");
    setForm({
      name: row.name || "",
      category: row.category || "",
      unit: row.unit || "un",
      description: row.description || "",
      currentStock: String(row.current_stock ?? 0),
      minStock: String(row.min_stock ?? 0),
      costPerUnit: Number(row.cost_per_unit ?? 0),
      supplierId: row.supplier_id ? String(row.supplier_id) : "",
      lastPurchaseOn: toDateInputValue(row.last_purchase_on),
      active: isActiveValue(row.active)
    });
  }

  async function handleDelete(row) {
    const confirmed = await showConfirm({
      title: "Excluir material",
      message: `Deseja realmente excluir ${row.name}?`,
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setDeletingRowId(row.id);
    try {
      await api.request(`/registry/consumables/${row.id}`, { method: "DELETE", token });
      if (Number(editingId) === Number(row.id)) {
        resetForm();
      }
      if (Number(viewRow?.id) === Number(row.id)) {
        setViewRow(null);
      }
      setSuccess("Material excluido com sucesso.");
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingRowId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.name.trim() || !form.category.trim() || !form.unit.trim()) {
        throw new Error("Informe nome, categoria e unidade.");
      }

      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        unit: form.unit.trim(),
        description: form.description.trim(),
        currentStock: Number(form.currentStock || 0),
        minStock: Number(form.minStock || 0),
        costPerUnit: Number(form.costPerUnit || 0),
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        lastPurchaseOn: toOptionalDate(form.lastPurchaseOn),
        active: form.active
      };

      if (!editingId) {
        await api.request("/registry/consumables", {
          method: "POST",
          token,
          body: payload
        });
      } else {
        await api.request(`/registry/consumables/${editingId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingId ? "Material atualizado com sucesso." : "Material criado com sucesso.");
      resetForm();
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="registry-panel-header">
        <h2>Material de Consumo</h2>
        <label className="inline-check">
          <input
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            type="checkbox"
          />
          Mostrar inativos
        </label>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="grid-3">
          <label>
            Nome
            <input
              onChange={(event) => updateField("name", event.target.value)}
              required
              type="text"
              value={form.name}
            />
          </label>
          <label>
            Categoria
            <input
              onChange={(event) => updateField("category", event.target.value)}
              required
              type="text"
              value={form.category}
            />
          </label>
          <label>
            Unidade
            <input
              onChange={(event) => updateField("unit", event.target.value)}
              required
              type="text"
              value={form.unit}
            />
          </label>
        </div>

        <div className="grid-3">
          <label>
            Estoque atual
            <input
              min={0}
              onChange={(event) => updateField("currentStock", event.target.value)}
              step="0.01"
              type="number"
              value={form.currentStock}
            />
          </label>
          <label>
            Estoque mÃ­nimo
            <input
              min={0}
              onChange={(event) => updateField("minStock", event.target.value)}
              step="0.01"
              type="number"
              value={form.minStock}
            />
          </label>
          <label>
            Custo por unidade (R$)
            <CurrencyInput
              min={0}
              onValueChange={(value) => updateField("costPerUnit", value)}
              value={form.costPerUnit}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Fornecedor
            <select
              onChange={(event) => updateField("supplierId", event.target.value)}
              value={form.supplierId}
            >
              <option value="">Selecione</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({supplier.person_type === "pj" ? "PJ" : "PF"})
                </option>
              ))}
            </select>
          </label>
          <label>
            Ultima compra
            <input
              onChange={(event) => updateField("lastPurchaseOn", event.target.value)}
              type="date"
              value={form.lastPurchaseOn}
            />
          </label>
        </div>

        <label>
          Descricao
          <textarea
            onChange={(event) => updateField("description", event.target.value)}
            rows={3}
            value={form.description}
          />
        </label>

        <label className="inline-check">
          <input
            checked={form.active}
            onChange={(event) => updateField("active", event.target.checked)}
            type="checkbox"
          />
          Material ativo
        </label>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <div className="clients-form-footer">
          <div className="clients-form-actions">
            <button
              aria-label={editingId ? "Atualizar material" : "Criar material"}
              className="button button-primary small clients-action-button"
              disabled={saving}
              title={saving ? "Salvando..." : editingId ? "Atualizar material" : "Criar material"}
              type="submit"
            >
              <CrudActionIcon type="save" />
            </button>
            <button
              aria-label="Novo cadastro"
              className="button button-outline small clients-action-button"
              disabled={saving}
              onClick={resetForm}
              title="Novo cadastro"
              type="button"
            >
              <CrudActionIcon type="new" />
            </button>
            {editingId ? (
              <button
                aria-label="Cancelar edicao"
                className="button button-outline small clients-action-button"
                disabled={saving}
                onClick={resetForm}
                title="Cancelar edicao"
                type="button"
              >
                <CrudActionIcon type="cancel" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="table-wrapper registry-table">
        <div className="registry-search registry-search-compact suppliers-search-compact">
          <label>
            Ordenar por
            <select onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
              {REGISTRY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p>Carregando materiais...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">Nenhum material encontrado.</p> : null}
        {sortedRows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>Unidade</th>
                <th>Estoque</th>
                <th>MÃ­nimo</th>
                <th>Custo</th>
                <th>Fornecedor</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const active = isActiveValue(row.active);
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.category}</td>
                    <td>{row.unit}</td>
                    <td>{row.current_stock}</td>
                    <td>{row.min_stock}</td>
                    <td>{formatCurrency(row.cost_per_unit)}</td>
                    <td>{row.supplier_name || "-"}</td>
                    <td>{active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <div className="clients-row-actions">
                        <button
                          aria-label={`Visualizar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action view"
                          onClick={() => setViewRow(row)}
                          title="Visualizar"
                          type="button"
                        >
                          <CrudActionIcon type="view" />
                        </button>
                        <button
                          aria-label={`Editar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action edit"
                          onClick={() => startEdit(row)}
                          title="Editar"
                          type="button"
                        >
                          <CrudActionIcon type="edit" />
                        </button>
                        <button
                          aria-label={`Excluir ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action delete"
                          onClick={() => handleDelete(row)}
                          disabled={deletingRowId === row.id}
                          title="Excluir"
                          type="button"
                        >
                          <CrudActionIcon type="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <RegistryViewDialog
        open={Boolean(viewRow)}
        title="Material de Consumo"
        fields={
          viewRow
            ? [
                { label: "Nome", value: viewRow.name || "-" },
                { label: "Categoria", value: viewRow.category || "-" },
                { label: "Unidade", value: viewRow.unit || "-" },
                { label: "Fornecedor", value: viewRow.supplier_name || "-" },
                { label: "Estoque atual", value: String(viewRow.current_stock ?? "-") },
                { label: "Estoque minimo", value: String(viewRow.min_stock ?? "-") },
                { label: "Custo", value: formatCurrency(viewRow.cost_per_unit || 0) },
                { label: "Ultima compra", value: viewRow.last_purchase_on ? formatDateShort(viewRow.last_purchase_on) : "-" },
                { label: "Status", value: isActiveValue(viewRow.active) ? "Ativo" : "Inativo" }
              ]
            : []
        }
        onClose={() => setViewRow(null)}
      />
    </section>
  );
}

function ExpenseTypesRegistry({ token }) {
  const { showConfirm } = useDialog();
  const initialForm = {
    name: "",
    description: "",
    active: true
  };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState(null);

  async function loadRows(showInactive = includeInactive) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const query = showInactive ? "?includeInactive=true" : "";
      const data = await api.request(`/registry/expense-types${query}`, { token });
      setRows(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, [token, includeInactive]);

  const sortedRows = useMemo(
    () => sortRegistryRows(rows, sortMode, (row) => row.name),
    [rows, sortMode]
  );

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
  }

  function startEdit(row) {
    setEditingId(row.id);
    setError("");
    setSuccess("");
    setForm({
      name: row.name || "",
      description: row.description || "",
      active: isActiveValue(row.active)
    });
  }

  async function handleDelete(row) {
    const confirmed = await showConfirm({
      title: "Excluir tipo de despesa",
      message: `Deseja realmente excluir ${row.name}?`,
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setDeletingRowId(row.id);
    try {
      await api.request(`/registry/expense-types/${row.id}`, { method: "DELETE", token });
      if (Number(editingId) === Number(row.id)) {
        resetForm();
      }
      if (Number(viewRow?.id) === Number(row.id)) {
        setViewRow(null);
      }
      setSuccess("Tipo de despesa excluido com sucesso.");
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingRowId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.name.trim()) {
        throw new Error("Informe o nome do tipo de despesa.");
      }

      const payload = {
        name: form.name.trim(),
        description: toOptionalText(form.description),
        active: form.active
      };

      if (!editingId) {
        await api.request("/registry/expense-types", {
          method: "POST",
          token,
          body: payload
        });
      } else {
        await api.request(`/registry/expense-types/${editingId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingId ? "Tipo de despesa atualizado com sucesso." : "Tipo de despesa criado com sucesso.");
      resetForm();
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="registry-panel-header">
        <h2>Tipos de Despesas</h2>
        <label className="inline-check">
          <input
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            type="checkbox"
          />
          Mostrar inativos
        </label>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="grid-2">
          <label>
            Nome
            <input
              onChange={(event) => updateField("name", event.target.value)}
              required
              type="text"
              value={form.name}
            />
          </label>
          <label className="inline-check">
            <input
              checked={form.active}
              onChange={(event) => updateField("active", event.target.checked)}
              type="checkbox"
            />
            Tipo de despesa ativo
          </label>
        </div>

        <label>
          Descricao
          <textarea
            onChange={(event) => updateField("description", event.target.value)}
            rows={3}
            value={form.description}
          />
        </label>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <div className="clients-form-footer">
          <div className="clients-form-actions">
            <button
              aria-label={editingId ? "Atualizar tipo de despesa" : "Criar tipo de despesa"}
              className="button button-primary small clients-action-button"
              disabled={saving}
              title={saving ? "Salvando..." : editingId ? "Atualizar tipo de despesa" : "Criar tipo de despesa"}
              type="submit"
            >
              <CrudActionIcon type="save" />
            </button>
            <button
              aria-label="Novo cadastro"
              className="button button-outline small clients-action-button"
              disabled={saving}
              onClick={resetForm}
              title="Novo cadastro"
              type="button"
            >
              <CrudActionIcon type="new" />
            </button>
            {editingId ? (
              <button
                aria-label="Cancelar edicao"
                className="button button-outline small clients-action-button"
                disabled={saving}
                onClick={resetForm}
                title="Cancelar edicao"
                type="button"
              >
                <CrudActionIcon type="cancel" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="table-wrapper registry-table">
        <div className="registry-search registry-search-compact suppliers-search-compact">
          <label>
            Ordenar por
            <select onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
              {REGISTRY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p>Carregando tipos de despesas...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">Nenhum tipo de despesa encontrado.</p> : null}
        {sortedRows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>DescriÃ§Ã£o</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const active = isActiveValue(row.active);
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.description || "-"}</td>
                    <td>{active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <div className="clients-row-actions">
                        <button
                          aria-label={`Visualizar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action view"
                          onClick={() => setViewRow(row)}
                          title="Visualizar"
                          type="button"
                        >
                          <CrudActionIcon type="view" />
                        </button>
                        <button
                          aria-label={`Editar ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action edit"
                          onClick={() => startEdit(row)}
                          title="Editar"
                          type="button"
                        >
                          <CrudActionIcon type="edit" />
                        </button>
                        <button
                          aria-label={`Excluir ${row.name}`}
                          className="button button-outline small action-icon-button clients-row-action delete"
                          onClick={() => handleDelete(row)}
                          disabled={deletingRowId === row.id}
                          title="Excluir"
                          type="button"
                        >
                          <CrudActionIcon type="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <RegistryViewDialog
        open={Boolean(viewRow)}
        title="Tipo de Despesa"
        fields={
          viewRow
            ? [
                { label: "Nome", value: viewRow.name || "-" },
                { label: "Descricao", value: viewRow.description || "-" },
                { label: "Status", value: isActiveValue(viewRow.active) ? "Ativo" : "Inativo" }
              ]
            : []
        }
        onClose={() => setViewRow(null)}
      />
    </section>
  );
}

function BanksRegistry({ token }) {
  const { showConfirm } = useDialog();
  const initialForm = {
    bankCode: "",
    accountName: "",
    accountType: "corrente",
    branch: "",
    accountNumber: "",
    pixKey: "",
    initialBalance: 0,
    currentBalance: 0,
    notes: "",
    active: true
  };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState(null);
  const [bankOptions, setBankOptions] = useState([]);
  const [bankSearch, setBankSearch] = useState("");
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const bankDropdownRef = useRef(null);

  async function loadRows(showInactive = includeInactive) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const query = showInactive ? "?includeInactive=true" : "";
      const data = await api.request(`/registry/banks${query}`, { token });
      setRows(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBankCatalog() {
    if (!token) return;
    try {
      const data = await api.request("/registry/banks/catalog", { token });
      setBankOptions(Array.isArray(data?.options) ? data.options : []);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadRows();
  }, [token, includeInactive]);

  useEffect(() => {
    loadBankCatalog();
  }, [token]);

  const sortedRows = useMemo(
    () => sortRegistryRows(rows, sortMode, (row) => row.bank_name),
    [rows, sortMode]
  );

  const filteredBankOptions = useMemo(() => {
    const search = normalizeSearchText(bankSearch);
    if (!search) return bankOptions;

    const filtered = bankOptions.filter((option) => {
      const code = normalizeSearchText(option.code);
      const name = normalizeSearchText(option.name);
      const label = normalizeSearchText(option.label);
      return code.includes(search) || name.includes(search) || label.includes(search);
    });

    if (!form.bankCode) return filtered;

    const hasSelectedOption = filtered.some((option) => String(option.code) === String(form.bankCode));
    if (hasSelectedOption) return filtered;

    const selectedOption = bankOptions.find((option) => String(option.code) === String(form.bankCode));
    return selectedOption ? [selectedOption, ...filtered] : filtered;
  }, [bankOptions, bankSearch, form.bankCode]);

  const selectedBankOption = useMemo(
    () => bankOptions.find((option) => String(option.code) === String(form.bankCode)) || null,
    [bankOptions, form.bankCode]
  );

  useEffect(() => {
    if (!bankDropdownOpen) return undefined;

    function handleClickOutside(event) {
      if (!bankDropdownRef.current?.contains(event.target)) {
        setBankDropdownOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setBankDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [bankDropdownOpen]);

  function getBankCodeFromRow(row) {
    if (row?.bank_code) return String(row.bank_code);
    const match = String(row?.bank_name || "").match(/^(\d{3})\s*-/);
    if (match?.[1]) return match[1];

    const normalizedName = String(row?.bank_name || "").trim().toLowerCase();
    for (const option of bankOptions) {
      if (String(option.name || "").trim().toLowerCase() === normalizedName) {
        return String(option.code);
      }
    }
    return "";
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function selectBankCode(code) {
    updateField("bankCode", code);
    setBankDropdownOpen(false);
    setBankSearch("");
  }

  function resetForm() {
    setForm(initialForm);
    setBankSearch("");
    setBankDropdownOpen(false);
    setEditingId(null);
  }

  function startEdit(row) {
    const bankCode = getBankCodeFromRow(row);
    setEditingId(row.id);
    setError("");
    setSuccess("");
    setBankSearch("");
    setBankDropdownOpen(false);
    setForm({
      bankCode,
      accountName: row.account_name || "",
      accountType: row.account_type || "corrente",
      branch: row.branch || "",
      accountNumber: row.account_number || "",
      pixKey: row.pix_key || "",
      initialBalance: Number(row.initial_balance ?? 0),
      currentBalance: Number(row.current_balance ?? 0),
      notes: row.notes || "",
      active: isActiveValue(row.active)
    });
  }

  async function handleDelete(row) {
    const confirmed = await showConfirm({
      title: "Excluir banco",
      message: `Deseja realmente excluir ${row.bank_name}?`,
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setDeletingRowId(row.id);
    try {
      await api.request(`/registry/banks/${row.id}`, { method: "DELETE", token });
      if (Number(editingId) === Number(row.id)) {
        resetForm();
      }
      if (Number(viewRow?.id) === Number(row.id)) {
        setViewRow(null);
      }
      setSuccess("Banco excluido com sucesso.");
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingRowId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.bankCode || !form.accountName.trim()) {
        throw new Error("Selecione o banco e informe o nome da conta.");
      }

      const payload = {
        bankCode: form.bankCode,
        accountName: form.accountName.trim(),
        accountType: form.accountType,
        branch: toOptionalText(form.branch),
        accountNumber: toOptionalText(form.accountNumber),
        pixKey: toOptionalText(form.pixKey),
        initialBalance: Number(form.initialBalance || 0),
        currentBalance: Number(form.currentBalance || 0),
        notes: toOptionalText(form.notes),
        active: form.active
      };

      if (!editingId) {
        await api.request("/registry/banks", {
          method: "POST",
          token,
          body: payload
        });
      } else {
        await api.request(`/registry/banks/${editingId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingId ? "Banco atualizado com sucesso." : "Banco criado com sucesso.");
      resetForm();
      await loadRows();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="registry-panel-header">
        <h2>Bancos</h2>
        <label className="inline-check">
          <input
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            type="checkbox"
          />
          Mostrar inativos
        </label>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="grid-3">
          <label>
            Banco
            <div className="bank-select" ref={bankDropdownRef}>
              <button
                aria-expanded={bankDropdownOpen}
                aria-haspopup="listbox"
                className="bank-select-trigger"
                onClick={() => setBankDropdownOpen((current) => !current)}
                type="button"
              >
                {selectedBankOption ? selectedBankOption.label : "Selecione"}
              </button>
              {bankDropdownOpen ? (
                <div className="bank-select-menu">
                  <div className="bank-select-options" role="listbox">
                    <button
                      className={`bank-select-option ${form.bankCode ? "" : "selected"}`}
                      onClick={() => selectBankCode("")}
                      type="button"
                    >
                      Selecione
                    </button>
                  </div>
                  <input
                    autoFocus
                    className="bank-select-search"
                    onChange={(event) => setBankSearch(event.target.value)}
                    placeholder="Buscar por codigo ou nome"
                    type="text"
                    value={bankSearch}
                  />
                  <div className="bank-select-options" role="listbox">
                    {filteredBankOptions.map((option) => (
                      <button
                        className={`bank-select-option ${String(form.bankCode) === String(option.code) ? "selected" : ""}`}
                        key={option.code}
                        onClick={() => selectBankCode(option.code)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                    {filteredBankOptions.length === 0 ? (
                      <p className="bank-select-empty">Nenhum banco encontrado para a busca.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </label>
          <label>
            Nome da conta
            <input
              onChange={(event) => updateField("accountName", event.target.value)}
              required
              type="text"
              value={form.accountName}
            />
          </label>
          <label>
            Tipo de conta
            <select
              onChange={(event) => updateField("accountType", event.target.value)}
              value={form.accountType}
            >
              <option value="corrente">Corrente</option>
              <option value="poupanca">Poupanca</option>
              <option value="investimento">Investimento</option>
              <option value="caixa">Caixa</option>
            </select>
          </label>
        </div>

        <div className="grid-3">
          <label>
            Agencia
            <input
              onChange={(event) => updateField("branch", event.target.value)}
              type="text"
              value={form.branch}
            />
          </label>
          <label>
            Numero da conta
            <input
              onChange={(event) => updateField("accountNumber", event.target.value)}
              type="text"
              value={form.accountNumber}
            />
          </label>
          <label>
            Chave PIX
            <input
              onChange={(event) => updateField("pixKey", event.target.value)}
              type="text"
              value={form.pixKey}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Saldo inicial (R$)
            <CurrencyInput
              min={0}
              onValueChange={(value) => updateField("initialBalance", value)}
              value={form.initialBalance}
            />
          </label>
          <label>
            Saldo atual (R$)
            <CurrencyInput
              min={0}
              onValueChange={(value) => updateField("currentBalance", value)}
              value={form.currentBalance}
            />
          </label>
        </div>

        <label>
          Observacoes
          <textarea
            onChange={(event) => updateField("notes", event.target.value)}
            rows={3}
            value={form.notes}
          />
        </label>

        <label className="inline-check">
          <input
            checked={form.active}
            onChange={(event) => updateField("active", event.target.checked)}
            type="checkbox"
          />
          Conta ativa
        </label>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <div className="clients-form-footer">
          <div className="clients-form-actions">
            <button
              aria-label="Salvar banco"
              className="button button-primary small"
              disabled={saving}
              title={saving ? "Salvando..." : "Salvar"}
              type="submit"
            >
              Salvar
            </button>
            {editingId ? (
              <button
                aria-label="Cancelar edicao"
                className="button button-outline small clients-action-button"
                disabled={saving}
                onClick={resetForm}
                title="Cancelar edicao"
                type="button"
              >
                <CrudActionIcon type="cancel" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="table-wrapper registry-table">
        <div className="registry-search registry-search-compact suppliers-search-compact">
          <label>
            Ordenar por
            <select onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
              {REGISTRY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p>Carregando bancos...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">Nenhum banco encontrado.</p> : null}
        {sortedRows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Banco</th>
                <th>Conta</th>
                <th>Tipo</th>
                <th>PIX</th>
                <th>Saldo inicial</th>
                <th>Saldo atual</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const active = isActiveValue(row.active);
                return (
                  <tr key={row.id}>
                    <td>{row.bank_name}</td>
                    <td>{row.account_name}</td>
                    <td>{row.account_type}</td>
                    <td>{row.pix_key || "-"}</td>
                    <td>{formatCurrency(row.initial_balance)}</td>
                    <td>{formatCurrency(row.current_balance)}</td>
                    <td>{active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <div className="clients-row-actions">
                        <button
                          aria-label={`Visualizar ${row.bank_name}`}
                          className="button button-outline small action-icon-button clients-row-action view"
                          onClick={() => setViewRow(row)}
                          title="Visualizar"
                          type="button"
                        >
                          <CrudActionIcon type="view" />
                        </button>
                        <button
                          aria-label={`Editar ${row.bank_name}`}
                          className="button button-outline small action-icon-button clients-row-action edit"
                          onClick={() => startEdit(row)}
                          title="Editar"
                          type="button"
                        >
                          <CrudActionIcon type="edit" />
                        </button>
                        <button
                          aria-label={`Excluir ${row.bank_name}`}
                          className="button button-outline small action-icon-button clients-row-action delete"
                          onClick={() => handleDelete(row)}
                          disabled={deletingRowId === row.id}
                          title="Excluir"
                          type="button"
                        >
                          <CrudActionIcon type="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <RegistryViewDialog
        open={Boolean(viewRow)}
        title="Banco"
        fields={
          viewRow
            ? [
                { label: "Codigo", value: viewRow.bank_code || "-" },
                { label: "Banco", value: viewRow.bank_name || "-" },
                { label: "Conta", value: viewRow.account_name || "-" },
                { label: "Tipo de conta", value: viewRow.account_type || "-" },
                { label: "Agencia", value: viewRow.branch || "-" },
                { label: "Numero da conta", value: viewRow.account_number || "-" },
                { label: "Chave PIX", value: viewRow.pix_key || "-" },
                { label: "Saldo inicial", value: formatCurrency(viewRow.initial_balance || 0) },
                { label: "Saldo atual", value: formatCurrency(viewRow.current_balance || 0) },
                { label: "Status", value: isActiveValue(viewRow.active) ? "Ativo" : "Inativo" }
              ]
            : []
        }
        onClose={() => setViewRow(null)}
      />
    </section>
  );
}


