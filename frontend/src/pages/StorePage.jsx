import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateTime } from "../utils/format";

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Dinheiro" },
  { value: "credit_card", label: "Cartao de Credito" },
  { value: "debit_card", label: "Cartao de Debito" },
  { value: "pix", label: "Pix" }
];

function paymentMethodLabel(value) {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === value)?.label || value;
}

function formatOrderNumber(order) {
  if (order?.order_number) return order.order_number;
  return String(Number(order?.id || 0)).padStart(6, "0");
}

export function StorePage() {
  const { token, isAuthenticated, user } = useAuth();
  const isManager = user?.role === "gerente";

  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [cashReceived, setCashReceived] = useState(0);

  const [cart, setCart] = useState({});
  const [lastOrder, setLastOrder] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadProducts() {
    try {
      const data = await api.request("/products");
      setProducts(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadClients() {
    if (!isManager || !token) return;
    try {
      const data = await api.request("/users?role=cliente", { token });
      setClients(data);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (!isManager) return;
    loadClients();
  }, [isManager, token]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, quantity]) => quantity > 0)
        .map(([productId, quantity]) => {
          const product = products.find((item) => item.id === Number(productId));
          return {
            productId: Number(productId),
            quantity,
            product
          };
        })
        .filter((item) => item.product),
    [cart, products]
  );

  const cartTotal = cartItems.reduce(
    (sum, item) => sum + Number(item.product.price) * item.quantity,
    0
  );

  const cashChange = useMemo(() => {
    if (paymentMethod !== "cash") return 0;
    return Math.max(Number(cashReceived || 0) - cartTotal, 0);
  }, [paymentMethod, cashReceived, cartTotal]);

  const hasCashShortage = paymentMethod === "cash" && Number(cashReceived || 0) < cartTotal;

  function updateQuantity(productId, delta) {
    const product = products.find((item) => item.id === Number(productId));
    if (!product) return;

    setCart((prev) => {
      const current = Number(prev[productId] || 0);
      const nextValue = Math.max(current + delta, 0);
      const boundedValue = Math.min(nextValue, Number(product.stock || 0));

      if (boundedValue <= 0) {
        const { [productId]: _removed, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [productId]: boundedValue
      };
    });
  }

  function clearCart() {
    setCart({});
  }

  async function handleCheckout() {
    if (submitting) return;
    setError("");
    setSuccess("");

    if (!isAuthenticated) {
      setError("Faca login para finalizar a compra.");
      return;
    }
    if (cartItems.length === 0) {
      setError("Adicione itens ao carrinho.");
      return;
    }
    if (isManager && !selectedClient) {
      setError("Selecione o cliente para concluir a venda.");
      return;
    }
    if (hasCashShortage) {
      setError("Valor recebido em dinheiro nao pode ser menor que o total.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        items: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        paymentMethod
      };

      if (isManager) {
        payload.clientId = Number(selectedClient);
      }
      if (paymentMethod === "cash") {
        payload.paidAmount = Number(cashReceived || 0);
      }

      const order = await api.request("/orders", {
        method: "POST",
        token,
        body: payload
      });

      const orderNumber = formatOrderNumber(order);
      setSuccess(`Pedido ${orderNumber} gerado com sucesso. Feche a venda no modulo Caixa.`);
      setLastOrder(order);
      setCart({});
      if (paymentMethod === "cash") {
        setCashReceived(0);
      }
      loadProducts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section">
      <div className="container store-layout">
        <div>
          <div className="page-heading">
            <h1>Loja InkApp</h1>
            <p>Catalogo integrado com baixa automatica de estoque.</p>
          </div>

          {loading ? <p>Carregando produtos...</p> : null}
          <div className="card-grid card-grid-3">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <img src={product.image_url} alt={product.name} />
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.category}</p>
                  <small>Estoque: {product.stock}</small>
                  <strong>{formatCurrency(product.price)}</strong>
                </div>
                <div className="product-actions">
                  <button
                    className="button button-outline small"
                    onClick={() => updateQuantity(product.id, -1)}
                    type="button"
                  >
                    -
                  </button>
                  <span>{cart[product.id] || 0}</span>
                  <button
                    className="button button-outline small"
                    onClick={() => updateQuantity(product.id, 1)}
                    type="button"
                    disabled={product.stock <= (cart[product.id] || 0)}
                  >
                    +
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="cart-sidebar">
          <h2>Carrinho</h2>
          {cartItems.length === 0 ? <p>Nenhum item selecionado.</p> : null}
          {cartItems.map((item) => (
            <div className="cart-item" key={item.productId}>
              <div>
                <strong>{item.product.name}</strong>
                <span>
                  {item.quantity} x {formatCurrency(item.product.price)}
                </span>
              </div>
              <div className="cart-item-actions">
                <strong>{formatCurrency(item.quantity * item.product.price)}</strong>
                <button
                  className="button button-outline small"
                  onClick={() => updateQuantity(item.productId, -item.quantity)}
                  type="button"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
          <hr />
          <p className="cart-total">
            Total: <strong>{formatCurrency(cartTotal)}</strong>
          </p>

          <div className="cart-checkout-form">
            {isManager ? (
              <label className="cart-field">
                Cliente
                <select
                  value={selectedClient}
                  onChange={(event) => setSelectedClient(event.target.value)}
                  required
                >
                  <option value="">Selecione o cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} ({client.email})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="cart-field">
              Forma de pagamento
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {paymentMethod === "cash" ? (
              <>
                <label className="cart-field">
                  Valor recebido
                  <CurrencyInput
                    min={0}
                    onValueChange={setCashReceived}
                    value={cashReceived}
                  />
                </label>
                <p className="cart-change">
                  Troco: <strong>{formatCurrency(cashChange)}</strong>
                </p>
                {hasCashShortage ? (
                  <p className="cart-warning">
                    O valor recebido em dinheiro precisa ser maior ou igual ao total.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          {!isAuthenticated ? (
            <p className="muted">
              Para finalizar, <Link to="/login">entre na sua conta</Link>.
            </p>
          ) : null}

          <FeedbackMessage message={error} type="error" />
          <FeedbackMessage message={success} type="success" />

          <div className="cart-actions">
            <button className="button button-outline full" onClick={clearCart} type="button">
              Limpar carrinho
            </button>
            <button
              className="button button-primary full"
              onClick={handleCheckout}
              type="button"
              disabled={submitting || cartItems.length === 0 || hasCashShortage}
            >
              {submitting ? "Gerando..." : "Gerar pedido"}
            </button>
          </div>

          {lastOrder ? (
            <div className="cart-last-order">
              <strong>Ultimo pedido gerado</strong>
              <span>Pedido: {formatOrderNumber(lastOrder)}</span>
              <span>Pagamento: {paymentMethodLabel(lastOrder.payment_method)}</span>
              <span>Total: {formatCurrency(lastOrder.total_amount)}</span>
              {Number(lastOrder.change_amount || 0) > 0 ? (
                <span>Troco: {formatCurrency(lastOrder.change_amount)}</span>
              ) : null}
              <span>Data: {formatDateTime(lastOrder.created_at)}</span>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
