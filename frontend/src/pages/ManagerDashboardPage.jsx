import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateTime } from "../utils/format";

const statusOptions = ["pending", "confirmed", "completed", "cancelled"];
const STATUS_LABELS = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Concluido",
  cancelled: "Cancelado"
};
const CHART_COLORS = ["#111111", "#e06b2f", "#1f8d57", "#1565c0", "#6a5acd", "#9c6644", "#b93a3a"];
const ORDER_PAYMENT_LABELS = {
  cash: "Dinheiro",
  credit_card: "Cartao de credito",
  debit_card: "Cartao de debito",
  pix: "Pix"
};

function formatOrderNumber(order) {
  if (order?.order_number) return order.order_number;
  return String(Number(order?.id || 0)).padStart(6, "0");
}

function formatOrderPaymentMethod(value) {
  return ORDER_PAYMENT_LABELS[String(value || "").trim().toLowerCase()] || value || "-";
}

export function ManagerDashboardPage() {
  const { token } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [accountsOverview, setAccountsOverview] = useState(null);
  const [earnings, setEarnings] = useState([]);
  const [payableByExpenseType, setPayableByExpenseType] = useState([]);
  const [receivableByClient, setReceivableByClient] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [stockAlerts, setStockAlerts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [stockToasts, setStockToasts] = useState([]);
  const [filters, setFilters] = useState({
    status: ""
  });
  const [error, setError] = useState("");
  const hasShownStockDisplayRef = useRef(false);
  const toastTimersRef = useRef(new Map());

  async function loadData(currentFilters = filters) {
    try {
      const appointmentQuery = new URLSearchParams();
      if (currentFilters.status) appointmentQuery.append("status", currentFilters.status);

      const [
        appointmentsData,
        summaryData,
        accountsOverviewData,
        earningsData,
        payableByExpenseTypeData,
        receivableByClientData,
        timelineData,
        productAlertsData,
        consumablesData,
        ordersData
      ] =
        await Promise.all([
          api.request(`/appointments/manager?${appointmentQuery.toString()}`, { token }),
          api.request("/finance/summary?period=monthly", { token }),
          api.request("/finance/accounts-overview", { token }),
          api.request("/finance/artist-earnings", { token }),
          api.request("/finance/accounts-payable/by-expense-type", { token }),
          api.request("/finance/accounts-receivable/by-client", { token }),
          api.request("/finance/timeline?days=30", { token }),
          api.request("/products/alerts/low-stock", { token }),
          api.request("/registry/consumables", { token }),
          api.request("/orders", { token })
        ]);

      const lowStockProducts = (productAlertsData || []).map((alert) => ({
        id: `product-${alert.id}`,
        ref_id: alert.id,
        item_type: "product",
        name: alert.name,
        current_stock: Number(alert.stock || 0),
        min_stock: Number(alert.low_stock_threshold || 0)
      }));

      const lowStockConsumables = (consumablesData || [])
        .filter((item) => Number(item.current_stock || 0) <= Number(item.min_stock || 0))
        .map((item) => ({
          id: `consumable-${item.id}`,
          ref_id: item.id,
          item_type: "consumable",
          name: item.name,
          current_stock: Number(item.current_stock || 0),
          min_stock: Number(item.min_stock || 0)
        }));

      const combinedStockAlerts = [...lowStockConsumables, ...lowStockProducts];

      setAppointments(appointmentsData);
      setSummary(summaryData);
      setAccountsOverview(accountsOverviewData);
      setEarnings(earningsData.earnings);
      setPayableByExpenseType(payableByExpenseTypeData.rows || []);
      setReceivableByClient(receivableByClientData.rows || []);
      setTimeline(timelineData.rows);
      setStockAlerts(combinedStockAlerts);
      setOrders(ordersData);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (hasShownStockDisplayRef.current) return undefined;
    if (stockAlerts.length === 0) return undefined;

    hasShownStockDisplayRef.current = true;
    setStockToasts(stockAlerts);

    stockAlerts.forEach((alert) => {
      const timeoutId = setTimeout(() => {
        toastTimersRef.current.delete(alert.id);
        setStockToasts((current) => current.filter((item) => item.id !== alert.id));
      }, 5000);

      toastTimersRef.current.set(alert.id, timeoutId);
    });

    return undefined;
  }, [stockAlerts]);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      toastTimersRef.current.clear();
    };
  }, []);

  function dismissStockToast(productId) {
    const timeoutId = toastTimersRef.current.get(productId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      toastTimersRef.current.delete(productId);
    }

    setStockToasts((current) => current.filter((item) => item.id !== productId));
  }

  const timelineChartData = useMemo(() => {
    const map = new Map();
    timeline.forEach((row) => {
      const existing = map.get(row.occurred_on) || { date: row.occurred_on, income: 0, expense: 0 };
      existing[row.type] = Number(row.total);
      map.set(row.occurred_on, existing);
    });
    return Array.from(map.values());
  }, [timeline]);

  const earningsPieData = useMemo(
    () =>
      earnings
        .map((item) => ({
          name: item.artist_name,
          value: Number(item.total || 0)
        }))
        .filter((item) => item.value > 0),
    [earnings]
  );

  const payablesChartData = useMemo(
    () =>
      payableByExpenseType
        .map((item) => ({
          name: item.expense_type_name,
          pending: Number(item.pending_total || 0),
          paid: Number(item.paid_total || 0)
        }))
        .filter((item) => item.pending > 0 || item.paid > 0),
    [payableByExpenseType]
  );

  const receivablesChartData = useMemo(
    () =>
      receivableByClient
        .map((item) => ({
          name: item.client_name,
          pending: Number(item.pending_total || 0),
          received: Number(item.received_total || 0)
        }))
        .filter((item) => item.pending > 0 || item.received > 0),
    [receivableByClient]
  );

  async function handleStatusChange(appointmentId, status) {
    try {
      await api.request(`/appointments/${appointmentId}/status`, {
        method: "PATCH",
        token,
        body: { status }
      });
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function handleFilterChange(value) {
    const nextFilters = { ...filters, status: value };
    setFilters(nextFilters);
    loadData(nextFilters);
  }

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Painel do Gerente</h1>
          <p>Agenda consolidada, finanças, vendas e alertas de estoque baixo.</p>
          <div className="table-actions">
            <Link className="button button-outline" to="/agenda-gerencial">
              Abrir Agenda Calendar
            </Link>
            <Link className="button button-outline" to="/financeiro">
              Abrir Financeiro
            </Link>
            <Link className="button button-outline" to="/painel-diretoria">
              Abrir Painel Diretoria
            </Link>
          </div>
        </div>

        <FeedbackMessage message={error} type="error" />

        {stockToasts.length > 0 ? (
          <div className="stock-toast-stack">
            {stockToasts.map((alert) => (
              <article
                className={`stock-toast-card ${
                  alert.item_type === "consumable" ? "stock-toast-consumable" : "stock-toast-product"
                }`}
                key={alert.id}
              >
                <div className="stock-toast-head">
                  <strong>
                    {alert.item_type === "consumable"
                      ? "Material de consumo em estoque mínimo"
                      : "Produto em estoque mínimo"}
                  </strong>
                  <button
                    className="stock-toast-close"
                    onClick={() => dismissStockToast(alert.id)}
                    type="button"
                  >
                    Fechar
                  </button>
                </div>
                <p>{alert.name}</p>
                <span>
                  Estoque atual: {alert.current_stock} | Mínimo: {alert.min_stock}
                </span>
              </article>
            ))}
          </div>
        ) : null}

        {summary ? (
          <div className="metrics-grid">
            <MetricCard label="Faturamento" value={formatCurrency(summary.revenue)} />
            <MetricCard label="Despesas" value={formatCurrency(summary.expenses)} />
            <MetricCard label="Lucro" value={formatCurrency(summary.profit)} />
            <MetricCard
              label="Contas a pagar pendentes"
              value={formatCurrency(accountsOverview?.payable?.pendingTotal || 0)}
            />
            <MetricCard
              label="Contas a receber pendentes"
              value={formatCurrency(accountsOverview?.receivable?.pendingTotal || 0)}
            />
            <MetricCard
              label="Saldo pendente líquido"
              value={formatCurrency(accountsOverview?.netPending || 0)}
            />
          </div>
        ) : null}

        <div className="chart-grid">
          <article className="panel">
            <h2>Receita x Despesa (30 dias)</h2>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timelineChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line dataKey="income" stroke="#00b894" name="Receita" />
                  <Line dataKey="expense" stroke="#d63031" name="Despesa" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="panel">
            <h2>Ganhos por tatuador (Pizza)</h2>
            <div className="chart-box">
              {earningsPieData.length === 0 ? <p className="muted">Sem ganhos no período.</p> : null}
              {earningsPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Tooltip />
                    <Legend />
                    <Pie
                      data={earningsPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={95}
                      label
                    >
                      {earningsPieData.map((entry, index) => (
                        <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <h2>Contas a pagar por tipo de despesa</h2>
            <div className="chart-box">
              {payablesChartData.length === 0 ? (
                <p className="muted">Sem lançamentos de contas a pagar.</p>
              ) : null}
              {payablesChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={payablesChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="pending" fill="#b93a3a" name="Pendente" />
                    <Bar dataKey="paid" fill="#1f8d57" name="Pago" />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <h2>Contas a receber por cliente</h2>
            <div className="chart-box">
              {receivablesChartData.length === 0 ? (
                <p className="muted">Sem lançamentos de contas a receber.</p>
              ) : null}
              {receivablesChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={receivablesChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="pending" fill="#1565c0" name="Pendente" />
                    <Bar dataKey="received" fill="#1f8d57" name="Recebido" />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>
        </div>

        <section className="panel">
          <div className="panel-header">
            <h2>Agenda Consolidada</h2>
            <label className="inline-filter">
              Status:
              <select
                value={filters.status}
                onChange={(event) => handleFilterChange(event.target.value)}
              >
                <option value="">Todos</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status] || status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Artista</th>
                  <th>Cliente</th>
                  <th>Serviço</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td>{item.artist_name}</td>
                    <td>{item.client_name}</td>
                    <td>{item.service_name}</td>
                    <td>{formatDateTime(item.start_at)}</td>
                    <td>
                      <StatusPill status={item.status} />
                    </td>
                    <td>
                      <select
                        defaultValue={item.status}
                        onChange={(event) => handleStatusChange(item.id, event.target.value)}
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status] || status}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="panel">
            <h2>Alertas de Estoque</h2>
            {stockAlerts.length === 0 ? <p>Sem alertas no momento.</p> : null}
            <ul className="list">
              {stockAlerts.map((alert) => (
                <li key={alert.id}>
                  <strong>
                    [{alert.item_type === "consumable" ? "Material" : "Produto"}] {alert.name}
                  </strong>
                  <span>
                    {alert.current_stock} em estoque (limite: {alert.min_stock})
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Últimos Pedidos da Loja</h2>
            <ul className="list">
              {orders.slice(0, 8).map((order) => (
                <li key={order.id}>
                  <strong>{formatOrderNumber(order)}</strong>
                  <span>
                    {order.client_name} - {formatCurrency(order.total_amount)}
                  </span>
                  <span>
                    {formatOrderPaymentMethod(order.payment_method)} - {formatDateTime(order.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
}

