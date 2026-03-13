import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { toDateInputSaoPaulo } from "../utils/timezone";
import { formatCurrency, formatDateShort } from "../utils/format";

const MOVEMENT_FILTER_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "entry", label: "Entrada manual" },
  { value: "payment", label: "Pagamento" }
];

const MOVEMENT_CREATE_OPTIONS = [
  { value: "entry", label: "Entrada manual" },
  { value: "payment", label: "Pagamento" }
];

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function movementTypeLabel(movementType) {
  if (movementType === "entry") return "Entrada";
  if (movementType === "payment") return "Pagamento";
  return movementType || "-";
}

function movementTypeClassName(movementType) {
  if (movementType === "entry") return "commission-movement commission-movement-entry";
  if (movementType === "payment") return "commission-movement commission-movement-payment";
  return "commission-movement";
}

function movementAmountClassName(movementType) {
  if (movementType === "entry") return "commission-amount commission-amount-entry";
  if (movementType === "payment") return "commission-amount commission-amount-payment";
  return "commission-amount";
}

function balanceAmountClassName(value) {
  const parsed = Number(value || 0);
  if (parsed > 0.000001) return "commission-balance commission-balance-positive";
  if (parsed < -0.000001) return "commission-balance commission-balance-negative";
  return "commission-balance";
}

function movementOriginLabel(origin) {
  if (origin === "generated") return "Comissão gerada";
  if (origin === "manual_entry") return "Entrada manual";
  if (origin === "payment") return "Pagamento";
  return origin || "-";
}

function parsePercentageValue(value) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatPercentageValue(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toFixed(2);
}

export function CommissionsPage() {
  const { token } = useAuth();
  const { showAlert, showConfirm } = useDialog();

  const [artists, setArtists] = useState([]);
  const [commissionInputs, setCommissionInputs] = useState({});
  const [movements, setMovements] = useState([]);
  const [pendingByArtist, setPendingByArtist] = useState([]);
  const [summary, setSummary] = useState({
    totalEntries: 0,
    totalPayments: 0,
    balance: 0
  });
  const [filters, setFilters] = useState({
    artistId: "",
    movementType: "",
    dateFrom: "",
    dateTo: ""
  });
  const [form, setForm] = useState({
    artistId: "",
    movementType: "entry",
    amount: 0,
    occurredOn: toDateInputSaoPaulo(),
    description: ""
  });
  const [ledgerFilters, setLedgerFilters] = useState({
    artistId: "",
    dateFrom: "",
    dateTo: ""
  });
  const [ledger, setLedger] = useState(null);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [savingCommissionId, setSavingCommissionId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const amountInputRef = useRef(null);

  const selectedArtist = useMemo(
    () => artists.find((artist) => Number(artist.id) === Number(form.artistId)) || null,
    [artists, form.artistId]
  );
  const selectedArtistBalance = Number(selectedArtist?.balance || 0);
  const draftAmountValue = Number(form.amount || 0);
  const isOverbalanceDraft =
    form.movementType === "payment" &&
    selectedArtist &&
    Number.isFinite(draftAmountValue) &&
    draftAmountValue > 0 &&
    draftAmountValue - selectedArtistBalance > 0.000001;
  const ledgerClosingBalance = useMemo(() => {
    if (!ledger) return 0;
    if (!Array.isArray(ledger.rows) || ledger.rows.length === 0) {
      return Number(ledger.openingBalance || 0);
    }
    return Number(ledger.rows[ledger.rows.length - 1].running_balance || 0);
  }, [ledger]);
  const ledgerRowsForDisplay = useMemo(() => {
    if (!ledger || !Array.isArray(ledger.rows)) return [];
    return [...ledger.rows].sort((a, b) => {
      if (a.occurred_on !== b.occurred_on) {
        return String(b.occurred_on).localeCompare(String(a.occurred_on));
      }
      return Number(b.id) - Number(a.id);
    });
  }, [ledger]);

  async function loadArtists() {
    if (!token) return;
    setLoadingArtists(true);
    setError("");

    try {
      const data = await api.request("/commissions/artists", { token });
      setArtists(data);

      const nextInputs = {};
      data.forEach((artist) => {
        nextInputs[artist.id] = formatPercentageValue(artist.commission_percentage);
      });
      setCommissionInputs(nextInputs);

      setLedgerFilters((current) => {
        const exists = data.some((artist) => String(artist.id) === String(current.artistId));
        if (exists) return current;
        return {
          ...current,
          artistId: data.length > 0 ? String(data[0].id) : ""
        };
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingArtists(false);
    }
  }

  async function loadPendingCommissions(nextFilters = filters) {
    if (!token) return;
    setLoadingPending(true);

    try {
      const params = new URLSearchParams();
      if (nextFilters.artistId) params.set("artistId", String(nextFilters.artistId));
      if (nextFilters.dateFrom) params.set("dateFrom", nextFilters.dateFrom);
      if (nextFilters.dateTo) params.set("dateTo", nextFilters.dateTo);

      const query = params.toString();
      const pendingData = await api.request(`/commissions/pending${query ? `?${query}` : ""}`, { token });
      setPendingByArtist(pendingData);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingPending(false);
    }
  }

  async function loadLedger(nextLedgerFilters = ledgerFilters) {
    if (!token) return;
    if (!nextLedgerFilters.artistId) {
      setLedger(null);
      return;
    }

    setLoadingLedger(true);
    try {
      const params = new URLSearchParams({
        artistId: String(nextLedgerFilters.artistId)
      });
      if (nextLedgerFilters.dateFrom) params.set("dateFrom", nextLedgerFilters.dateFrom);
      if (nextLedgerFilters.dateTo) params.set("dateTo", nextLedgerFilters.dateTo);

      const ledgerData = await api.request(`/commissions/ledger?${params.toString()}`, { token });
      setLedger(ledgerData);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingLedger(false);
    }
  }

  async function loadMovementsAndSummary(nextFilters = filters) {
    if (!token) return;
    setLoadingMovements(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (nextFilters.artistId) params.set("artistId", String(nextFilters.artistId));
      if (nextFilters.movementType) params.set("movementType", nextFilters.movementType);
      if (nextFilters.dateFrom) params.set("dateFrom", nextFilters.dateFrom);
      if (nextFilters.dateTo) params.set("dateTo", nextFilters.dateTo);
      params.set("limit", "500");

      const query = params.toString();
      const [movementsData, summaryData] = await Promise.all([
        api.request(`/commissions/movements${query ? `?${query}` : ""}`, { token }),
        api.request(`/commissions/summary${query ? `?${query}` : ""}`, { token })
      ]);

      setMovements(movementsData);
      setSummary({
        totalEntries: Number(summaryData.totalEntries || 0),
        totalPayments: Number(summaryData.totalPayments || 0),
        balance: Number(summaryData.balance || 0)
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingMovements(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadArtists();
    loadMovementsAndSummary();
    loadPendingCommissions();
  }, [token]);

  useEffect(() => {
    if (!token || !ledgerFilters.artistId) {
      setLedger(null);
      return;
    }
    loadLedger(ledgerFilters);
  }, [token, ledgerFilters.artistId]);

  function updateFilter(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateLedgerFilter(field, value) {
    setLedgerFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateCommissionInput(artistId, value) {
    setCommissionInputs((current) => ({
      ...current,
      [artistId]: value
    }));
  }

  async function handleSaveCommission(artistId) {
    setError("");
    setSuccess("");
    setSavingCommissionId(artistId);

    try {
      const rawValue = commissionInputs[artistId];
      const parsedValue = parsePercentageValue(rawValue);
      if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 100) {
        await showAlert({
          title: "Percentual inválido",
          message: "Informe um percentual entre 0 e 100."
        });
        throw new Error("Percentual de comissão deve estar entre 0 e 100.");
      }

      const updatedArtist = await api.request(`/commissions/artists/${artistId}/commission-percentage`, {
        method: "PATCH",
        token,
        body: {
          commissionPercentage: parsedValue
        }
      });

      setArtists((current) =>
        current.map((artist) =>
          Number(artist.id) === Number(artistId)
            ? {
                ...artist,
                ...updatedArtist,
                balance: Number(updatedArtist.balance || 0)
              }
            : artist
        )
      );
      setCommissionInputs((current) => ({
        ...current,
        [artistId]: formatPercentageValue(parsedValue)
      }));
      setSuccess("Percentual de comissão atualizado.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingCommissionId(null);
    }
  }

  async function handleApplyFilters(event) {
    event.preventDefault();
    setSuccess("");
    await Promise.all([loadMovementsAndSummary(filters), loadPendingCommissions(filters)]);
  }

  async function handleClearFilters() {
    const cleared = {
      artistId: "",
      movementType: "",
      dateFrom: "",
      dateTo: ""
    };
    setFilters(cleared);
    setSuccess("");
    await Promise.all([loadMovementsAndSummary(cleared), loadPendingCommissions(cleared)]);
  }

  async function handleApplyLedgerFilters(event) {
    event.preventDefault();
    setSuccess("");
    await loadLedger(ledgerFilters);
  }

  async function handleClearLedgerFilters() {
    const cleared = {
      ...ledgerFilters,
      dateFrom: "",
      dateTo: ""
    };
    setLedgerFilters(cleared);
    setSuccess("");
    await loadLedger(cleared);
  }

  function focusAmountInput() {
    setTimeout(() => {
      if (amountInputRef.current) {
        amountInputRef.current.focus();
      }
    }, 0);
  }

  async function submitMovementRequest(amountValue, allowOverbalance = false) {
    return api.request("/commissions/movements", {
      method: "POST",
      token,
      body: {
        artistId: Number(form.artistId),
        movementType: form.movementType,
        amount: amountValue,
        occurredOn: form.occurredOn,
        description: toOptionalText(form.description),
        allowOverbalance
      }
    });
  }

  async function confirmOverbalancePayment(amountValue, balanceValue) {
    return showConfirm({
      title: "Pagamento superior ao saldo",
      message: `Valor lançado (${formatCurrency(amountValue)}) é superior ao saldo (${formatCurrency(balanceValue)}). Continuar mesmo assim?`,
      confirmLabel: "Sim, continuar",
      cancelLabel: "Não"
    });
  }

  async function handleSubmitMovement(event) {
    event.preventDefault();
    setSavingMovement(true);
    setError("");
    setSuccess("");

    try {
      if (!form.artistId || !form.movementType) {
        throw new Error("Selecione artista e tipo de movimentação.");
      }

      const amountValue = Number(form.amount || 0);
      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        throw new Error("Informe um valor válido para a comissão.");
      }

      if (!form.occurredOn) {
        throw new Error("Informe a data da movimentação.");
      }

      const tolerance = 0.000001;
      let allowOverbalance = false;
      if (
        form.movementType === "payment" &&
        selectedArtist &&
        amountValue - selectedArtistBalance > tolerance
      ) {
        const shouldContinue = await confirmOverbalancePayment(amountValue, selectedArtistBalance);
        if (!shouldContinue) {
          setError("Pagamento cancelado. Informe um novo valor.");
          focusAmountInput();
          return;
        }
        allowOverbalance = true;
      }

      let created;
      try {
        created = await submitMovementRequest(amountValue, allowOverbalance);
      } catch (requestError) {
        if (requestError.code !== "OVERBALANCE_PAYMENT" || form.movementType !== "payment") {
          throw requestError;
        }

        const backendBalance = Number(requestError.payload?.balance || 0);
        const shouldContinue = await confirmOverbalancePayment(amountValue, backendBalance);
        if (!shouldContinue) {
          setError("Pagamento cancelado. Informe um novo valor.");
          focusAmountInput();
          return;
        }

        created = await submitMovementRequest(amountValue, true);
      }

      setSuccess(`Movimentação registrada. Saldo atual: ${formatCurrency(created.balance_after)}.`);
      setForm((current) => ({
        ...current,
        amount: 0,
        description: ""
      }));

      const refreshPromises = [loadArtists(), loadMovementsAndSummary(filters), loadPendingCommissions(filters)];
      if (ledgerFilters.artistId) {
        refreshPromises.push(loadLedger(ledgerFilters));
      }
      await Promise.all(refreshPromises);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingMovement(false);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Controle de Comissões</h1>
          <p>Gestão de comissões dos artistas com entradas manuais, pagamentos e saldo.</p>
        </div>

        <div className="commissions-layout">
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Percentual por artista</h2>
            </div>

            <FeedbackMessage message={error} type="error" />
            <FeedbackMessage message={success} type="success" />

            <div className="table-wrapper registry-table">
              {loadingArtists ? <p>Carregando artistas...</p> : null}
              {!loadingArtists && artists.length === 0 ? (
                <p className="muted">Nenhum artista encontrado.</p>
              ) : null}
              {artists.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Artista</th>
                      <th>Estilo</th>
                      <th>Comissão (%)</th>
                      <th>Saldo atual</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artists.map((artist) => (
                      <tr key={artist.id}>
                        <td>{artist.name}</td>
                        <td>{artist.style || "-"}</td>
                        <td>
                          <input
                            className="commission-percentage-input"
                            inputMode="decimal"
                            onChange={(event) => updateCommissionInput(artist.id, event.target.value)}
                            type="text"
                            value={commissionInputs[artist.id] ?? ""}
                          />
                        </td>
                        <td>{formatCurrency(artist.balance || 0)}</td>
                        <td>
                          <button
                            className="button button-outline small"
                            disabled={savingCommissionId === artist.id}
                            onClick={() => handleSaveCommission(artist.id)}
                            type="button"
                          >
                            {savingCommissionId === artist.id ? "Salvando..." : "Salvar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="registry-panel-header">
              <h2>Lançamento de comissão</h2>
            </div>

            <form className="form" onSubmit={handleSubmitMovement}>
              <div className="grid-3">
                <label>
                  Artista
                  <select onChange={(event) => updateForm("artistId", event.target.value)} value={form.artistId}>
                    <option value="">Selecione</option>
                    {artists.map((artist) => (
                      <option key={artist.id} value={artist.id}>
                        {artist.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo de movimentação
                  <select
                    onChange={(event) => updateForm("movementType", event.target.value)}
                    value={form.movementType}
                  >
                    {MOVEMENT_CREATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data
                  <input
                    onChange={(event) => updateForm("occurredOn", event.target.value)}
                    type="date"
                    value={form.occurredOn}
                  />
                </label>
              </div>

              <div className="grid-2">
                <label>
                  Valor (R$)
                  <CurrencyInput
                    inputRef={amountInputRef}
                    min={0}
                    onValueChange={(value) => updateForm("amount", value)}
                    value={form.amount}
                  />
                </label>
                <label>
                  Descrição
                  <input
                    onChange={(event) => updateForm("description", event.target.value)}
                    placeholder="Ex: ajuste manual, pagamento quinzenal"
                    type="text"
                    value={form.description}
                  />
                </label>
              </div>

              {selectedArtist ? (
                <p className="muted">
                  Saldo atual de <strong>{selectedArtist.name}</strong>:{" "}
                  <strong>{formatCurrency(selectedArtist.balance || 0)}</strong>
                </p>
              ) : null}
              {isOverbalanceDraft ? (
                <FeedbackMessage
                  message="Este pagamento é maior que o saldo atual. Ao confirmar, o saldo ficará negativo."
                  type="warning"
                />
              ) : null}

              <div className="table-actions">
                <button className="button button-primary" disabled={savingMovement} type="submit">
                  {savingMovement ? "Salvando..." : "Registrar movimentação"}
                </button>
              </div>
            </form>
          </section>

          <div className="commissions-summary-grid">
            <article className="commissions-summary-card">
              <span>Total de entradas</span>
              <strong>{formatCurrency(summary.totalEntries)}</strong>
            </article>
            <article className="commissions-summary-card">
              <span>Total de pagamentos</span>
              <strong>{formatCurrency(summary.totalPayments)}</strong>
            </article>
            <article className="commissions-summary-card">
              <span>Saldo a pagar</span>
              <strong>{formatCurrency(summary.balance)}</strong>
            </article>
          </div>

          <section className="panel">
            <div className="registry-panel-header">
              <h2>Comissões pendentes</h2>
            </div>

            <div className="table-wrapper registry-table">
              {loadingPending ? <p>Carregando comissões pendentes...</p> : null}
              {!loadingPending && pendingByArtist.length === 0 ? (
                <p className="muted">Nenhuma comissão pendente encontrada.</p>
              ) : null}
              {pendingByArtist.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Artista</th>
                      <th>Comissão (%)</th>
                      <th>Comissões geradas</th>
                      <th>Entradas manuais</th>
                      <th>Pagamentos</th>
                      <th>Saldo pendente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingByArtist.map((item) => (
                      <tr key={item.artist_id}>
                        <td>{item.artist_name}</td>
                        <td>{formatPercentageValue(item.commission_percentage)}</td>
                        <td>{formatCurrency(item.generated_total)}</td>
                        <td>{formatCurrency(item.manual_entries_total)}</td>
                        <td>{formatCurrency(item.payments_total)}</td>
                        <td>
                          <span className={balanceAmountClassName(item.pending_balance)}>
                            {formatCurrency(item.pending_balance)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="registry-panel-header">
              <h2>Histórico de comissões</h2>
            </div>

            <form className="form" onSubmit={handleApplyFilters}>
              <div className="grid-2">
                <label>
                  Artista
                  <select
                    onChange={(event) => updateFilter("artistId", event.target.value)}
                    value={filters.artistId}
                  >
                    <option value="">Todos</option>
                    {artists.map((artist) => (
                      <option key={artist.id} value={artist.id}>
                        {artist.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo
                  <select
                    onChange={(event) => updateFilter("movementType", event.target.value)}
                    value={filters.movementType}
                  >
                    {MOVEMENT_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid-2">
                <label>
                  Data inicial
                  <input
                    onChange={(event) => updateFilter("dateFrom", event.target.value)}
                    type="date"
                    value={filters.dateFrom}
                  />
                </label>
                <label>
                  Data final
                  <input
                    onChange={(event) => updateFilter("dateTo", event.target.value)}
                    type="date"
                    value={filters.dateTo}
                  />
                </label>
              </div>

              <div className="table-actions">
                <button className="button button-primary" type="submit">
                  Aplicar filtros
                </button>
                <button className="button button-outline" onClick={handleClearFilters} type="button">
                  Limpar filtros
                </button>
              </div>
            </form>

            <div className="table-wrapper registry-table">
              {loadingMovements ? <p>Carregando movimentacoes...</p> : null}
              {!loadingMovements && movements.length === 0 ? (
                <p className="muted">Nenhuma movimentação encontrada.</p>
              ) : null}
              {movements.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Artista</th>
                      <th>Movimentação</th>
                      <th>Valor</th>
                      <th>Descrição</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{formatDateShort(movement.occurred_on)}</td>
                        <td>{movement.artist_name}</td>
                        <td>
                          <span className={movementTypeClassName(movement.movement_type)}>
                            {movementTypeLabel(movement.movement_type)}
                          </span>
                        </td>
                        <td>
                          <span className={movementAmountClassName(movement.movement_type)}>
                            {formatCurrency(movement.amount)}
                          </span>
                        </td>
                        <td>{movement.description || "-"}</td>
                        <td>{movement.created_by_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="registry-panel-header">
              <h2>Conta corrente de comissões</h2>
            </div>

            <form className="form" onSubmit={handleApplyLedgerFilters}>
              <div className="grid-3">
                <label>
                  Artista
                  <select
                    onChange={(event) => updateLedgerFilter("artistId", event.target.value)}
                    value={ledgerFilters.artistId}
                  >
                    <option value="">Selecione</option>
                    {artists.map((artist) => (
                      <option key={artist.id} value={artist.id}>
                        {artist.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data inicial
                  <input
                    onChange={(event) => updateLedgerFilter("dateFrom", event.target.value)}
                    type="date"
                    value={ledgerFilters.dateFrom}
                  />
                </label>
                <label>
                  Data final
                  <input
                    onChange={(event) => updateLedgerFilter("dateTo", event.target.value)}
                    type="date"
                    value={ledgerFilters.dateTo}
                  />
                </label>
              </div>

              <div className="table-actions">
                <button className="button button-primary" type="submit">
                  Atualizar conta corrente
                </button>
                <button className="button button-outline" onClick={handleClearLedgerFilters} type="button">
                  Limpar período
                </button>
              </div>
            </form>

            {ledger ? (
              <p className="muted">
                Artista: <strong>{ledger.artist?.name}</strong> | Saldo inicial:{" "}
                <strong>{formatCurrency(ledger.openingBalance || 0)}</strong> | Saldo final:{" "}
                <strong className={balanceAmountClassName(ledgerClosingBalance)}>
                  {formatCurrency(ledgerClosingBalance)}
                </strong>
              </p>
            ) : (
              <p className="muted">Selecione um artista para visualizar a conta corrente.</p>
            )}

            <div className="table-wrapper registry-table">
              {loadingLedger ? <p>Carregando conta corrente...</p> : null}
              {!loadingLedger && ledger && ledgerRowsForDisplay.length === 0 ? (
                <p className="muted">Nenhum lançamento encontrado para o período informado.</p>
              ) : null}
              {ledger && ledgerRowsForDisplay.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Origem</th>
                      <th>Movimentação</th>
                      <th>Valor</th>
                      <th>Saldo acumulado</th>
                      <th>Descrição</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRowsForDisplay.map((movement) => (
                      <tr key={movement.id}>
                        <td>{formatDateShort(movement.occurred_on)}</td>
                        <td>{movementOriginLabel(movement.movement_origin)}</td>
                        <td>
                          <span className={movementTypeClassName(movement.movement_type)}>
                            {movementTypeLabel(movement.movement_type)}
                          </span>
                        </td>
                        <td>
                          <span className={movementAmountClassName(movement.movement_type)}>
                            {formatCurrency(movement.amount)}
                          </span>
                        </td>
                        <td>
                          <span className={balanceAmountClassName(movement.running_balance)}>
                            {formatCurrency(movement.running_balance)}
                          </span>
                        </td>
                        <td>{movement.description || "-"}</td>
                        <td>{movement.created_by_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

