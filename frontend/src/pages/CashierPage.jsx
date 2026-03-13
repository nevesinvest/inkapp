import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { formatCurrency, formatDateTime } from "../utils/format";
import { toDateInputSaoPaulo } from "../utils/timezone";

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Dinheiro" },
  { value: "credit_card", label: "Cartao de Credito" },
  { value: "debit_card", label: "Cartao de Debito" },
  { value: "pix", label: "Pix" }
];
const CASHIER_TABS = [
  { id: "operations", label: "Operacoes" },
  { id: "sales", label: "Fechar Venda" },
  { id: "status", label: "Status dos Caixas" },
  { id: "sessions", label: "Historico de Sessoes" },
  { id: "movements", label: "Movimentacoes" }
];

function createCloseTransfersState() {
  return {
    cash: { destinationBankId: "", amount: 0, description: "" },
    credit_card: { destinationBankId: "", amount: 0, description: "" },
    debit_card: { destinationBankId: "", amount: 0, description: "" },
    pix: { destinationBankId: "", amount: 0, description: "" }
  };
}

function sessionStatusLabel(status) {
  return status === "open" ? "ABERTO" : "FECHADO";
}

function sessionStatusClassName(status) {
  return status === "open" ? "cashier-status cashier-status-open" : "cashier-status cashier-status-closed";
}

function movementTypeLabel(value) {
  return value === "entry" ? "Entrada" : value === "exit" ? "Saida" : value || "-";
}

function movementTypeClassName(value) {
  return value === "entry"
    ? "stock-movement stock-movement-entry"
    : value === "exit"
      ? "stock-movement stock-movement-exit"
      : "stock-movement";
}

function movementOriginLabel(value) {
  if (value === "sale_close") return "Fechar venda";
  if (value === "transfer_out") return "Transferencia";
  if (value === "transfer_in") return "Transferencia recebida";
  return "Manual";
}

function paymentMethodLabel(value) {
  return PAYMENT_METHOD_OPTIONS.find((item) => item.value === value)?.label || value || "-";
}

function bankLabel(bank) {
  if (!bank) return "";
  return `${bank.bank_name} - ${bank.account_name}`;
}

function formatOrderNumber(order) {
  if (order?.order_number) return order.order_number;
  return String(Number(order?.id || 0)).padStart(6, "0");
}

function normalizeOrderNumberInput(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, 12);
}

function tabsButtonClass(active) {
  return `button button-outline small ${active ? "active" : ""}`;
}

export function CashierPage() {
  const { token } = useAuth();
  const { showConfirm } = useDialog();

  const today = useMemo(() => toDateInputSaoPaulo(new Date()), []);
  const [activeTab, setActiveTab] = useState("operations");

  const [overviewRows, setOverviewRows] = useState([]);
  const [sessionRows, setSessionRows] = useState([]);
  const [movementRows, setMovementRows] = useState([]);
  const [pendingSalesRows, setPendingSalesRows] = useState([]);
  const [bankRows, setBankRows] = useState([]);

  const [openForm, setOpenForm] = useState({
    bankId: "",
    openingBalance: 0,
    notes: ""
  });
  const [transferForm, setTransferForm] = useState({
    bankId: "",
    destinationBankId: "",
    paymentMethod: "cash",
    amount: 0,
    description: ""
  });
  const [closeForm, setCloseForm] = useState({
    bankId: "",
    notes: ""
  });

  const [saleCloseFilters, setSaleCloseFilters] = useState({
    bankId: "",
    dateFrom: today,
    dateTo: today
  });
  const [saleCloseOrderNumber, setSaleCloseOrderNumber] = useState("");

  const [closeTransfers, setCloseTransfers] = useState(createCloseTransfersState);

  const [movementFilters, setMovementFilters] = useState({
    bankId: "",
    paymentMethod: "",
    dateFrom: "",
    dateTo: ""
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closingSaleId, setClosingSaleId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const overviewById = useMemo(() => {
    const map = new Map();
    overviewRows.forEach((row) => map.set(String(row.id), row));
    return map;
  }, [overviewRows]);

  const openBanks = useMemo(
    () => overviewRows.filter((row) => row.session_status === "open"),
    [overviewRows]
  );

  const availableDestinationBanks = useMemo(
    () => bankRows.filter((bank) => Number(bank.active) === 1),
    [bankRows]
  );

  const selectedOpenBank = overviewById.get(String(openForm.bankId));
  const selectedTransferBank = overviewById.get(String(transferForm.bankId));
  const selectedCloseBank = overviewById.get(String(closeForm.bankId));

  const selectedTransferMethodBalance =
    Number(selectedTransferBank?.open_session?.payment_balances?.[transferForm.paymentMethod]?.balance || 0);

  const selectedClosePaymentBalances = selectedCloseBank?.open_session?.payment_balances || null;

  async function loadOverview() {
    const rows = await api.request("/cashier/overview", { token });
    setOverviewRows(rows);
  }

  async function loadSessions() {
    const rows = await api.request("/cashier/sessions?limit=80", { token });
    setSessionRows(rows);
  }

  async function loadMovements(filters = movementFilters) {
    const params = new URLSearchParams();
    if (filters.bankId) params.set("bankId", String(filters.bankId));
    if (filters.paymentMethod) params.set("paymentMethod", String(filters.paymentMethod));
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("limit", "600");
    const query = params.toString();
    const rows = await api.request(`/cashier/movements${query ? `?${query}` : ""}`, { token });
    setMovementRows(rows);
  }

  async function loadPendingSales(filters = saleCloseFilters) {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("limit", "600");
    const query = params.toString();
    const rows = await api.request(`/cashier/sales/pending${query ? `?${query}` : ""}`, { token });
    setPendingSalesRows(rows);
  }

  async function loadBanks() {
    const rows = await api.request("/registry/banks", { token });
    setBankRows(rows);
  }

  async function loadAll(options = {}) {
    if (!token) return;
    const movementFilterPayload = options.movementFilters || movementFilters;
    const saleCloseFilterPayload = options.saleCloseFilters || saleCloseFilters;

    setLoading(true);
    setError("");
    try {
      await Promise.all([
        loadOverview(),
        loadSessions(),
        loadMovements(movementFilterPayload),
        loadPendingSales(saleCloseFilterPayload),
        loadBanks()
      ]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [token]);

  useEffect(() => {
    if (overviewRows.length === 0) {
      setOpenForm((current) => ({ ...current, bankId: "", openingBalance: 0 }));
      setTransferForm((current) => ({ ...current, bankId: "" }));
      setCloseForm((current) => ({ ...current, bankId: "" }));
      setSaleCloseFilters((current) => ({ ...current, bankId: "" }));
      return;
    }

    setOpenForm((current) => {
      const selected = overviewById.get(String(current.bankId));
      if (selected) return current;
      const fallback = overviewRows[0];
      return {
        ...current,
        bankId: String(fallback.id),
        openingBalance: Number(fallback.current_balance || 0)
      };
    });

    setTransferForm((current) => {
      const stillOpen = openBanks.some((bank) => String(bank.id) === String(current.bankId));
      if (stillOpen) return current;
      const fallback = openBanks[0];
      return {
        ...current,
        bankId: fallback ? String(fallback.id) : "",
        destinationBankId: ""
      };
    });

    setCloseForm((current) => {
      const stillOpen = openBanks.some((bank) => String(bank.id) === String(current.bankId));
      if (stillOpen) return current;
      const fallback = openBanks[0];
      return {
        ...current,
        bankId: fallback ? String(fallback.id) : ""
      };
    });

    setSaleCloseFilters((current) => {
      const stillOpen = openBanks.some((bank) => String(bank.id) === String(current.bankId));
      if (stillOpen) return current;
      const fallback = openBanks[0];
      return {
        ...current,
        bankId: fallback ? String(fallback.id) : ""
      };
    });
  }, [overviewRows, overviewById, openBanks]);

  useEffect(() => {
    const selectedBank = overviewById.get(String(closeForm.bankId));
    const balances = selectedBank?.open_session?.payment_balances;

    setCloseTransfers(() => ({
      cash: {
        destinationBankId: "",
        amount: Number(balances?.cash?.balance || 0),
        description: ""
      },
      credit_card: {
        destinationBankId: "",
        amount: Number(balances?.credit_card?.balance || 0),
        description: ""
      },
      debit_card: {
        destinationBankId: "",
        amount: Number(balances?.debit_card?.balance || 0),
        description: ""
      },
      pix: {
        destinationBankId: "",
        amount: Number(balances?.pix?.balance || 0),
        description: ""
      }
    }));
  }, [closeForm.bankId, overviewById]);

  function updateOpenField(field, value) {
    setOpenForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "bankId") {
        const bank = overviewById.get(String(value));
        if (bank) {
          next.openingBalance = Number(bank.current_balance || 0);
        }
      }
      return next;
    });
  }

  function updateTransferField(field, value) {
    setTransferForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "bankId" ? { destinationBankId: "" } : {})
    }));
  }

  function updateCloseField(field, value) {
    setCloseForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateSaleCloseFilter(field, value) {
    setSaleCloseFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateMovementFilter(field, value) {
    setMovementFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateCloseTransfer(paymentMethod, field, value) {
    setCloseTransfers((current) => ({
      ...current,
      [paymentMethod]: {
        ...current[paymentMethod],
        [field]: value
      }
    }));
  }

  async function handleOpenCash(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const bankId = Number(openForm.bankId);
      if (!bankId) {
        throw new Error("Selecione o caixa para abrir.");
      }

      const openingBalance = Number(openForm.openingBalance);
      if (!Number.isFinite(openingBalance) || openingBalance < 0) {
        throw new Error("Informe saldo de abertura valido.");
      }

      const response = await api.request("/cashier/open", {
        method: "POST",
        token,
        body: {
          bankId,
          openingBalance,
          notes: String(openForm.notes || "").trim() || null
        }
      });

      setSuccess(
        `Caixa aberto com sucesso. Saldo inicial: ${formatCurrency(response.opening_balance)}.`
      );
      setOpenForm((current) => ({ ...current, notes: "" }));
      await loadAll();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTransferCash(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const bankId = Number(transferForm.bankId);
      if (!bankId) {
        throw new Error("Selecione o caixa de origem.");
      }

      const destinationBankId = Number(transferForm.destinationBankId);
      if (!destinationBankId) {
        throw new Error("Selecione o banco de destino.");
      }

      if (destinationBankId === bankId) {
        throw new Error("Banco de destino deve ser diferente do caixa de origem.");
      }

      const amount = Number(transferForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Informe valor valido para transferencia.");
      }

      const paymentMethod = transferForm.paymentMethod;
      if (!PAYMENT_METHOD_OPTIONS.some((option) => option.value === paymentMethod)) {
        throw new Error("Forma de pagamento invalida.");
      }

      if (amount > selectedTransferMethodBalance) {
        throw new Error(
          `Valor maior que o saldo em ${paymentMethodLabel(paymentMethod)} (${formatCurrency(
            selectedTransferMethodBalance
          )}).`
        );
      }

      const response = await api.request("/cashier/transfer", {
        method: "POST",
        token,
        body: {
          bankId,
          destinationBankId,
          paymentMethod,
          amount,
          description: String(transferForm.description || "").trim() || null
        }
      });

      setSuccess(
        `Transferencia registrada. Saldo atual do caixa: ${formatCurrency(response.session.current_balance)}.`
      );
      setTransferForm((current) => ({
        ...current,
        amount: 0,
        description: ""
      }));
      await loadAll();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyPendingSalesFilters(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await loadPendingSales(saleCloseFilters);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCloseSale(order) {
    if (saving || closingSaleId) return;

    const bankId = Number(saleCloseFilters.bankId);
    if (!bankId) {
      setError("Selecione um caixa aberto para fechar a venda.");
      return;
    }

    const confirmed = await showConfirm({
      title: "Fechar venda",
      message: `Deseja fechar o pedido ${formatOrderNumber(order)} no caixa selecionado?`,
      confirmLabel: "Fechar venda",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setClosingSaleId(order.id);

    try {
      await api.request(`/cashier/sales/${order.id}/close`, {
        method: "POST",
        token,
        body: {
          bankId
        }
      });

      setSuccess(`Pedido ${formatOrderNumber(order)} fechado no caixa com sucesso.`);
      await loadAll();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setClosingSaleId(null);
    }
  }

  async function handleCloseSaleByNumber(event) {
    event.preventDefault();
    if (saving || closingSaleId) return;

    const bankId = Number(saleCloseFilters.bankId);
    if (!bankId) {
      setError("Selecione um caixa aberto para fechar a venda.");
      return;
    }

    const orderNumber = normalizeOrderNumberInput(saleCloseOrderNumber);
    if (!orderNumber) {
      setError("Informe o numero do pedido para fechamento.");
      return;
    }

    const confirmed = await showConfirm({
      title: "Fechar venda por numero",
      message: `Deseja fechar o pedido ${orderNumber} no caixa selecionado?`,
      confirmLabel: "Fechar venda",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const response = await api.request("/cashier/sales/close-by-number", {
        method: "POST",
        token,
        body: {
          bankId,
          orderNumber
        }
      });

      const closedOrderNumber = formatOrderNumber(response?.order || { order_number: orderNumber });
      setSuccess(`Pedido ${closedOrderNumber} fechado no caixa com sucesso.`);
      setSaleCloseOrderNumber("");
      await loadAll();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseCash(event) {
    event.preventDefault();
    if (saving) return;

    const bankId = Number(closeForm.bankId);
    if (!bankId) {
      setError("Selecione o caixa para fechar.");
      return;
    }

    if (!selectedClosePaymentBalances) {
      setError("Nao ha sessao aberta para o caixa selecionado.");
      return;
    }

    const transfers = [];
    const methodValues = ["cash", "credit_card", "debit_card", "pix"];

    for (const method of methodValues) {
      const methodBalance = Number(selectedClosePaymentBalances?.[method]?.balance || 0);
      const payload = closeTransfers[method] || { destinationBankId: "", amount: 0, description: "" };
      const destinationBankId = Number(payload.destinationBankId || 0);

      if (method === "cash") {
        const amount = Number(payload.amount || 0);
        if (amount < 0) {
          setError("Transferencia em Dinheiro nao pode ser negativa.");
          return;
        }
        if (amount > methodBalance) {
          setError(`Transferencia em Dinheiro maior que o saldo (${formatCurrency(methodBalance)}).`);
          return;
        }
        if (amount > 0) {
          if (!destinationBankId) {
            setError("Informe o banco de destino para transferencia em Dinheiro.");
            return;
          }
          transfers.push({
            paymentMethod: method,
            destinationBankId,
            amount,
            description: String(payload.description || "").trim() || null
          });
        }
        continue;
      }

      if (methodBalance > 0) {
        if (!destinationBankId) {
          setError(`Informe o banco de destino para ${paymentMethodLabel(method)}.`);
          return;
        }
        transfers.push({
          paymentMethod: method,
          destinationBankId,
          amount: methodBalance,
          description: String(payload.description || "").trim() || null
        });
      }
    }

    const predictedBalance = Number(selectedCloseBank?.open_session?.current_balance || 0) -
      transfers.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const confirmed = await showConfirm({
      title: "Fechar caixa",
      message: `Deseja fechar este caixa? Saldo previsto apos transferencias: ${formatCurrency(predictedBalance)}.`,
      confirmLabel: "Fechar caixa",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await api.request("/cashier/close", {
        method: "POST",
        token,
        body: {
          bankId,
          notes: String(closeForm.notes || "").trim() || null,
          transfers
        }
      });

      setSuccess(`Caixa fechado com sucesso. Saldo final: ${formatCurrency(response.closing_balance)}.`);
      setCloseForm((current) => ({ ...current, notes: "" }));
      await loadAll();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyMovementFilters(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await loadMovements(movementFilters);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearMovementFilters() {
    const cleared = {
      bankId: "",
      paymentMethod: "",
      dateFrom: "",
      dateTo: ""
    };
    setMovementFilters(cleared);
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await loadMovements(cleared);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Caixa Diario</h1>
          <p>Controle diario de abertura, fechamento de venda, transferencias e fechamento por caixa.</p>
        </div>

        {overviewRows.length === 0 && !loading ? (
          <FeedbackMessage
            message='Nenhum banco do tipo "Caixa" foi encontrado. Cadastre em Cadastros > Bancos.'
            type="warning"
          />
        ) : null}
        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <div className="registry-tabs">
          {CASHIER_TABS.map((tab) => (
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

        <div className="cashier-layout">
          {activeTab === "operations" ? (
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Operacoes do Caixa</h2>
            </div>

            <div className="cashier-ops-grid">
              <form className="form" onSubmit={handleOpenCash}>
                <h3>Abrir Caixa</h3>
                <label>
                  Caixa
                  <select
                    onChange={(event) => updateOpenField("bankId", event.target.value)}
                    value={openForm.bankId}
                  >
                    <option value="">Selecione</option>
                    {overviewRows.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bankLabel(bank)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Saldo de abertura (R$)
                  <CurrencyInput
                    min={0}
                    onValueChange={(value) => updateOpenField("openingBalance", value)}
                    value={openForm.openingBalance}
                  />
                </label>
                <label>
                  Observacoes
                  <textarea
                    onChange={(event) => updateOpenField("notes", event.target.value)}
                    rows={2}
                    value={openForm.notes}
                  />
                </label>
                {selectedOpenBank ? (
                  <p className="muted">
                    Saldo atual do banco: <strong>{formatCurrency(selectedOpenBank.current_balance)}</strong>
                  </p>
                ) : null}
                <button className="button button-primary" disabled={saving} type="submit">
                  Abrir caixa
                </button>
              </form>

              <form className="form" onSubmit={handleTransferCash}>
                <h3>Transferir Valores</h3>
                <label>
                  Caixa de origem (aberto)
                  <select
                    onChange={(event) => updateTransferField("bankId", event.target.value)}
                    value={transferForm.bankId}
                  >
                    <option value="">Selecione</option>
                    {openBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bankLabel(bank)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Forma de pagamento
                  <select
                    onChange={(event) => updateTransferField("paymentMethod", event.target.value)}
                    value={transferForm.paymentMethod}
                  >
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Banco de destino
                  <select
                    onChange={(event) => updateTransferField("destinationBankId", event.target.value)}
                    value={transferForm.destinationBankId}
                  >
                    <option value="">Selecione</option>
                    {availableDestinationBanks
                      .filter((bank) => String(bank.id) !== String(transferForm.bankId))
                      .map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bankLabel(bank)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Valor (R$)
                  <CurrencyInput
                    min={0}
                    onValueChange={(value) => updateTransferField("amount", value)}
                    value={transferForm.amount}
                  />
                </label>
                <label>
                  Historico
                  <input
                    onChange={(event) => updateTransferField("description", event.target.value)}
                    placeholder="Ex: deposito, transferencia para banco"
                    type="text"
                    value={transferForm.description}
                  />
                </label>
                {selectedTransferBank?.open_session ? (
                  <p className="muted">
                    Saldo em {paymentMethodLabel(transferForm.paymentMethod)}: <strong>{formatCurrency(selectedTransferMethodBalance)}</strong>
                  </p>
                ) : (
                  <p className="muted">Nao ha caixa aberto para movimentar.</p>
                )}
                <button className="button button-primary" disabled={saving || openBanks.length === 0} type="submit">
                  Transferir valor
                </button>
              </form>

              <form className="form" onSubmit={handleCloseCash}>
                <h3>Fechar Caixa</h3>
                <label>
                  Caixa (somente aberto)
                  <select
                    onChange={(event) => updateCloseField("bankId", event.target.value)}
                    value={closeForm.bankId}
                  >
                    <option value="">Selecione</option>
                    {openBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bankLabel(bank)}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedClosePaymentBalances ? (
                  <div className="table-wrapper registry-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Forma</th>
                          <th>Saldo</th>
                          <th>Banco destino</th>
                          <th>Valor transferir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PAYMENT_METHOD_OPTIONS.map((option) => {
                          const method = option.value;
                          const balance = Number(selectedClosePaymentBalances?.[method]?.balance || 0);
                          const formState = closeTransfers[method] || {
                            destinationBankId: "",
                            amount: 0,
                            description: ""
                          };
                          const readOnlyAmount = method !== "cash";

                          return (
                            <tr key={method}>
                              <td>{option.label}</td>
                              <td>{formatCurrency(balance)}</td>
                              <td>
                                <select
                                  onChange={(event) => updateCloseTransfer(method, "destinationBankId", event.target.value)}
                                  value={formState.destinationBankId}
                                  disabled={balance <= 0}
                                >
                                  <option value="">Selecione</option>
                                  {availableDestinationBanks
                                    .filter((bank) => String(bank.id) !== String(closeForm.bankId))
                                    .map((bank) => (
                                      <option key={bank.id} value={bank.id}>
                                        {bankLabel(bank)}
                                      </option>
                                    ))}
                                </select>
                              </td>
                              <td>
                                {readOnlyAmount ? (
                                  <input type="text" value={formatCurrency(balance)} disabled />
                                ) : (
                                  <CurrencyInput
                                    min={0}
                                    onValueChange={(value) => updateCloseTransfer(method, "amount", value)}
                                    value={formState.amount}
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">Nao ha caixa aberto para fechar.</p>
                )}

                <label>
                  Observacoes de fechamento
                  <textarea
                    onChange={(event) => updateCloseField("notes", event.target.value)}
                    rows={3}
                    value={closeForm.notes}
                  />
                </label>
                <button className="button button-outline" disabled={saving || openBanks.length === 0} type="submit">
                  Fechar caixa
                </button>
              </form>
            </div>
          </section>
          ) : null}

          {activeTab === "sales" ? (
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Fechar Venda da Loja</h2>
            </div>

            <form className="form" onSubmit={handleApplyPendingSalesFilters}>
              <div className="grid-3">
                <label>
                  Caixa para fechamento
                  <select
                    onChange={(event) => updateSaleCloseFilter("bankId", event.target.value)}
                    value={saleCloseFilters.bankId}
                  >
                    <option value="">Selecione</option>
                    {openBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bankLabel(bank)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data inicial
                  <input
                    onChange={(event) => updateSaleCloseFilter("dateFrom", event.target.value)}
                    type="date"
                    value={saleCloseFilters.dateFrom}
                  />
                </label>
                <label>
                  Data final
                  <input
                    onChange={(event) => updateSaleCloseFilter("dateTo", event.target.value)}
                    type="date"
                    value={saleCloseFilters.dateTo}
                  />
                </label>
              </div>
              <div className="table-actions">
                <button className="button button-primary" type="submit">
                  Buscar pedidos
                </button>
              </div>
            </form>

            <form className="form" onSubmit={handleCloseSaleByNumber}>
              <div className="grid-3">
                <label>
                  Fechar por numero do pedido
                  <input
                    inputMode="numeric"
                    onChange={(event) => setSaleCloseOrderNumber(normalizeOrderNumberInput(event.target.value))}
                    placeholder="Ex: 000123"
                    type="text"
                    value={saleCloseOrderNumber}
                  />
                </label>
                <label>
                  Caixa selecionado
                  <input
                    disabled
                    type="text"
                    value={saleCloseFilters.bankId ? bankLabel(overviewById.get(String(saleCloseFilters.bankId))) : ""}
                  />
                </label>
                <div style={{ alignItems: "flex-end", display: "flex" }}>
                  <button
                    className="button button-outline"
                    disabled={saving || !saleCloseFilters.bankId || !saleCloseOrderNumber}
                    type="submit"
                  >
                    Fechar por numero
                  </button>
                </div>
              </div>
            </form>

            <div className="table-wrapper registry-table">
              {loading ? <p>Carregando pedidos pendentes...</p> : null}
              {!loading && pendingSalesRows.length === 0 ? (
                <p className="muted">Nenhum pedido pendente no periodo informado.</p>
              ) : null}
              {pendingSalesRows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Cliente</th>
                      <th>Pagamento</th>
                      <th>Total</th>
                      <th>Data</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSalesRows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatOrderNumber(row)}</td>
                        <td>{row.client_name}</td>
                        <td>{paymentMethodLabel(row.payment_method)}</td>
                        <td>{formatCurrency(row.total_amount)}</td>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td>
                          <button
                            className="button button-primary small"
                            onClick={() => handleCloseSale(row)}
                            type="button"
                            disabled={closingSaleId === row.id || openBanks.length === 0 || !saleCloseFilters.bankId}
                          >
                            {closingSaleId === row.id ? "Fechando..." : "Fechar venda"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>
          ) : null}

          {activeTab === "status" ? (
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Status dos Caixas</h2>
            </div>
            <div className="table-wrapper registry-table">
              {loading ? <p>Carregando caixas...</p> : null}
              {!loading && overviewRows.length === 0 ? <p className="muted">Nenhum caixa encontrado.</p> : null}
              {overviewRows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Caixa</th>
                      <th>Status</th>
                      <th>Saldo banco</th>
                      <th>Abertura</th>
                      <th>Entradas</th>
                      <th>Saidas</th>
                      <th>Saldo sessao</th>
                      <th>Ultimo fechamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.bank_name}
                          <br />
                          <small className="muted">{row.account_name}</small>
                        </td>
                        <td>
                          <span className={sessionStatusClassName(row.session_status)}>
                            {sessionStatusLabel(row.session_status)}
                          </span>
                        </td>
                        <td>{formatCurrency(row.current_balance)}</td>
                        <td>{row.open_session ? formatCurrency(row.open_session.opening_balance) : "-"}</td>
                        <td>{row.open_session ? formatCurrency(row.open_session.total_entries) : "-"}</td>
                        <td>{row.open_session ? formatCurrency(row.open_session.total_exits) : "-"}</td>
                        <td>{row.open_session ? formatCurrency(row.open_session.current_balance) : "-"}</td>
                        <td>{row.last_closed_at ? formatDateTime(row.last_closed_at) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>
          ) : null}

          {activeTab === "sessions" ? (
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Historico de Sessoes</h2>
            </div>
            <div className="table-wrapper registry-table">
              {loading ? <p>Carregando sessoes...</p> : null}
              {!loading && sessionRows.length === 0 ? <p className="muted">Nenhuma sessao encontrada.</p> : null}
              {sessionRows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Caixa</th>
                      <th>Status</th>
                      <th>Abertura</th>
                      <th>Fechamento</th>
                      <th>Saldo inicial</th>
                      <th>Entradas</th>
                      <th>Saidas</th>
                      <th>Saldo final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.bank_name}
                          <br />
                          <small className="muted">{row.account_name}</small>
                        </td>
                        <td>
                          <span className={sessionStatusClassName(row.status)}>
                            {sessionStatusLabel(row.status)}
                          </span>
                        </td>
                        <td>{formatDateTime(row.opened_at)}</td>
                        <td>{row.closed_at ? formatDateTime(row.closed_at) : "-"}</td>
                        <td>{formatCurrency(row.opening_balance)}</td>
                        <td>{formatCurrency(row.total_entries)}</td>
                        <td>{formatCurrency(row.total_exits)}</td>
                        <td>{formatCurrency(row.current_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>
          ) : null}

          {activeTab === "movements" ? (
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Movimentacoes do Caixa</h2>
            </div>

            <form className="form" onSubmit={handleApplyMovementFilters}>
              <div className="grid-4">
                <label>
                  Caixa
                  <select
                    onChange={(event) => updateMovementFilter("bankId", event.target.value)}
                    value={movementFilters.bankId}
                  >
                    <option value="">Todos</option>
                    {overviewRows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {bankLabel(row)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Forma de pagamento
                  <select
                    onChange={(event) => updateMovementFilter("paymentMethod", event.target.value)}
                    value={movementFilters.paymentMethod}
                  >
                    <option value="">Todas</option>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data inicial
                  <input
                    onChange={(event) => updateMovementFilter("dateFrom", event.target.value)}
                    type="date"
                    value={movementFilters.dateFrom}
                  />
                </label>
                <label>
                  Data final
                  <input
                    onChange={(event) => updateMovementFilter("dateTo", event.target.value)}
                    type="date"
                    value={movementFilters.dateTo}
                  />
                </label>
              </div>
              <div className="table-actions">
                <button className="button button-primary" type="submit">
                  Aplicar filtros
                </button>
                <button className="button button-outline" onClick={handleClearMovementFilters} type="button">
                  Limpar filtros
                </button>
              </div>
            </form>

            <div className="table-wrapper registry-table">
              {loading ? <p>Carregando movimentacoes...</p> : null}
              {!loading && movementRows.length === 0 ? <p className="muted">Nenhuma movimentacao encontrada.</p> : null}
              {movementRows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th>Caixa</th>
                      <th>Movimentacao</th>
                      <th>Origem</th>
                      <th>Forma</th>
                      <th>Valor</th>
                      <th>Destino</th>
                      <th>Historico</th>
                      <th>Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td>
                          {row.bank_name}
                          <br />
                          <small className="muted">{row.account_name}</small>
                        </td>
                        <td>
                          <span className={movementTypeClassName(row.movement_type)}>
                            {movementTypeLabel(row.movement_type)}
                          </span>
                        </td>
                        <td>{movementOriginLabel(row.movement_origin)}</td>
                        <td>{paymentMethodLabel(row.payment_method)}</td>
                        <td>{formatCurrency(row.amount)}</td>
                        <td>
                          {row.destination_bank_name ? `${row.destination_bank_name} - ${row.destination_account_name}` : "-"}
                        </td>
                        <td>
                          {row.description || "-"}
                          {row.order_number ? (
                            <>
                              <br />
                              <small className="muted">Pedido: {row.order_number}</small>
                            </>
                          ) : null}
                        </td>
                        <td>{row.created_by_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
