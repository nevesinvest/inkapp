import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export function ArtistProfilePage() {
  const { id } = useParams();
  const [artist, setArtist] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadArtist() {
      try {
        const data = await api.request(`/artists/${id}`);
        setArtist(data);
      } catch (requestError) {
        setError(requestError.message);
      }
    }

    loadArtist();
  }, [id]);

  if (error) {
    return <div className="container page-error">{error}</div>;
  }
  if (!artist) {
    return <div className="container page-loading">Carregando perfil...</div>;
  }

  return (
    <section className="artist-profile">
      <div className="artist-banner">
        <img src={artist.banner_url} alt={artist.name} />
      </div>

      <div className="container artist-profile-content">
        <header className="artist-profile-header">
          <img className="artist-avatar" src={artist.avatar_url} alt={artist.name} />
          <div>
            <h1>{artist.name}</h1>
            <p>{artist.style}</p>
            <p>{artist.bio}</p>
            <Link className="button button-primary" to={`/agendar?artistId=${artist.id}`}>
              Agendar com {artist.name}
            </Link>
          </div>
        </header>

        <section className="section compact">
          <h2>Portfólio</h2>
          <div className="portfolio-grid">
            {artist.portfolio.map((item) => (
              <article key={item.id}>
                <img src={item.image_url} alt={item.title} />
                <h3>{item.title}</h3>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
