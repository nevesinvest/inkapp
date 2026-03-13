import { useEffect, useState } from "react";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { formatDateTime } from "../utils/format";

const STOCK_ITEM_OPTIONS = [
  { value: "product", label: "Produto de venda" },
  { value: "consumable", label: "Material de consumo" }
];

const STOCK_MOVEMENT_FILTER_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "entry", label: "Entrada" },
  { value: "exit", label: "Saída" },
  { value: "sale", label: "Venda" }
];

const STOCK_MOVEMENT_CREATE_OPTIONS = [
  { value: "entry", label: "Entrada" },
  { value: "exit", label: "Saída" }
];

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function stockItemLabel(itemType) {
  return itemType === "product" ? "Produto de venda" : "Material de consumo";
}

function stockMovementLabel(movementType) {
  if (movementType === "entry") return "Entrada";
  if (movementType === "exit") return "Saída";
  if (movementType === "sale") return "Venda";
  return movementType || "-";
}

function stockMovementClassName(movementType) {
  if (movementType === "entry") return "stock-movement stock-movement-entry";
  if (movementType === "exit" || movementType === "sale") return "stock-movement stock-movement-exit";
  return "stock-movement";
}

function stockQuantityClassName(movementType) {
  if (movementType === "entry") return "stock-quantity stock-quantity-entry";
  if (movementType === "exit" || movementType === "sale") return "stock-quantity stock-quantity-exit";
  return "stock-quantity";
}

function getStockValueForItem(itemType, item) {
  if (!item) return 0;
  if (itemType === "product") return Number(item.stock || 0);
  return Number(item.current_stock || 0);
}

function formatStockQuantity(value) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(numericValue);
}

export function StockControlPage() {
  const { token } = useAuth();
  const { showAlert } = useDialog();

  const [products, setProducts] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({
    itemType: "",
    itemId: "",
    movementType: "",
    dateFrom: "",
    dateTo: ""
  });
  const [form, setForm] = useState({
    itemType: "product",
    itemId: "",
    movementType: "entry",
    quantity: "",
    reason: ""
  });
  const [loading, setLoading] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function listItemsByType(itemType) {
    if (itemType === "product") return products;
    return consumables;
  }

  function findItemByTypeAndId(itemType, itemId) {
    if (!itemId) return null;
    return listItemsByType(itemType).find((item) => Number(item.id) === Number(itemId)) || null;
  }

  async function loadItems() {
    if (!token) return;
    setLoadingItems(true);
    setError("");
    try {
      const [productsData, consumablesData] = await Promise.all([
        api.request("/registry/sale-products?includeInactive=true", { token }),
        api.request("/registry/consumables?includeInactive=true", { token })
      ]);
      setProducts(productsData);
      setConsumables(consumablesData);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadRows(nextFilters = filters) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextFilters.itemType) params.set("itemType", nextFilters.itemType);
      if (nextFilters.itemId) params.set("itemId", String(nextFilters.itemId));
      if (nextFilters.movementType) params.set("movementType", nextFilters.movementType);
      if (nextFilters.dateFrom) params.set("dateFrom", nextFilters.dateFrom);
      if (nextFilters.dateTo) params.set("dateTo", nextFilters.dateTo);
      params.set("limit", "500");
      const query = params.toString();
      const data = await api.request(`/registry/stock/movements${query ? `?${query}` : ""}`, {
        token
      });
      setRows(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    loadRows();
  }, [token]);

  useEffect(() => {
    if (!form.itemId) return;
    const itemExists = listItemsByType(form.itemType).some((item) => Number(item.id) === Number(form.itemId));
    if (!itemExists) {
      setForm((current) => ({
        ...current,
        itemId: ""
      }));
    }
  }, [form.itemType, form.itemId, products, consumables]);

  useEffect(() => {
    if (!filters.itemId || !filters.itemType) return;
    const itemExists = listItemsByType(filters.itemType).some(
      (item) => Number(item.id) === Number(filters.itemId)
    );
    if (!itemExists) {
      setFilters((current) => ({
        ...current,
        itemId: ""
      }));
    }
  }, [filters.itemType, filters.itemId, products, consumables]);

  function updateFilter(field, value) {
    setFilters((current) => {
      const next = {
        ...current,
        [field]: value
      };
      if (field === "itemType") {
        next.itemId = "";
      }
      return next;
    });
  }

  function updateMovementField(field, value) {
    setForm((current) => {
      const next = {
        ...current,
        [field]: value
      };
      if (field === "itemType") {
        next.itemId = "";
      }
      return next;
    });
  }

  async function handleApplyFilters(event) {
    event.preventDefault();
    setSuccess("");
    await loadRows(filters);
  }

  async function handleClearFilters() {
    const clearedFilters = {
      itemType: "",
      itemId: "",
      movementType: "",
      dateFrom: "",
      dateTo: ""
    };
    setFilters(clearedFilters);
    setSuccess("");
    await loadRows(clearedFilters);
  }

  async function handleSubmitMovement(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.itemType || !form.itemId || !form.movementType) {
        throw new Error("Selecione tipo, item e tipo de movimentação.");
      }

      const parsedQuantity = Number(form.quantity);
      if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
        throw new Error("Informe uma quantidade válida.");
      }

      const selectedItem = findItemByTypeAndId(form.itemType, form.itemId);
      if (!selectedItem) {
        throw new Error("Item selecionado não encontrado.");
      }

      const currentStock = getStockValueForItem(form.itemType, selectedItem);
      if (form.movementType === "exit" && parsedQuantity > currentStock) {
        await showAlert({
          title: "Estoque insuficiente",
          message: `A saída não pode ser maior que o estoque atual (${formatStockQuantity(currentStock)}).`
        });
        throw new Error(
          `A saída não pode ser maior que o estoque atual (${formatStockQuantity(currentStock)}).`
        );
      }

      const movement = await api.request("/registry/stock/movements", {
        method: "POST",
        token,
        body: {
          itemType: form.itemType,
          itemId: Number(form.itemId),
          movementType: form.movementType,
          quantity: parsedQuantity,
          reason: toOptionalText(form.reason)
        }
      });

      setSuccess(
        `Movimentação registrada. Estoque atualizado: ${formatStockQuantity(movement.new_stock)}.`
      );
      setForm((current) => ({
        ...current,
        quantity: "",
        reason: ""
      }));

      await Promise.all([loadItems(), loadRows(filters)]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const movementItemOptions = listItemsByType(form.itemType);
  const selectedMovementItem = findItemByTypeAndId(form.itemType, form.itemId);
  const selectedMovementItemStock = selectedMovementItem
    ? getStockValueForItem(form.itemType, selectedMovementItem)
    : null;
  const filterItemOptions = filters.itemType ? listItemsByType(filters.itemType) : [];

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Controle de Estoque</h1>
          <p>Lançamentos de entrada e saída com histórico completo de movimentações.</p>
        </div>

        <div className="stock-layout">
          <section className="panel">
            <div className="registry-panel-header">
              <h2>Lançamento de Estoque</h2>
            </div>

            <form className="form" onSubmit={handleSubmitMovement}>
              <div className="grid-3">
                <label>
                  Tipo de item
                  <select
                    onChange={(event) => updateMovementField("itemType", event.target.value)}
                    value={form.itemType}
                  >
                    {STOCK_ITEM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Item
                  <select
                    onChange={(event) => updateMovementField("itemId", event.target.value)}
                    value={form.itemId}
                  >
                    <option value="">Selecione</option>
                    {movementItemOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {form.itemType === "product" && item.sku ? ` (SKU: ${item.sku})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo de movimentação
                  <select
                    onChange={(event) => updateMovementField("movementType", event.target.value)}
                    value={form.movementType}
                  >
                    {STOCK_MOVEMENT_CREATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid-2">
                <label>
                  Quantidade
                  <input
                    min="0.01"
                    onChange={(event) => updateMovementField("quantity", event.target.value)}
                    step="0.01"
                    type="number"
                    value={form.quantity}
                  />
                </label>
                <label>
                  Motivo
                  <input
                    onChange={(event) => updateMovementField("reason", event.target.value)}
                    placeholder="Ex: compra, ajuste, perda, uso interno"
                    type="text"
                    value={form.reason}
                  />
                </label>
              </div>

              {selectedMovementItem ? (
                <p className="muted">
                  Estoque atual de <strong>{selectedMovementItem.name}</strong>:{" "}
                  <strong>{formatStockQuantity(selectedMovementItemStock)}</strong>
                </p>
              ) : null}

              <FeedbackMessage message={error} type="error" />
              <FeedbackMessage message={success} type="success" />
              {loadingItems ? <p className="muted">Carregando itens...</p> : null}

              <div className="table-actions">
                <button className="button button-primary" disabled={saving} type="submit">
                  {saving ? "Salvando..." : "Lançar movimentação"}
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="registry-panel-header">
              <h2>Movimentações de Estoque</h2>
            </div>

            <form className="form" onSubmit={handleApplyFilters}>
              <div className="grid-3">
                <label>
                  Filtrar por tipo de item
                  <select
                    onChange={(event) => updateFilter("itemType", event.target.value)}
                    value={filters.itemType}
                  >
                    <option value="">Todos</option>
                    {STOCK_ITEM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Filtrar por item
                  <select
                    disabled={!filters.itemType}
                    onChange={(event) => updateFilter("itemId", event.target.value)}
                    value={filters.itemId}
                  >
                    <option value="">Todos</option>
                    {filterItemOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo de movimentação
                  <select
                    onChange={(event) => updateFilter("movementType", event.target.value)}
                    value={filters.movementType}
                  >
                    {STOCK_MOVEMENT_FILTER_OPTIONS.map((option) => (
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
              {loading ? <p>Carregando movimentações...</p> : null}
              {!loading && rows.length === 0 ? <p className="muted">Nenhuma movimentação encontrada.</p> : null}
              {rows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data / Hora</th>
                      <th>Tipo de item</th>
                      <th>Item</th>
                      <th>Movimentação</th>
                      <th>Quantidade</th>
                      <th>Estoque anterior</th>
                      <th>Estoque atual</th>
                      <th>Motivo</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td>{stockItemLabel(row.item_type)}</td>
                        <td>
                          {row.item_name}
                          {row.item_type === "product" && row.item_sku ? ` (SKU: ${row.item_sku})` : ""}
                        </td>
                        <td>
                          <span className={stockMovementClassName(row.movement_type)}>
                            {stockMovementLabel(row.movement_type)}
                          </span>
                        </td>
                        <td>
                          <span className={stockQuantityClassName(row.movement_type)}>
                            {formatStockQuantity(row.quantity)}
                          </span>
                        </td>
                        <td>{formatStockQuantity(row.previous_stock)}</td>
                        <td>{formatStockQuantity(row.new_stock)}</td>
                        <td>{row.reason || "-"}</td>
                        <td>{row.created_by_name || "-"}</td>
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
