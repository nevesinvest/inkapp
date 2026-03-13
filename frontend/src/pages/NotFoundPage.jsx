import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="section">
      <div className="container not-found">
        <h1>404</h1>
        <p>Página não encontrada.</p>
        <Link className="button button-primary" to="/">
          Voltar para home
        </Link>
      </div>
    </section>
  );
}
