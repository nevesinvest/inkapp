import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { StatusPill } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "../utils/format";

const quoteStatuses = ["pending", "reviewing", "replied", "accepted", "rejected"];

const tattooStyles = [
  "Fine Line",
  "Blackwork",
  "Realismo",
  "Old School",
  "Neo Tradicional",
  "Aquarela",
  "Tribal",
  "Geometrica",
  "Oriental/Japonesa",
  "Pontilhismo",
  "Minimalista",
  "Lettering",
  "Outros"
];

const MAX_REFERENCE_IMAGES = 8;
const MAX_REFERENCE_IMAGE_SIZE = 2 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_IMAGE_SIZE = 10 * 1024 * 1024;

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatBrazilMobile(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizeBrazilMobile(value) {
  return onlyDigits(value).slice(0, 11);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler um dos arquivos selecionados."));
    reader.readAsDataURL(file);
  });
}

export function QuotesPage() {
  const { token, user } = useAuth();
  const isBackoffice = user?.role === "gerente" || user?.role === "tatuador";
  const fileInputRef = useRef(null);

  const [artists, setArtists] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    clientName: "",
    clientWhatsapp: "",
    clientEmail: "",
    description: "",
    style: "",
    bodyPart: "",
    sizeEstimate: "",
    preferredArtistId: "",
    referenceImages: []
  });

  async function loadQuotes() {
    if (!isBackoffice || !token) return;
    try {
      const data = await api.request("/quotes", { token });
      setQuotes(data);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    async function loadArtists() {
      try {
        const data = await api.request("/artists");
        setArtists(data);
      } catch (requestError) {
        setError(requestError.message);
      }
    }

    loadArtists();
    loadQuotes();
  }, [isBackoffice, token]);

  async function handleReferenceImagesChange(event) {
    setError("");
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      setForm((prev) => ({ ...prev, referenceImages: [] }));
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length !== files.length) {
      setError("Selecione apenas arquivos de imagem.");
    }

    const limitedFiles = imageFiles.slice(0, MAX_REFERENCE_IMAGES);
    if (imageFiles.length > MAX_REFERENCE_IMAGES) {
      setError(`Voce pode enviar no maximo ${MAX_REFERENCE_IMAGES} imagens.`);
    }

    if (limitedFiles.some((file) => file.size > MAX_REFERENCE_IMAGE_SIZE)) {
      setError("Cada imagem deve ter no maximo 2 MB.");
      return;
    }

    const totalSize = limitedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_REFERENCE_IMAGE_SIZE) {
      setError("O total das imagens deve ter no maximo 10 MB.");
      return;
    }

    try {
      const dataUrls = await Promise.all(limitedFiles.map((file) => readFileAsDataUrl(file)));
      const nextImages = limitedFiles.map((file, index) => ({
        name: file.name,
        dataUrl: dataUrls[index]
      }));
      setForm((prev) => ({ ...prev, referenceImages: nextImages }));
    } catch (uploadError) {
      setError(uploadError.message);
      setForm((prev) => ({ ...prev, referenceImages: [] }));
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    try {
      const normalizedWhatsapp = normalizeBrazilMobile(form.clientWhatsapp);
      if (normalizedWhatsapp.length !== 11) {
        throw new Error("Informe o WhatsApp completo no formato (99) 99999-9999.");
      }

      const normalizedEmail = String(form.clientEmail || "").trim();
      if (!normalizedEmail) {
        throw new Error("Informe um e-mail valido para contato.");
      }

      const payload = {
        clientName: form.clientName,
        clientContact: `WhatsApp: ${formatBrazilMobile(normalizedWhatsapp)} | E-mail: ${normalizedEmail}`,
        clientWhatsapp: form.clientWhatsapp,
        clientEmail: normalizedEmail,
        description: form.description,
        style: form.style,
        bodyPart: form.bodyPart,
        sizeEstimate: form.sizeEstimate,
        preferredArtistId: form.preferredArtistId || null,
        referenceImages: form.referenceImages.map((item) => item.dataUrl)
      };

      await api.request("/quotes", {
        method: "POST",
        body: payload
      });

      setSuccess("Orcamento enviado com sucesso. Em breve entraremos em contato.");
      setForm({
        clientName: "",
        clientWhatsapp: "",
        clientEmail: "",
        description: "",
        style: "",
        bodyPart: "",
        sizeEstimate: "",
        preferredArtistId: "",
        referenceImages: []
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadQuotes();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleQuoteUpdate(quoteId, payload) {
    try {
      await api.request(`/quotes/${quoteId}`, {
        method: "PATCH",
        token,
        body: payload
      });
      await loadQuotes();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Ferramenta de Orcamento</h1>
          <p>Envie referencias, tamanho, estilo e preferencia de artista.</p>
        </div>

        <form className="form quote-form" onSubmit={handleSubmit}>
          <div className="grid-2">
            <label>
              Nome
              <input
                type="text"
                value={form.clientName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, clientName: event.target.value }))
                }
                required
              />
            </label>
            <label>
              WhatsApp
              <input
                type="text"
                placeholder="(99) 99999-9999"
                value={form.clientWhatsapp}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    clientWhatsapp: formatBrazilMobile(event.target.value)
                  }))
                }
                required
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={form.clientEmail}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, clientEmail: event.target.value }))
                }
                required
              />
            </label>
          </div>

          <label>
            Descricao da ideia
            <textarea
              rows={4}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              required
            />
          </label>

          <div className="grid-3">
            <label>
              Estilo
              <select
                value={form.style}
                onChange={(event) => setForm((prev) => ({ ...prev, style: event.target.value }))}
                required
              >
                <option value="">Selecione</option>
                {tattooStyles.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Regiao do corpo
              <input
                type="text"
                value={form.bodyPart}
                onChange={(event) => setForm((prev) => ({ ...prev, bodyPart: event.target.value }))}
                required
              />
            </label>
            <label>
              Tamanho estimado (cm)
              <input
                type="text"
                value={form.sizeEstimate}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sizeEstimate: event.target.value }))
                }
                required
              />
            </label>
          </div>

          <label>
            Artista preferido
            <select
              value={form.preferredArtistId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, preferredArtistId: event.target.value }))
              }
            >
              <option value="">Indiferente</option>
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Imagens de referencia
            <input
              ref={fileInputRef}
              accept="image/*"
              multiple
              onChange={handleReferenceImagesChange}
              type="file"
            />
          </label>

          {form.referenceImages.length > 0 ? (
            <ul className="list">
              {form.referenceImages.map((image, index) => (
                <li key={`${image.name}-${index}`}>{image.name}</li>
              ))}
            </ul>
          ) : null}

          <FeedbackMessage message={error} type="error" />
          <FeedbackMessage message={success} type="success" />
          <button className="button button-primary" type="submit">
            Enviar orcamento
          </button>
        </form>

        {isBackoffice ? (
          <section className="section compact">
            <h2>Fila de orcamentos</h2>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Cliente</th>
                    <th>Artista</th>
                    <th>Status</th>
                    <th>Data</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>#{quote.id}</td>
                      <td>
                        <strong>{quote.client_name}</strong>
                        <p>{quote.client_contact}</p>
                      </td>
                      <td>{quote.preferred_artist_name || "Indiferente"}</td>
                      <td>
                        <StatusPill status={quote.status} />
                      </td>
                      <td>{formatDateTime(quote.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <select
                            defaultValue={quote.status}
                            onChange={(event) =>
                              handleQuoteUpdate(quote.id, { status: event.target.value })
                            }
                          >
                            {quoteStatuses.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                          <button
                            className="button button-outline small"
                            onClick={() =>
                              handleQuoteUpdate(quote.id, {
                                status: "replied",
                                response: "Orcamento analisado. Entre em contato para agenda."
                              })
                            }
                            type="button"
                          >
                            Responder
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
