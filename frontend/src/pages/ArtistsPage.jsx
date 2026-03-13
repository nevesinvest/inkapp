import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { SectionTitle } from "../components/SectionTitle";

export function ArtistsPage() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadArtists() {
      try {
        const data = await api.request("/artists");
        setArtists(data);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    }

    loadArtists();
  }, []);

  return (
    <section className="section">
      <div className="container">
        <SectionTitle
          eyebrow="Artistas"
          title="Perfis completos da equipe"
          subtitle="Escolha um artista e siga para o agendamento com pré-seleção automática."
        />

        {loading ? <p>Carregando artistas...</p> : null}
        <FeedbackMessage message={error} type="error" />

        <div className="card-grid card-grid-3">
          {artists.map((artist) => (
            <article className="artist-card large" key={artist.id}>
              <img src={artist.avatar_url} alt={artist.name} />
              <div>
                <h3>{artist.name}</h3>
                <p>{artist.style}</p>
                <p>{artist.bio}</p>
                <Link className="button button-outline" to={`/artistas/${artist.id}`}>
                  Ver perfil
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
