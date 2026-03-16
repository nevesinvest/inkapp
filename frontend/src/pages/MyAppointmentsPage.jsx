import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { StatusPill } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { formatCurrency, formatDateTime } from "../utils/format";
import {
  isoToDateTimeLocalSaoPaulo,
  toDateInputSaoPaulo
} from "../utils/timezone";

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "completed", label: "Concluido" },
  { value: "cancelled", label: "Cancelado" }
];

function buildSlotKey(startAt, endAt) {
  return `${startAt}|${endAt}`;
}

function getSlotTimeLabel(isoDateTime) {
  const localDateTime = isoToDateTimeLocalSaoPaulo(isoDateTime);
  return String(localDateTime || "").slice(11, 16) || "--:--";
}

export function MyAppointmentsPage() {
  const { token } = useAuth();
  const { showConfirm } = useDialog();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [rescheduleTargetId, setRescheduleTargetId] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [selectedRescheduleSlotKey, setSelectedRescheduleSlotKey] = useState("");

  async function loadAppointments() {
    setError("");
    setLoading(true);
    try {
      const response = await api.request("/appointments/me", { token });
      const sorted = (Array.isArray(response) ? response : [])
        .slice()
        .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
      setAppointments(sorted);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
  }, [token]);

  const rescheduleTargetAppointment = useMemo(
    () =>
      appointments.find((appointment) => Number(appointment.id) === Number(rescheduleTargetId)) || null,
    [appointments, rescheduleTargetId]
  );

  useEffect(() => {
    async function loadRescheduleSlots() {
      if (!rescheduleTargetAppointment || !rescheduleDate) {
        setRescheduleSlots([]);
        setSelectedRescheduleSlotKey("");
        return;
      }

      const durationMs =
        new Date(rescheduleTargetAppointment.end_at).getTime() -
        new Date(rescheduleTargetAppointment.start_at).getTime();
      const durationMinutes = Math.max(30, Math.round(durationMs / (60 * 1000)));

      setRescheduleLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          artistId: String(rescheduleTargetAppointment.artist_id),
          date: rescheduleDate,
          durationMinutes: String(durationMinutes),
          excludeAppointmentId: String(rescheduleTargetAppointment.id)
        });
        const response = await api.request(`/appointments/availability?${query.toString()}`);
        const slots = Array.isArray(response?.slots)
          ? response.slots.map((slot) => ({
            ...slot,
            key: buildSlotKey(slot.startAt, slot.endAt),
            label: `${getSlotTimeLabel(slot.startAt)} - ${getSlotTimeLabel(slot.endAt)}`
          }))
          : [];
        setRescheduleSlots(slots);

        const currentSlotKey = buildSlotKey(
          rescheduleTargetAppointment.start_at,
          rescheduleTargetAppointment.end_at
        );
        const hasCurrentSlot = slots.some((slot) => slot.key === currentSlotKey);
        if (hasCurrentSlot) {
          setSelectedRescheduleSlotKey(currentSlotKey);
        } else {
          setSelectedRescheduleSlotKey(slots[0]?.key || "");
        }
      } catch (requestError) {
        setError(requestError.message);
        setRescheduleSlots([]);
        setSelectedRescheduleSlotKey("");
      } finally {
        setRescheduleLoading(false);
      }
    }

    loadRescheduleSlots();
  }, [rescheduleTargetAppointment, rescheduleDate]);

  function openReschedule(appointment) {
    if (!appointment) return;
    if (appointment.status === "cancelled" || appointment.status === "completed") return;

    setError("");
    setSuccess("");
    setRescheduleTargetId(appointment.id);
    setRescheduleDate(toDateInputSaoPaulo(appointment.start_at));
  }

  function closeReschedule() {
    setRescheduleTargetId(null);
    setRescheduleDate("");
    setRescheduleSlots([]);
    setSelectedRescheduleSlotKey("");
    setRescheduleLoading(false);
  }

  async function submitReschedule() {
    if (!rescheduleTargetAppointment) {
      setError("Selecione um agendamento para reagendar.");
      return;
    }

    const selectedSlot = rescheduleSlots.find((slot) => slot.key === selectedRescheduleSlotKey);
    if (!selectedSlot) {
      setError("Selecione um novo horario disponivel.");
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      await api.request(`/appointments/${rescheduleTargetAppointment.id}/reschedule`, {
        method: "PATCH",
        token,
        body: {
          startAt: selectedSlot.startAt,
          endAt: selectedSlot.endAt
        }
      });
      closeReschedule();
      await loadAppointments();
      setSuccess("Agendamento reagendado com sucesso. O novo horario ficou pendente de confirmacao.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelAppointment(appointment) {
    if (!appointment) return;
    if (appointment.status === "cancelled" || appointment.status === "completed") return;

    const confirmed = await showConfirm({
      title: "Cancelar agendamento",
      message: "Deseja realmente cancelar este agendamento?",
      confirmLabel: "Cancelar agendamento",
      cancelLabel: "Voltar"
    });
    if (!confirmed) return;

    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      await api.request(`/appointments/${appointment.id}/status`, {
        method: "PATCH",
        token,
        body: {
          status: "cancelled"
        }
      });
      if (Number(rescheduleTargetId) === Number(appointment.id)) {
        closeReschedule();
      }
      await loadAppointments();
      setSuccess("Agendamento cancelado com sucesso.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActionLoading(false);
    }
  }

  const { upcomingCount, filteredAppointments } = useMemo(() => {
    const now = Date.now();
    const upcoming = appointments.filter((item) => {
      if (!item?.start_at) return false;
      if (String(item.status || "").toLowerCase() === "cancelled") return false;
      return new Date(item.start_at).getTime() >= now;
    });

    let filtered =
      statusFilter === "all"
        ? appointments
        : appointments.filter((item) => String(item.status || "").toLowerCase() === statusFilter);

    filtered = filtered.filter((item) => {
      if (!item?.start_at) return false;

      const appointmentDate = toDateInputSaoPaulo(item.start_at);
      if (dateFromFilter && appointmentDate < dateFromFilter) return false;
      if (dateToFilter && appointmentDate > dateToFilter) return false;
      return true;
    });

    return {
      upcomingCount: upcoming.length,
      filteredAppointments: filtered
    };
  }, [appointments, statusFilter, dateFromFilter, dateToFilter]);

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Meus agendamentos</h1>
          <p>Consulte aqui seus horarios ja agendados no estudio.</p>
          <div className="table-actions">
            <Link className="button button-outline" to="/agendar">
              Novo agendamento
            </Link>
            <button className="button button-outline" onClick={loadAppointments} type="button">
              Atualizar lista
            </button>
          </div>
        </div>

        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={success} type="success" />

        <section className="panel">
          <div className="panel-header">
            <h2>Horarios agendados</h2>
            <div className="table-actions">
              <label className="inline-filter">
                Status:
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {STATUS_FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-filter">
                Data inicial:
                <input
                  type="date"
                  value={dateFromFilter}
                  onChange={(event) => setDateFromFilter(event.target.value)}
                  max={dateToFilter || undefined}
                />
              </label>

              <label className="inline-filter">
                Data final:
                <input
                  type="date"
                  value={dateToFilter}
                  onChange={(event) => setDateToFilter(event.target.value)}
                  min={dateFromFilter || undefined}
                />
              </label>

              <button
                className="button button-outline small"
                onClick={() => {
                  setDateFromFilter("");
                  setDateToFilter("");
                }}
                type="button"
                disabled={!dateFromFilter && !dateToFilter}
              >
                Limpar periodo
              </button>
            </div>
          </div>

          <p className="muted">
            {upcomingCount} agendamento(s) futuro(s) ativo(s) encontrado(s).
          </p>

          {loading ? <p>Carregando seus agendamentos...</p> : null}

          {!loading && filteredAppointments.length === 0 ? (
            <p className="muted">Nenhum agendamento encontrado para o filtro selecionado.</p>
          ) : null}

          {!loading && filteredAppointments.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Data e horario</th>
                    <th>Tatuador</th>
                    <th>Servico</th>
                    <th>Status</th>
                    <th>Sinal</th>
                    <th>Valor total</th>
                    <th>Observacoes</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.map((appointment) => {
                    const isLocked =
                      actionLoading ||
                      appointment.status === "cancelled" ||
                      appointment.status === "completed";

                    return (
                      <tr key={appointment.id}>
                        <td>#{appointment.id}</td>
                        <td>
                          {formatDateTime(appointment.start_at)} ate {formatDateTime(appointment.end_at)}
                        </td>
                        <td>{appointment.artist_name || "-"}</td>
                        <td>{appointment.service_name || "-"}</td>
                        <td>
                          <StatusPill status={appointment.status} />
                        </td>
                        <td>{formatCurrency(appointment.deposit_paid || 0)}</td>
                        <td>{formatCurrency(appointment.total_value ?? appointment.service_price ?? 0)}</td>
                        <td>{appointment.notes || "-"}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="button button-outline small"
                              type="button"
                              onClick={() => openReschedule(appointment)}
                              disabled={isLocked}
                            >
                              Reagendar
                            </button>
                            <button
                              className="button button-outline small"
                              type="button"
                              onClick={() => cancelAppointment(appointment)}
                              disabled={isLocked}
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {rescheduleTargetAppointment ? (
            <div className="form inline-form">
              <h3>Reagendar agendamento #{rescheduleTargetAppointment.id}</h3>
              <div className="grid-2">
                <label>
                  Data
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(event) => setRescheduleDate(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Tatuador
                  <input type="text" value={rescheduleTargetAppointment.artist_name || "-"} readOnly />
                </label>
              </div>

              <div>
                <p className="slots-title">Horarios disponiveis</p>
                {rescheduleLoading ? <p>Consultando disponibilidade...</p> : null}
                {!rescheduleLoading && rescheduleSlots.length === 0 ? (
                  <p className="muted">Nenhum horario disponivel para a data selecionada.</p>
                ) : null}
                <div className="slots-grid">
                  {rescheduleSlots.map((slot) => (
                    <button
                      key={slot.key}
                      className={`slot-button ${selectedRescheduleSlotKey === slot.key ? "selected" : ""}`}
                      onClick={() => setSelectedRescheduleSlotKey(slot.key)}
                      type="button"
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="table-actions">
                <button
                  className="button button-primary small"
                  type="button"
                  onClick={submitReschedule}
                  disabled={actionLoading || rescheduleLoading || !selectedRescheduleSlotKey}
                >
                  {actionLoading ? "Salvando..." : "Salvar novo horario"}
                </button>
                <button
                  className="button button-outline small"
                  type="button"
                  onClick={closeReschedule}
                  disabled={actionLoading}
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
