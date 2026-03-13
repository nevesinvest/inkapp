import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { StatusPill } from "../components/StatusPill";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { formatCurrency, formatDateShort } from "../utils/format";
import { toDateInputSaoPaulo } from "../utils/timezone";

const PAYABLE_STATUS_OPTIONS = [
  { value: "pending", label: "Pendente" },
  { value: "paid", label: "Pago" },
  { value: "cancelled", label: "Cancelado" }
];

const RECEIVABLE_STATUS_OPTIONS = [
  { value: "pending", label: "Pendente" },
  { value: "received", label: "Recebido" },
  { value: "cancelled", label: "Cancelado" }
];

function resolveIssueDate(value) {
  const normalized = String(value || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return toDateInputSaoPaulo();
}

function isLiquidationDateBeforeIssueDate(liquidationDate, issueDate) {
  if (!liquidationDate || !issueDate) return false;
  return liquidationDate < issueDate;
}

function isDateAfterToday(value, today = toDateInputSaoPaulo()) {
  if (!value) return false;
  return value > today;
}

function buildQuery(filters, extra = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

export function FinancePage({ section = "all" }) {
  const { token } = useAuth();
  const { showConfirm } = useDialog();
  const [suppliers, setSuppliers] = useState([]);
  const [clients, setClients] = useState([]);
  const [expenseTypes, setExpenseTypes] = useState([]);

  function createPayableDefaultForm() {
    return {
      supplierId: "",
      expenseTypeId: "",
      description: "",
      amount: 0,
      dueDate: toDateInputSaoPaulo(),
      issueDate: toDateInputSaoPaulo(),
      status: "pending",
      paidOn: "",
      notes: ""
    };
  }

  function createReceivableDefaultForm() {
    return {
      clientId: "",
      description: "",
      amount: 0,
      dueDate: toDateInputSaoPaulo(),
      issueDate: toDateInputSaoPaulo(),
      status: "pending",
      receivedOn: "",
      notes: ""
    };
  }

  const [payables, setPayables] = useState([]);
  const [payableFilters, setPayableFilters] = useState({
    status: "",
    dateFrom: "",
    dateTo: ""
  });
  const [payableForm, setPayableForm] = useState(createPayableDefaultForm);
  const [editingPayableId, setEditingPayableId] = useState(null);

  const [receivables, setReceivables] = useState([]);
  const [receivableFilters, setReceivableFilters] = useState({
    status: "",
    dateFrom: "",
    dateTo: ""
  });
  const [receivableForm, setReceivableForm] = useState(createReceivableDefaultForm);
  const [editingReceivableId, setEditingReceivableId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [savingPayable, setSavingPayable] = useState(false);
  const [savingReceivable, setSavingReceivable] = useState(false);
  const [updatingPayableStatus, setUpdatingPayableStatus] = useState(false);
  const [payableStatusDialog, setPayableStatusDialog] = useState(null);
  const [updatingReceivableStatus, setUpdatingReceivableStatus] = useState(false);
  const [receivableStatusDialog, setReceivableStatusDialog] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const payableOriginalRef = useRef({
    editingId: null,
    form: createPayableDefaultForm()
  });
  const receivableOriginalRef = useRef({
    editingId: null,
    form: createReceivableDefaultForm()
  });
  const payableIssueDateInputRef = useRef(null);
  const receivableIssueDateInputRef = useRef(null);
  const payableDueDateInputRef = useRef(null);
  const receivableDueDateInputRef = useRef(null);
  const payablePaidOnInputRef = useRef(null);
  const receivableReceivedOnInputRef = useRef(null);
  const payablePanelHeaderRef = useRef(null);
  const receivablePanelHeaderRef = useRef(null);
  const isPayableOnly = section === "payable";
  const isReceivableOnly = section === "receivable";
  const showPayables = !isReceivableOnly;
  const showReceivables = !isPayableOnly;
  const payableMenuActive = isPayableOnly;
  const receivableMenuActive = isReceivableOnly;

  async function loadLookups() {
    const [suppliersData, clientsData, expenseTypesData] = await Promise.all([
      api.request("/registry/suppliers", { token }),
      api.request("/registry/clients", { token }),
      api.request("/registry/expense-types", { token })
    ]);
    setSuppliers(suppliersData);
    setClients(clientsData);
    setExpenseTypes(expenseTypesData);
  }

  async function loadPayables(nextFilters = payableFilters) {
    const query = buildQuery(nextFilters, { limit: 600 });
    const data = await api.request(`/finance/accounts-payable${query ? `?${query}` : ""}`, { token });
    setPayables(data);
  }

  async function loadReceivables(nextFilters = receivableFilters) {
    const query = buildQuery(nextFilters, { limit: 600 });
    const data = await api.request(`/finance/accounts-receivable${query ? `?${query}` : ""}`, { token });
    setReceivables(data);
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    Promise.all([loadLookups(), loadPayables(), loadReceivables()])
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);

  function snapshotPayableOriginal(form, editingId = null) {
    payableOriginalRef.current = {
      editingId,
      form: { ...form }
    };
  }

  function snapshotReceivableOriginal(form, editingId = null) {
    receivableOriginalRef.current = {
      editingId,
      form: { ...form }
    };
  }

  function restorePayableOriginalLaunch() {
    const original = payableOriginalRef.current;
    if (!original) return;
    setEditingPayableId(original.editingId);
    setPayableForm({ ...original.form });
    setSuccess("");
    setError("");
  }

  function restoreReceivableOriginalLaunch() {
    const original = receivableOriginalRef.current;
    if (!original) return;
    setEditingReceivableId(original.editingId);
    setReceivableForm({ ...original.form });
    setSuccess("");
    setError("");
  }

  function resetPayableForm() {
    const nextForm = createPayableDefaultForm();
    setEditingPayableId(null);
    setPayableForm(nextForm);
    snapshotPayableOriginal(nextForm, null);
  }

  function resetReceivableForm() {
    const nextForm = createReceivableDefaultForm();
    setEditingReceivableId(null);
    setReceivableForm(nextForm);
    snapshotReceivableOriginal(nextForm, null);
  }

  function focusPayablePaidOnField() {
    setTimeout(() => {
      if (payablePaidOnInputRef.current) {
        payablePaidOnInputRef.current.focus();
      }
    }, 0);
  }

  function focusPayableDueDateField() {
    setTimeout(() => {
      if (payableDueDateInputRef.current) {
        payableDueDateInputRef.current.focus();
      }
    }, 0);
  }

  function focusReceivableReceivedOnField() {
    setTimeout(() => {
      if (receivableReceivedOnInputRef.current) {
        receivableReceivedOnInputRef.current.focus();
      }
    }, 0);
  }

  function focusReceivableDueDateField() {
    setTimeout(() => {
      if (receivableDueDateInputRef.current) {
        receivableDueDateInputRef.current.focus();
      }
    }, 0);
  }

  function focusPayableIssueDateField() {
    setTimeout(() => {
      if (payableIssueDateInputRef.current) {
        payableIssueDateInputRef.current.focus();
      }
    }, 0);
  }

  function focusReceivableIssueDateField() {
    setTimeout(() => {
      if (receivableIssueDateInputRef.current) {
        receivableIssueDateInputRef.current.focus();
      }
    }, 0);
  }

  function scrollToSectionHeader(headerRef) {
    setTimeout(() => {
      const headerElement = headerRef.current;
      if (!headerElement) return;

      const topbarElement = document.querySelector(".topbar");
      const topbarHeight = topbarElement ? topbarElement.getBoundingClientRect().height : 0;
      const offset = topbarHeight + 28;
      const targetTop = window.scrollY + headerElement.getBoundingClientRect().top - offset;

      window.scrollTo({
        top: Math.max(targetTop, 0),
        behavior: "smooth"
      });
    }, 0);
  }

  function scrollToPayableEditStart() {
    scrollToSectionHeader(payablePanelHeaderRef);
  }

  function scrollToReceivableEditStart() {
    scrollToSectionHeader(receivablePanelHeaderRef);
  }

  async function showDateValidationDialog({ title, message, onCancel }) {
    const accepted = await showConfirm({
      title,
      message,
      confirmLabel: "OK",
      cancelLabel: "Cancelar"
    });
    if (!accepted && typeof onCancel === "function") {
      onCancel();
    }
    return accepted;
  }

  async function showInvalidLiquidationDateAlert(scope) {
    return showDateValidationDialog({
      title: "Data de liquidacao invalida",
      message: "A data de liquidacao nao pode ser inferior a data de emissao.",
      onCancel: scope === "payable" ? restorePayableOriginalLaunch : restoreReceivableOriginalLaunch
    });
  }

  async function showLiquidationDateAfterTodayAlert(scope) {
    return showDateValidationDialog({
      title: "Data de liquidacao invalida",
      message: "A data de liquidacao nao pode ser superior a data atual.",
      onCancel: scope === "payable" ? restorePayableOriginalLaunch : restoreReceivableOriginalLaunch
    });
  }

  async function showDueDateBeforeIssueDateAlert(scope) {
    return showDateValidationDialog({
      title: "Data de vencimento invalida",
      message: "A data de vencimento nao pode ser inferior a data de emissao.",
      onCancel: scope === "payable" ? restorePayableOriginalLaunch : restoreReceivableOriginalLaunch
    });
  }

  async function showIssueDateAfterTodayAlert(scope) {
    return showDateValidationDialog({
      title: "Data de emissao invalida",
      message: "A data de emissao nao pode ser superior a data atual.",
      onCancel: scope === "payable" ? restorePayableOriginalLaunch : restoreReceivableOriginalLaunch
    });
  }

  function handlePayableFormStatusChange(nextStatus) {
    setPayableForm((current) => ({
      ...current,
      status: nextStatus,
      paidOn:
        nextStatus === "paid"
          ? (() => {
              const defaultPaidOn = current.paidOn || toDateInputSaoPaulo();
              return isLiquidationDateBeforeIssueDate(defaultPaidOn, current.issueDate)
                ? current.issueDate
                : defaultPaidOn;
            })()
          : ""
    }));
  }

  function handleReceivableFormStatusChange(nextStatus) {
    setReceivableForm((current) => ({
      ...current,
      status: nextStatus,
      receivedOn:
        nextStatus === "received"
          ? (() => {
              const defaultReceivedOn = current.receivedOn || toDateInputSaoPaulo();
              return isLiquidationDateBeforeIssueDate(defaultReceivedOn, current.issueDate)
                ? current.issueDate
                : defaultReceivedOn;
            })()
          : ""
    }));
  }

  function handleDateFieldKeyDown(event, validateFn) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void validateFn(event.currentTarget.value);
  }

  async function validatePayableIssueDateValue(nextValue) {
    if (!nextValue) return true;
    if (isDateAfterToday(nextValue)) {
      setError("Data de emissao nao pode ser superior a data atual.");
      const accepted = await showIssueDateAfterTodayAlert("payable");
      if (accepted) {
        focusPayableIssueDateField();
      }
      return false;
    }
    return true;
  }

  async function validateReceivableIssueDateValue(nextValue) {
    if (!nextValue) return true;
    if (isDateAfterToday(nextValue)) {
      setError("Data de emissao nao pode ser superior a data atual.");
      const accepted = await showIssueDateAfterTodayAlert("receivable");
      if (accepted) {
        focusReceivableIssueDateField();
      }
      return false;
    }
    return true;
  }

  async function validatePayableDueDateValue(nextValue, issueDateOverride) {
    if (!nextValue) return true;
    const issueDate = issueDateOverride || payableForm.issueDate || toDateInputSaoPaulo();
    if (isLiquidationDateBeforeIssueDate(nextValue, issueDate)) {
      setError("Data de vencimento nao pode ser inferior a data de emissao.");
      const accepted = await showDueDateBeforeIssueDateAlert("payable");
      if (accepted) {
        focusPayableDueDateField();
      }
      return false;
    }
    return true;
  }

  async function validateReceivableDueDateValue(nextValue, issueDateOverride) {
    if (!nextValue) return true;
    const issueDate = issueDateOverride || receivableForm.issueDate || toDateInputSaoPaulo();
    if (isLiquidationDateBeforeIssueDate(nextValue, issueDate)) {
      setError("Data de vencimento nao pode ser inferior a data de emissao.");
      const accepted = await showDueDateBeforeIssueDateAlert("receivable");
      if (accepted) {
        focusReceivableDueDateField();
      }
      return false;
    }
    return true;
  }

  async function validatePayablePaidOnValue(nextValue, issueDateOverride) {
    if (!nextValue) return true;
    const issueDate = issueDateOverride || payableForm.issueDate || toDateInputSaoPaulo();
    if (isDateAfterToday(nextValue)) {
      setError("Data de liquidacao nao pode ser superior a data atual.");
      const accepted = await showLiquidationDateAfterTodayAlert("payable");
      if (accepted) {
        focusPayablePaidOnField();
      }
      return false;
    }
    if (isLiquidationDateBeforeIssueDate(nextValue, issueDate)) {
      setError("Data de liquidacao nao pode ser inferior a data de emissao.");
      const accepted = await showInvalidLiquidationDateAlert("payable");
      if (accepted) {
        focusPayablePaidOnField();
      }
      return false;
    }
    return true;
  }

  async function validateReceivableReceivedOnValue(nextValue, issueDateOverride) {
    if (!nextValue) return true;
    const issueDate = issueDateOverride || receivableForm.issueDate || toDateInputSaoPaulo();
    if (isDateAfterToday(nextValue)) {
      setError("Data de liquidacao nao pode ser superior a data atual.");
      const accepted = await showLiquidationDateAfterTodayAlert("receivable");
      if (accepted) {
        focusReceivableReceivedOnField();
      }
      return false;
    }
    if (isLiquidationDateBeforeIssueDate(nextValue, issueDate)) {
      setError("Data de liquidacao nao pode ser inferior a data de emissao.");
      const accepted = await showInvalidLiquidationDateAlert("receivable");
      if (accepted) {
        focusReceivableReceivedOnField();
      }
      return false;
    }
    return true;
  }

  async function validatePayableIssueDateDependencies(nextIssueDate) {
    if (!nextIssueDate) return true;
    if (!(await validatePayableIssueDateValue(nextIssueDate))) {
      return false;
    }
    if (payableForm.dueDate && !(await validatePayableDueDateValue(payableForm.dueDate, nextIssueDate))) {
      return false;
    }
    if (
      payableForm.status === "paid" &&
      payableForm.paidOn &&
      !(await validatePayablePaidOnValue(payableForm.paidOn, nextIssueDate))
    ) {
      return false;
    }
    return true;
  }

  async function validateReceivableIssueDateDependencies(nextIssueDate) {
    if (!nextIssueDate) return true;
    if (!(await validateReceivableIssueDateValue(nextIssueDate))) {
      return false;
    }
    if (
      receivableForm.dueDate &&
      !(await validateReceivableDueDateValue(receivableForm.dueDate, nextIssueDate))
    ) {
      return false;
    }
    if (
      receivableForm.status === "received" &&
      receivableForm.receivedOn &&
      !(await validateReceivableReceivedOnValue(receivableForm.receivedOn, nextIssueDate))
    ) {
      return false;
    }
    return true;
  }

  async function handleSubmitPayable(event) {
    event.preventDefault();
    setSavingPayable(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        supplierId: Number(payableForm.supplierId),
        expenseTypeId: Number(payableForm.expenseTypeId),
        description: payableForm.description.trim(),
        amount: Number(payableForm.amount || 0),
        issueDate: payableForm.issueDate,
        dueDate: payableForm.dueDate,
        status: payableForm.status,
        paidOn: payableForm.status === "paid" ? payableForm.paidOn : null,
        notes: payableForm.notes.trim() || null
      };
      if (
        !payload.supplierId ||
        !payload.expenseTypeId ||
        !payload.description ||
        !payload.issueDate ||
        !payload.dueDate ||
        payload.amount <= 0
      ) {
        throw new Error("Preencha fornecedor, tipo de despesa, descricao, emissao, vencimento e valor.");
      }
      if (!(await validatePayableIssueDateValue(payload.issueDate))) return;
      if (!(await validatePayableDueDateValue(payload.dueDate))) return;
      if (payload.status === "paid" && !payload.paidOn) {
        throw new Error("Informe a data de pagamento quando o status estiver como pago.");
      }
      if (payload.status === "paid" && !(await validatePayablePaidOnValue(payload.paidOn))) return;

      if (!editingPayableId) {
        await api.request("/finance/accounts-payable", { method: "POST", token, body: payload });
      } else {
        await api.request(`/finance/accounts-payable/${editingPayableId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingPayableId ? "Conta a pagar atualizada." : "Conta a pagar criada.");
      resetPayableForm();
      await loadPayables();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingPayable(false);
    }
  }

  async function handleSubmitReceivable(event) {
    event.preventDefault();
    setSavingReceivable(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        clientId: Number(receivableForm.clientId),
        description: receivableForm.description.trim(),
        amount: Number(receivableForm.amount || 0),
        issueDate: receivableForm.issueDate,
        dueDate: receivableForm.dueDate,
        status: receivableForm.status,
        receivedOn: receivableForm.status === "received" ? receivableForm.receivedOn : null,
        notes: receivableForm.notes.trim() || null
      };
      if (!payload.clientId || !payload.description || !payload.issueDate || !payload.dueDate || payload.amount <= 0) {
        throw new Error("Preencha cliente, descricao, emissao, vencimento e valor.");
      }
      if (!(await validateReceivableIssueDateValue(payload.issueDate))) return;
      if (!(await validateReceivableDueDateValue(payload.dueDate))) return;
      if (payload.status === "received" && !payload.receivedOn) {
        throw new Error("Informe a data de recebimento quando o status estiver como recebido.");
      }
      if (payload.status === "received" && !(await validateReceivableReceivedOnValue(payload.receivedOn))) return;

      if (!editingReceivableId) {
        await api.request("/finance/accounts-receivable", { method: "POST", token, body: payload });
      } else {
        await api.request(`/finance/accounts-receivable/${editingReceivableId}`, {
          method: "PATCH",
          token,
          body: payload
        });
      }

      setSuccess(editingReceivableId ? "Conta a receber atualizada." : "Conta a receber criada.");
      resetReceivableForm();
      await loadReceivables();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingReceivable(false);
    }
  }

  async function handlePayableStatus(accountId, status, paidOnOverride = null) {
    setError("");
    setSuccess("");
    try {
      await api.request(`/finance/accounts-payable/${accountId}/status`, {
        method: "PATCH",
        token,
        body: {
          status,
          paidOn: status === "paid" ? (paidOnOverride || toDateInputSaoPaulo()) : null
        }
      });
      await loadPayables();
      setSuccess(status === "paid" ? "Conta a pagar marcada como paga." : "Conta a pagar reaberta.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleReceivableStatus(accountId, status, receivedOnOverride = null) {
    setError("");
    setSuccess("");
    try {
      await api.request(`/finance/accounts-receivable/${accountId}/status`, {
        method: "PATCH",
        token,
        body: {
          status,
          receivedOn: status === "received" ? (receivedOnOverride || toDateInputSaoPaulo()) : null
        }
      });
      await loadReceivables();
      setSuccess(status === "received" ? "Conta a receber marcada como recebida." : "Conta a receber reaberta.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function openReceivableStatusDialog(row) {
    const issueDate = resolveIssueDate(row.issue_date);
    const defaultReceivedOn = row.received_on || toDateInputSaoPaulo();
    const receivedOn = isLiquidationDateBeforeIssueDate(defaultReceivedOn, issueDate) ? issueDate : defaultReceivedOn;

    setReceivableStatusDialog({
      accountId: row.id,
      issueDate,
      receivedOn,
      clientName: row.client_name || "-",
      description: row.description || "-"
    });
  }

  function openPayableStatusDialog(row) {
    const issueDate = resolveIssueDate(row.issue_date);
    const defaultPaidOn = row.paid_on || toDateInputSaoPaulo();
    const paidOn = isLiquidationDateBeforeIssueDate(defaultPaidOn, issueDate) ? issueDate : defaultPaidOn;

    setPayableStatusDialog({
      accountId: row.id,
      issueDate,
      paidOn,
      supplierName: row.supplier_name || "-",
      description: row.description || "-"
    });
  }

  function closePayableStatusDialog() {
    if (updatingPayableStatus) return;
    setPayableStatusDialog(null);
  }

  function closeReceivableStatusDialog() {
    if (updatingReceivableStatus) return;
    setReceivableStatusDialog(null);
  }

  async function handleConfirmPayableStatusDialog(event) {
    event.preventDefault();
    if (!payableStatusDialog) return;

    const { accountId, issueDate, paidOn } = payableStatusDialog;
    if (!paidOn) {
      setError("Informe a data de pagamento.");
      return;
    }
    if (isDateAfterToday(paidOn)) {
      setError("Data de pagamento nao pode ser superior a data atual.");
      return;
    }
    if (isLiquidationDateBeforeIssueDate(paidOn, issueDate)) {
      setError("Data de pagamento nao pode ser inferior a data de emissao.");
      return;
    }

    setUpdatingPayableStatus(true);
    try {
      await handlePayableStatus(accountId, "paid", paidOn);
      setPayableStatusDialog(null);
    } finally {
      setUpdatingPayableStatus(false);
    }
  }

  async function handleConfirmReceivableStatusDialog(event) {
    event.preventDefault();
    if (!receivableStatusDialog) return;

    const { accountId, issueDate, receivedOn } = receivableStatusDialog;
    if (!receivedOn) {
      setError("Informe a data de recebimento.");
      return;
    }
    if (isDateAfterToday(receivedOn)) {
      setError("Data de recebimento nao pode ser superior a data atual.");
      return;
    }
    if (isLiquidationDateBeforeIssueDate(receivedOn, issueDate)) {
      setError("Data de recebimento nao pode ser inferior a data de emissao.");
      return;
    }

    setUpdatingReceivableStatus(true);
    try {
      await handleReceivableStatus(accountId, "received", receivedOn);
      setReceivableStatusDialog(null);
    } finally {
      setUpdatingReceivableStatus(false);
    }
  }

  async function handleApplyPayableFilters(event) {
    event.preventDefault();
    setError("");
    await loadPayables(payableFilters);
  }

  async function handleClearPayableFilters() {
    const cleared = {
      status: "",
      dateFrom: "",
      dateTo: ""
    };
    setPayableFilters(cleared);
    setError("");
    await loadPayables(cleared);
  }

  async function handleApplyReceivableFilters(event) {
    event.preventDefault();
    setError("");
    await loadReceivables(receivableFilters);
  }

  async function handleClearReceivableFilters() {
    const cleared = {
      status: "",
      dateFrom: "",
      dateTo: ""
    };
    setReceivableFilters(cleared);
    setError("");
    await loadReceivables(cleared);
  }

  const headingTitle = isPayableOnly
    ? "Contas a Pagar"
    : isReceivableOnly
      ? "Contas a Receber"
      : "Financeiro";
  const headingDescription = isPayableOnly
    ? "Controle e liquidacao das contas a pagar."
    : isReceivableOnly
      ? "Controle e recebimento das contas a receber."
      : "Contas a pagar e contas a receber com vinculo aos cadastros.";

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>{headingTitle}</h1>
          <p>{headingDescription}</p>
          <div className="table-actions">
            <Link className={`button ${payableMenuActive ? "button-primary" : "button-outline"}`} to="/financeiro/contas-pagar">
              Contas a Pagar
            </Link>
            <Link className={`button ${receivableMenuActive ? "button-primary" : "button-outline"}`} to="/financeiro/contas-receber">
              Contas a Receber
            </Link>
            <Link className="button button-outline" to="/painel-diretoria">
              Painel Diretoria
            </Link>
          </div>
        </div>

        {loading ? <p>Carregando modulo financeiro...</p> : null}
        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        {showPayables ? (
        <section className="panel">
          <div className="registry-panel-header" ref={payablePanelHeaderRef}>
            <h2>Contas a Pagar</h2>
          </div>
          <form className="form" onSubmit={handleSubmitPayable}>
            <div className="grid-3">
              <label>
                Fornecedor
                <select
                  value={payableForm.supplierId}
                  onChange={(event) => setPayableForm((current) => ({ ...current, supplierId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de despesa
                <select value={payableForm.expenseTypeId} onChange={(event) => setPayableForm((current) => ({ ...current, expenseTypeId: event.target.value }))}>
                  <option value="">Selecione</option>
                  {expenseTypes.map((expenseType) => (
                    <option key={expenseType.id} value={expenseType.id}>{expenseType.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Valor (R$)
                <CurrencyInput min={0} value={payableForm.amount} onValueChange={(value) => setPayableForm((current) => ({ ...current, amount: value }))} />
              </label>
            </div>
            <div className="grid-3">
              <label>
                Data de emissao
                <input
                  ref={payableIssueDateInputRef}
                  type="date"
                  max={toDateInputSaoPaulo()}
                  value={payableForm.issueDate}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPayableForm((current) => ({ ...current, issueDate: nextValue }));
                  }}
                  onBlur={(event) => {
                    void validatePayableIssueDateDependencies(event.target.value);
                  }}
                  onKeyDown={(event) => handleDateFieldKeyDown(event, validatePayableIssueDateDependencies)}
                />
              </label>
              <label>
                Vencimento
                <input
                  ref={payableDueDateInputRef}
                  type="date"
                  min={payableForm.issueDate || undefined}
                  value={payableForm.dueDate}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPayableForm((current) => ({ ...current, dueDate: nextValue }));
                  }}
                  onBlur={(event) => {
                    void validatePayableDueDateValue(event.target.value);
                  }}
                  onKeyDown={(event) => handleDateFieldKeyDown(event, validatePayableDueDateValue)}
                />
              </label>
              <label>
                Status
                <select value={payableForm.status} onChange={(event) => handlePayableFormStatusChange(event.target.value)}>
                  {PAYABLE_STATUS_OPTIONS.map((statusOption) => (
                    <option key={statusOption.value} value={statusOption.value}>{statusOption.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Pago em
                <input
                  ref={payablePaidOnInputRef}
                  type="date"
                  disabled={payableForm.status !== "paid"}
                  required={payableForm.status === "paid"}
                  min={payableForm.issueDate || undefined}
                  max={toDateInputSaoPaulo()}
                  value={payableForm.paidOn}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPayableForm((current) => ({ ...current, paidOn: nextValue }));
                  }}
                  onBlur={(event) => {
                    void validatePayablePaidOnValue(event.target.value);
                  }}
                  onKeyDown={(event) => handleDateFieldKeyDown(event, validatePayablePaidOnValue)}
                />
              </label>
            </div>
              <label>
                DescriÃ§Ã£o
                <input type="text" value={payableForm.description} onChange={(event) => setPayableForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                ObservaÃ§Ãµes
                <textarea rows={2} value={payableForm.notes} onChange={(event) => setPayableForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
            <div className="table-actions">
              <button className="button button-primary" disabled={savingPayable} type="submit">{savingPayable ? "Salvando..." : editingPayableId ? "Atualizar" : "Criar"}</button>
              {editingPayableId ? <button className="button button-outline" type="button" onClick={resetPayableForm}>Cancelar</button> : null}
            </div>
          </form>

          <form className="form inline-form" onSubmit={handleApplyPayableFilters}>
            <div className="grid-3">
              <label>
                Status
                <select
                  value={payableFilters.status}
                  onChange={(event) =>
                    setPayableFilters((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="pending">Pendente</option>
                  <option value="overdue">Vencido</option>
                  <option value="paid">Pago</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </label>
              <label>
                Data inicial
                <input
                  type="date"
                  value={payableFilters.dateFrom}
                  onChange={(event) =>
                    setPayableFilters((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  value={payableFilters.dateTo}
                  onChange={(event) =>
                    setPayableFilters((current) => ({ ...current, dateTo: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="table-actions">
              <button className="button button-primary" type="submit">
                Aplicar filtros
              </button>
              <button className="button button-outline" type="button" onClick={handleClearPayableFilters}>
                Limpar
              </button>
            </div>
          </form>

          <div className="table-wrapper registry-table">
            <table>
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Fornecedor</th>
                  <th>Tipo</th>
                  <th>DescriÃ§Ã£o</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>AÃ§Ã£o</th>
                </tr>
              </thead>
              <tbody>
                {payables.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateShort(row.due_date)}</td>
                    <td>{row.supplier_name}</td>
                    <td>{row.expense_type_name}</td>
                    <td>{row.description}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td><StatusPill status={row.computed_status || row.status} /></td>
                    <td>
                      <div className="table-actions">
                        <button className="button button-outline small" type="button" onClick={() => {
                          const issueDate = resolveIssueDate(row.issue_date);
                          const nextForm = {
                            supplierId: String(row.supplier_id || ""),
                            expenseTypeId: String(row.expense_type_id || ""),
                            description: row.description || "",
                            amount: Number(row.amount || 0),
                            dueDate: row.due_date || "",
                            issueDate,
                            status: row.status || "pending",
                            paidOn:
                              row.status === "paid"
                                ? (() => {
                                    const nextPaidOn = row.paid_on || toDateInputSaoPaulo();
                                    return isLiquidationDateBeforeIssueDate(nextPaidOn, issueDate)
                                      ? issueDate
                                      : nextPaidOn;
                                  })()
                                : "",
                            notes: row.notes || ""
                          };
                          setEditingPayableId(row.id);
                          setPayableForm(nextForm);
                          snapshotPayableOriginal(nextForm, row.id);
                          scrollToPayableEditStart();
                        }}>Editar</button>
                        {row.status !== "paid" ? <button className="button button-outline small" type="button" onClick={() => openPayableStatusDialog(row)}>Marcar pago</button> : <button className="button button-outline small" type="button" onClick={() => handlePayableStatus(row.id, "pending")}>Reabrir</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        {showReceivables ? (
        <section className="panel">
          <div className="registry-panel-header" ref={receivablePanelHeaderRef}>
            <h2>Contas a Receber</h2>
          </div>
          <form className="form" onSubmit={handleSubmitReceivable}>
            <div className="grid-3">
              <label>
                Cliente
                <select
                  value={receivableForm.clientId}
                  onChange={(event) => setReceivableForm((current) => ({ ...current, clientId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Valor (R$)
                <CurrencyInput min={0} value={receivableForm.amount} onValueChange={(value) => setReceivableForm((current) => ({ ...current, amount: value }))} />
              </label>
              <label>
                Data de emissao
                <input
                  ref={receivableIssueDateInputRef}
                  type="date"
                  max={toDateInputSaoPaulo()}
                  value={receivableForm.issueDate}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setReceivableForm((current) => ({ ...current, issueDate: nextValue }));
                  }}
                  onBlur={(event) => {
                    void validateReceivableIssueDateDependencies(event.target.value);
                  }}
                  onKeyDown={(event) => handleDateFieldKeyDown(event, validateReceivableIssueDateDependencies)}
                />
              </label>
              <label>
                Vencimento
                <input
                  ref={receivableDueDateInputRef}
                  type="date"
                  min={receivableForm.issueDate || undefined}
                  value={receivableForm.dueDate}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setReceivableForm((current) => ({ ...current, dueDate: nextValue }));
                  }}
                  onBlur={(event) => {
                    void validateReceivableDueDateValue(event.target.value);
                  }}
                  onKeyDown={(event) => handleDateFieldKeyDown(event, validateReceivableDueDateValue)}
                />
              </label>
            </div>
            <div className="grid-3">
              <label>
                Status
                <select value={receivableForm.status} onChange={(event) => handleReceivableFormStatusChange(event.target.value)}>
                  {RECEIVABLE_STATUS_OPTIONS.map((statusOption) => (
                    <option key={statusOption.value} value={statusOption.value}>{statusOption.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Recebido em
                <input
                  ref={receivableReceivedOnInputRef}
                  type="date"
                  disabled={receivableForm.status !== "received"}
                  required={receivableForm.status === "received"}
                  min={receivableForm.issueDate || undefined}
                  max={toDateInputSaoPaulo()}
                  value={receivableForm.receivedOn}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setReceivableForm((current) => ({ ...current, receivedOn: nextValue }));
                  }}
                  onBlur={(event) => {
                    void validateReceivableReceivedOnValue(event.target.value);
                  }}
                  onKeyDown={(event) => handleDateFieldKeyDown(event, validateReceivableReceivedOnValue)}
                />
              </label>
              <label>
                DescriÃ§Ã£o
                <input type="text" value={receivableForm.description} onChange={(event) => setReceivableForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
            </div>
            <label>
              ObservaÃ§Ãµes
              <textarea rows={2} value={receivableForm.notes} onChange={(event) => setReceivableForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="table-actions">
              <button className="button button-primary" disabled={savingReceivable} type="submit">{savingReceivable ? "Salvando..." : editingReceivableId ? "Atualizar" : "Criar"}</button>
              {editingReceivableId ? <button className="button button-outline" type="button" onClick={resetReceivableForm}>Cancelar</button> : null}
            </div>
          </form>

          <form className="form inline-form" onSubmit={handleApplyReceivableFilters}>
            <div className="grid-3">
              <label>
                Status
                <select
                  value={receivableFilters.status}
                  onChange={(event) =>
                    setReceivableFilters((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="pending">Pendente</option>
                  <option value="overdue">Vencido</option>
                  <option value="received">Recebido</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </label>
              <label>
                Data inicial
                <input
                  type="date"
                  value={receivableFilters.dateFrom}
                  onChange={(event) =>
                    setReceivableFilters((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  value={receivableFilters.dateTo}
                  onChange={(event) =>
                    setReceivableFilters((current) => ({ ...current, dateTo: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="table-actions">
              <button className="button button-primary" type="submit">
                Aplicar filtros
              </button>
              <button className="button button-outline" type="button" onClick={handleClearReceivableFilters}>
                Limpar
              </button>
            </div>
          </form>

          <div className="table-wrapper registry-table">
            <table>
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Cliente</th>
                  <th>DescriÃ§Ã£o</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>AÃ§Ã£o</th>
                </tr>
              </thead>
              <tbody>
                {receivables.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateShort(row.due_date)}</td>
                    <td>{row.client_name}</td>
                    <td>{row.description}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td><StatusPill status={row.computed_status || row.status} /></td>
                    <td>
                      <div className="table-actions">
                        <button className="button button-outline small" type="button" onClick={() => {
                          const issueDate = resolveIssueDate(row.issue_date);
                          const nextForm = {
                            clientId: String(row.client_id || ""),
                            description: row.description || "",
                            amount: Number(row.amount || 0),
                            dueDate: row.due_date || "",
                            issueDate,
                            status: row.status || "pending",
                            receivedOn:
                              row.status === "received"
                                ? (() => {
                                    const nextReceivedOn = row.received_on || toDateInputSaoPaulo();
                                    return isLiquidationDateBeforeIssueDate(nextReceivedOn, issueDate)
                                      ? issueDate
                                      : nextReceivedOn;
                                  })()
                                : "",
                            notes: row.notes || ""
                          };
                          setEditingReceivableId(row.id);
                          setReceivableForm(nextForm);
                          snapshotReceivableOriginal(nextForm, row.id);
                          scrollToReceivableEditStart();
                        }}>Editar</button>
                        {row.status !== "received" ? <button className="button button-outline small" type="button" onClick={() => openReceivableStatusDialog(row)}>Marcar recebido</button> : <button className="button button-outline small" type="button" onClick={() => handleReceivableStatus(row.id, "pending")}>Reabrir</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        {payableStatusDialog ? (
          <div className="dialog-backdrop" role="dialog" aria-modal="true">
            <form className="dialog-card" onSubmit={handleConfirmPayableStatusDialog}>
              <header className="dialog-header">
                <h3>Marcar como pago</h3>
              </header>
              <div className="dialog-body">
                <p>
                  Informe a data de pagamento para o fornecedor {payableStatusDialog.supplierName}.
                </p>
                <p>
                  Lancamento: {payableStatusDialog.description}
                </p>
                <label>
                  Data de pagamento
                  <input
                    max={toDateInputSaoPaulo()}
                    min={payableStatusDialog.issueDate || undefined}
                    onChange={(event) =>
                      setPayableStatusDialog((current) => (
                        current
                          ? { ...current, paidOn: event.target.value }
                          : current
                      ))
                    }
                    required
                    type="date"
                    value={payableStatusDialog.paidOn}
                  />
                </label>
              </div>
              <footer className="dialog-actions">
                <button
                  className="button button-outline"
                  onClick={closePayableStatusDialog}
                  type="button"
                >
                  Cancelar
                </button>
                <button className="button button-primary" disabled={updatingPayableStatus} type="submit">
                  {updatingPayableStatus ? "Salvando..." : "Confirmar pagamento"}
                </button>
              </footer>
            </form>
          </div>
        ) : null}

        {receivableStatusDialog ? (
          <div className="dialog-backdrop" role="dialog" aria-modal="true">
            <form className="dialog-card" onSubmit={handleConfirmReceivableStatusDialog}>
              <header className="dialog-header">
                <h3>Marcar como recebido</h3>
              </header>
              <div className="dialog-body">
                <p>
                  Informe a data de recebimento para o cliente {receivableStatusDialog.clientName}.
                </p>
                <p>
                  Lancamento: {receivableStatusDialog.description}
                </p>
                <label>
                  Data de recebimento
                  <input
                    max={toDateInputSaoPaulo()}
                    min={receivableStatusDialog.issueDate || undefined}
                    onChange={(event) =>
                      setReceivableStatusDialog((current) => (
                        current
                          ? { ...current, receivedOn: event.target.value }
                          : current
                      ))
                    }
                    required
                    type="date"
                    value={receivableStatusDialog.receivedOn}
                  />
                </label>
              </div>
              <footer className="dialog-actions">
                <button
                  className="button button-outline"
                  onClick={closeReceivableStatusDialog}
                  type="button"
                >
                  Cancelar
                </button>
                <button className="button button-primary" disabled={updatingReceivableStatus} type="submit">
                  {updatingReceivableStatus ? "Salvando..." : "Confirmar recebimento"}
                </button>
              </footer>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}

