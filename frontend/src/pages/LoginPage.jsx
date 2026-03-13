import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";

const demoAccounts = [
  { label: "Gerente", email: "gerente@inkapp.local", password: "123456" },
  { label: "Tatuador", email: "luna@inkapp.local", password: "123456" },
  { label: "Cliente", email: "cliente@inkapp.local", password: "123456" }
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({
    email: "",
    password: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function setDemo(account) {
    setForm({
      email: account.email,
      password: account.password
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.request("/auth/login", {
        method: "POST",
        body: form
      });
      login(data);
      if (data.user.role === "gerente") {
        navigate("/painel-gerente");
      } else if (data.user.role === "tatuador") {
        navigate("/painel-tatuador");
      } else {
        navigate("/");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="section">
      <div className="container auth-grid">
        <div className="auth-panel">
          <h1>Acesse sua conta</h1>
          <p>Entre para gerenciar agenda, orçamento, estoque e finanças.</p>
          <form className="form" onSubmit={handleSubmit}>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
                required
              />
            </label>
            <FeedbackMessage message={error} type="error" />
            <button className="button button-primary" disabled={loading} type="submit">
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        <aside className="auth-side">
          <h2>Contas de demonstração</h2>
          <p>Clique para preencher automaticamente.</p>
          <div className="demo-list">
            {demoAccounts.map((account) => (
              <button
                key={account.label}
                className="demo-item"
                onClick={() => setDemo(account)}
                type="button"
              >
                <strong>{account.label}</strong>
                <span>{account.email}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
