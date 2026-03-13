import { useEffect, useState } from "react";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";

const initialForm = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  smtpReplyTo: "",
  wppConnectEnabled: false,
  wppConnectApiUrl: "",
  wppConnectSession: "",
  wppConnectToken: "",
  wppConnectSecretKey: "",
  wppConnectSendPath: "/api/{session}/send-message",
  wppConnectStatusPath: "/api/{session}/check-connection-session"
};

function isWppConnectedPayload(payload) {
  if (!payload || typeof payload !== "object") return false;

  if (typeof payload.status === "boolean") {
    return payload.status;
  }

  const statusText = String(payload.status || payload.message || payload.state || "")
    .trim()
    .toLowerCase();

  if (!statusText) return false;
  if (statusText.includes("connected")) return true;
  if (statusText.includes("open")) return true;

  return false;
}

function getWppStatusSnapshot(wppResult, wppAssistantResult) {
  if (wppAssistantResult?.statusCheck) {
    return wppAssistantResult.statusCheck;
  }
  return wppResult || null;
}

function buildWppConnectionNotice({ enabled, wppResult, wppAssistantResult, checking }) {
  if (checking) {
    return {
      type: "info",
      message: "Verificando status do WhatsApp..."
    };
  }

  if (!enabled) {
    return {
      type: "info",
      message: "Envio por WhatsApp esta desativado nas configuracoes."
    };
  }

  const statusSnapshot = getWppStatusSnapshot(wppResult, wppAssistantResult);
  const hasQrCode = Boolean(wppAssistantResult?.qrCode?.qrCodeDataUrl);

  if (!statusSnapshot) {
    return {
      type: "warning",
      message:
        'Status ainda nao verificado. Clique em "Carregar WPP" para validar a conexao ou use o "Assistente WPP (QR Code)".'
    };
  }

  if (!statusSnapshot.ok) {
    return {
      type: "error",
      message:
        "Nao foi possivel validar a conexao com o WhatsApp. Revise URL, token, secret e tente novamente no Assistente WPP."
    };
  }

  if (isWppConnectedPayload(statusSnapshot.payload)) {
    return {
      type: "success",
      message: "WhatsApp conectado e funcionando. O envio por WhatsApp esta pronto para uso."
    };
  }

  if (hasQrCode) {
    return {
      type: "warning",
      message: "WhatsApp desconectado. Escaneie o QR Code exibido abaixo para reconectar."
    };
  }

  return {
    type: "warning",
    message: 'WhatsApp desconectado. Clique em "Assistente WPP (QR Code)" para gerar QR e reconectar.'
  };
}

export function SettingsPage() {
  const { token } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingWpp, setLoadingWpp] = useState(false);
  const [checkingWppStatus, setCheckingWppStatus] = useState(false);
  const [runningAssistant, setRunningAssistant] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [wppResult, setWppResult] = useState(null);
  const [wppAssistantResult, setWppAssistantResult] = useState(null);

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      setError("");
      try {
        const data = await api.request("/settings/integrations", { token });
        setForm((prev) => ({
          ...prev,
          ...data
        }));

        if (data?.wppConnectEnabled) {
          setCheckingWppStatus(true);
          try {
            const response = await api.request("/settings/integrations/load-wpp", {
              method: "POST",
              token,
              body: data
            });
            setWppResult(response?.result || null);
          } catch (requestError) {
            setWppResult(requestError?.payload?.result || null);
          } finally {
            setCheckingWppStatus(false);
          }
        }
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, [token]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.request("/settings/integrations", {
        method: "PUT",
        token,
        body: form
      });
      setForm((prev) => ({
        ...prev,
        ...(response?.settings || {})
      }));
      setSuccess(response?.message || "Configuracoes salvas com sucesso.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadWpp() {
    setLoadingWpp(true);
    setCheckingWppStatus(true);
    setError("");
    setSuccess("");
    setWppResult(null);

    try {
      const response = await api.request("/settings/integrations/load-wpp", {
        method: "POST",
        token,
        body: form
      });
      setWppResult(response?.result || null);
      setSuccess(response?.message || "WPP Connect carregado com sucesso.");
    } catch (requestError) {
      setWppResult(requestError?.payload?.result || null);
      setError(requestError.message);
    } finally {
      setLoadingWpp(false);
      setCheckingWppStatus(false);
    }
  }

  async function handleRunWppAssistant() {
    setRunningAssistant(true);
    setError("");
    setSuccess("");
    setWppResult(null);
    setWppAssistantResult(null);

    try {
      const response = await api.request("/settings/integrations/wpp/connect-assistant", {
        method: "POST",
        token,
        body: form
      });
      const assistantResult = response?.result || null;
      setWppAssistantResult(assistantResult);

      if (assistantResult?.settingsPatch) {
        setForm((prev) => ({
          ...prev,
          ...assistantResult.settingsPatch
        }));
      }

      setSuccess(response?.message || "Assistente WPP executado com sucesso.");
    } catch (requestError) {
      setWppAssistantResult(requestError?.payload?.result || null);
      setError(requestError.message);
    } finally {
      setRunningAssistant(false);
    }
  }

  const wppConnectionNotice = buildWppConnectionNotice({
    enabled: Boolean(form.wppConnectEnabled),
    wppResult,
    wppAssistantResult,
    checking: checkingWppStatus
  });

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Configuracoes</h1>
          <p>Configure o WPP Connect e o e-mail de origem para respostas de orcamento.</p>
        </div>

        <section className={`panel wpp-connection-status ${wppConnectionNotice.type}`}>
          <h2>Status da Conexao WhatsApp</h2>
          <p>{wppConnectionNotice.message}</p>
        </section>

        <section className="panel">
          {loading ? <p>Carregando configuracoes...</p> : null}

          <form className="form" onSubmit={handleSave}>
            <h2>E-mail de Orcamento</h2>
            <p className="muted">
              Configure aqui o servidor SMTP usado para envio dos e-mails de orcamento.
            </p>
            <div className="grid-2">
              <label>
                Servidor SMTP (host)
                <input
                  type="text"
                  placeholder="smtp.seudominio.com"
                  value={form.smtpHost || ""}
                  onChange={(event) => updateField("smtpHost", event.target.value)}
                />
              </label>
              <label>
                Porta SMTP
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.smtpPort ?? 587}
                  onChange={(event) => updateField("smtpPort", event.target.value)}
                />
              </label>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={Boolean(form.smtpSecure)}
                onChange={(event) => updateField("smtpSecure", event.target.checked)}
              />
              Usar SSL/TLS (conexao segura)
            </label>
            <div className="grid-2">
              <label>
                Usuario SMTP
                <input
                  type="text"
                  value={form.smtpUser || ""}
                  onChange={(event) => updateField("smtpUser", event.target.value)}
                />
              </label>
              <label>
                Senha SMTP
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.smtpPass || ""}
                  onChange={(event) => updateField("smtpPass", event.target.value)}
                />
              </label>
            </div>
            <div className="grid-2">
              <label>
                E-mail de origem (From)
                <input
                  type="email"
                  value={form.smtpFrom || ""}
                  onChange={(event) => updateField("smtpFrom", event.target.value)}
                />
              </label>
              <label>
                E-mail de resposta (Reply-To)
                <input
                  type="email"
                  value={form.smtpReplyTo || ""}
                  onChange={(event) => updateField("smtpReplyTo", event.target.value)}
                />
              </label>
            </div>

            <h2>WPP Connect</h2>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={Boolean(form.wppConnectEnabled)}
                onChange={(event) => updateField("wppConnectEnabled", event.target.checked)}
              />
              Ativar envio por WhatsApp
            </label>

            <div className="grid-2">
              <label>
                URL da API WPP Connect
                <input
                  type="url"
                  placeholder="http://localhost:21465"
                  value={form.wppConnectApiUrl || ""}
                  onChange={(event) => updateField("wppConnectApiUrl", event.target.value)}
                />
              </label>
              <label>
                Nome da sessao
                <input
                  type="text"
                  placeholder="inkapp"
                  value={form.wppConnectSession || ""}
                  onChange={(event) => updateField("wppConnectSession", event.target.value)}
                />
              </label>
            </div>

            <div className="grid-2">
              <label>
                Token da API
                <input
                  type="text"
                  value={form.wppConnectToken || ""}
                  onChange={(event) => updateField("wppConnectToken", event.target.value)}
                />
              </label>
              <label>
                Secret Key
                <input
                  type="text"
                  value={form.wppConnectSecretKey || ""}
                  onChange={(event) => updateField("wppConnectSecretKey", event.target.value)}
                />
              </label>
            </div>

            <div className="grid-2">
              <label>
                Caminho de envio
                <input
                  type="text"
                  value={form.wppConnectSendPath || ""}
                  onChange={(event) => updateField("wppConnectSendPath", event.target.value)}
                />
              </label>
              <label>
                Caminho de status/carregamento
                <input
                  type="text"
                  value={form.wppConnectStatusPath || ""}
                  onChange={(event) => updateField("wppConnectStatusPath", event.target.value)}
                />
              </label>
            </div>

            <FeedbackMessage message={error} type="error" />
            <FeedbackMessage message={success} type="success" />

            <div className="table-actions">
              <button className="button button-primary" type="submit" disabled={saving || loading}>
                {saving ? "Salvando..." : "Salvar configuracoes"}
              </button>
              <button
                className="button button-outline"
                type="button"
                onClick={handleLoadWpp}
                disabled={loadingWpp || runningAssistant || saving || loading}
              >
                {loadingWpp ? "Carregando WPP..." : "Carregar WPP"}
              </button>
              <button
                className="button button-outline"
                type="button"
                onClick={handleRunWppAssistant}
                disabled={runningAssistant || loadingWpp || saving || loading}
              >
                {runningAssistant ? "Executando assistente..." : "Assistente WPP (QR Code)"}
              </button>
            </div>
            <p className="muted">
              O botao Carregar WPP testa com os valores atuais do formulario, mesmo sem salvar.
            </p>
            <p className="muted">
              O Assistente WPP gera token (se necessario), inicia sessao e tenta buscar QR Code automaticamente.
            </p>
          </form>
        </section>

        {wppResult ? (
          <section className="panel">
            <h2>Resultado do WPP</h2>
            <pre>{JSON.stringify(wppResult, null, 2)}</pre>
          </section>
        ) : null}

        {wppAssistantResult ? (
          <section className="panel">
            <h2>Assistente de Conexao WPP</h2>
            {wppAssistantResult?.tokenGenerated ? (
              <p className="muted">
                Token gerado automaticamente, salvo nas configuracoes e aplicado no formulario.
              </p>
            ) : null}
            {wppAssistantResult?.qrCode?.qrCodeDataUrl ? (
              <div className="wpp-qr-wrapper">
                <img src={wppAssistantResult.qrCode.qrCodeDataUrl} alt="QR Code para conectar WhatsApp" />
                <p className="muted">
                  Escaneie este QR no WhatsApp: Dispositivos conectados {'>'} Conectar dispositivo.
                </p>
              </div>
            ) : (
              <p className="muted">
                QR Code ainda nao disponivel. Clique novamente em Assistente WPP em alguns segundos.
              </p>
            )}
            <pre>{JSON.stringify(wppAssistantResult, null, 2)}</pre>
          </section>
        ) : null}
      </div>
    </section>
  );
}
