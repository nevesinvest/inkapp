import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";

export function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    role: "cliente",
    style: "",
    bio: "",
    commissionPercentage: "0"
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone,
        role: form.role,
        style: form.role === "tatuador" ? form.style : undefined,
        bio: form.role === "tatuador" ? form.bio : undefined,
        commissionPercentage: form.role === "tatuador" ? form.commissionPercentage : undefined
      };

      const data = await api.request("/auth/register", {
        method: "POST",
        body: payload
      });
      login(data);
      navigate("/");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="section">
      <div className="container auth-grid single">
        <div className="auth-panel">
          <h1>Criar conta no InkApp</h1>
          <p>Cadastre cliente ou tatuador para começar a usar o sistema.</p>
          <form className="form" onSubmit={handleSubmit}>
            <label>
              Nome
              <input
                type="text"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                required
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                minLength={6}
                value={form.password}
                onChange={(event) => updateField("password", event.target.value)}
                required
              />
            </label>
            <label>
              Telefone
              <input
                type="text"
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            </label>
            <label>
              Perfil
              <select
                value={form.role}
                onChange={(event) => updateField("role", event.target.value)}
              >
                <option value="cliente">Cliente</option>
                <option value="tatuador">Tatuador</option>
              </select>
            </label>

            {form.role === "tatuador" ? (
              <>
                <label>
                  Estilo principal
                  <input
                    type="text"
                    value={form.style}
                    onChange={(event) => updateField("style", event.target.value)}
                    placeholder="Ex: Blackwork / Fine line"
                  />
                </label>
                <label>
                  Bio
                  <textarea
                    rows={4}
                    value={form.bio}
                    onChange={(event) => updateField("bio", event.target.value)}
                  />
                </label>
                <label>
                  Percentual de comissão (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={form.commissionPercentage}
                    onChange={(event) => updateField("commissionPercentage", event.target.value)}
                  />
                </label>
              </>
            ) : null}

            <FeedbackMessage message={error} type="error" />
            <button className="button button-primary" disabled={loading} type="submit">
              {loading ? "Criando..." : "Criar conta"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
