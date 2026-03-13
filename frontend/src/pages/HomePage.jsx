import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { SectionTitle } from "../components/SectionTitle";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/format";

export function HomePage() {
  const { user, token } = useAuth();
  const [homeData, setHomeData] = useState(null);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const data = await api.request("/public/home");
        setHomeData(data);
      } catch (requestError) {
        setError(requestError.message);
      }
    }

    loadData();
  }, []);

  useEffect(() => {
    async function loadFinance() {
      if (user?.role !== "gerente" || !token) return;
      try {
        const summary = await api.request("/finance/summary?period=monthly", { token });
        setFinanceSummary(summary);
      } catch (_error) {
        setFinanceSummary(null);
      }
    }

    loadFinance();
  }, [user, token]);

  if (error) {
    return <div className="container page-error">Erro ao carregar a home: {error}</div>;
  }
  if (!homeData) {
    return <div className="container page-loading">Carregando home...</div>;
  }

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-backdrop" />
        <div className="container hero-content">
          <p className="hero-kicker">Sistema Integrado para Estúdios</p>
          <h1>InkApp</h1>
          <p>{homeData.hero.subtitle}</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/agendar">
              {homeData.hero.ctaPrimary}
            </Link>
            <Link className="button button-outline hero-secondary-button" to="/loja">
              {homeData.hero.ctaSecondary}
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionTitle
            eyebrow="Portfólio de Artistas"
            title="Conheça o time criativo do estúdio"
            subtitle="Perfis completos com estilos, especialidades e trabalhos."
          />
          <div className="card-grid card-grid-3">
            {homeData.artists.map((artist) => (
              <article className="artist-card" key={artist.id}>
                <img src={artist.avatar_url} alt={artist.name} />
                <div>
                  <h3>{artist.name}</h3>
                  <p>{artist.style}</p>
                  <Link className="text-link" to={`/artistas/${artist.id}`}>
                    Ver perfil
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {user?.role === "gerente" && financeSummary ? (
        <section className="section section-contrast">
          <div className="container">
            <SectionTitle
              eyebrow="Painel Diretoria"
              title="Visão mensal do estúdio"
              subtitle="Bloco visível somente para perfil gerente."
            />
            <div className="metrics-grid">
              <MetricCard label="Faturamento" value={formatCurrency(financeSummary.revenue)} />
              <MetricCard label="Despesas" value={formatCurrency(financeSummary.expenses)} />
              <MetricCard
                label="Lucro"
                value={formatCurrency(financeSummary.profit)}
                hint={`Período: ${financeSummary.period}`}
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="container">
          <SectionTitle
            eyebrow="Loja Integrada"
            title="Produtos do estúdio com estoque em tempo real"
            subtitle="Pomadas, vestuário e arte dos tatuadores."
          />
          <div className="card-grid card-grid-3">
            {homeData.products.map((product) => (
              <article className="product-card" key={product.id}>
                <img src={product.image_url} alt={product.name} />
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.category}</p>
                  <strong>{formatCurrency(product.price)}</strong>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-contrast">
        <div className="container">
          <SectionTitle
            eyebrow="Depoimentos"
            title="Experiências reais dos clientes"
            subtitle="Feedback pós-atendimento coletado pelo InkApp."
          />
          <div className="card-grid card-grid-3">
            {homeData.testimonials.map((testimonial) => (
              <article className="testimonial-card" key={testimonial.id}>
                <p>"{testimonial.message}"</p>
                <h4>{testimonial.client_name}</h4>
                <span>{Array.from({ length: testimonial.rating }).map(() => "★")}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
