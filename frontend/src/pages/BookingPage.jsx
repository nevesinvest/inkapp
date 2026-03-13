import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { StatusPill } from "../components/StatusPill";
import { useDialog } from "../context/DialogContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateTime } from "../utils/format";
import {
  addMinutesToDateTimeLocalSaoPaulo,
  dateTimeLocalSaoPauloToIso,
  isoToDateTimeLocalSaoPaulo,
  toDateInputSaoPaulo
} from "../utils/timezone";

const BOOKING_STATUS_OPTIONS = [
  { value: "pending", label: "Pendente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "completed", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" }
];

function parseBirthDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split("-").map((item) => Number(item));
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  const isValid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;

  return isValid ? date : null;
}

function getAgeFromBirthDate(value, today = new Date()) {
  const birthDate = parseBirthDate(value);
  if (!birthDate) return null;

  let age = today.getFullYear() - birthDate.getFullYear();
  const currentMonth = today.getMonth();
  const birthMonth = birthDate.getMonth();

  if (
    currentMonth < birthMonth ||
    (currentMonth === birthMonth && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return age;
}

export function BookingPage() {
  const { token, user } = useAuth();
  const { showAlert, showConfirm } = useDialog();
  const isManager = user?.role === "gerente";
  const [searchParams] = useSearchParams();

  const dateFromQuery = searchParams.get("date");
  const startFromQuery = searchParams.get("startAt");
  const endFromQuery = searchParams.get("endAt");
  const appointmentIdFromQuery = Number(searchParams.get("appointmentId") || 0);
  const isEditMode = isManager && Number.isInteger(appointmentIdFromQuery) && appointmentIdFromQuery > 0;

  const [artists, setArtists] = useState([]);
  const [services, setServices] = useState([]);
  const [clients, setClients] = useState([]);
  const [selfBirthDate, setSelfBirthDate] = useState("");
  const [editingAppointment, setEditingAppointment] = useState(null);

  const [selectedArtist, setSelectedArtist] = useState(searchParams.get("artistId") || "");
  const [selectedService, setSelectedService] = useState("");
  const [selectedClient, setSelectedClient] = useState("");

  const [selectedDate, setSelectedDate] = useState(dateFromQuery || toDateInputSaoPaulo());
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const defaultStart = startFromQuery
    ? isoToDateTimeLocalSaoPaulo(startFromQuery)
    : isoToDateTimeLocalSaoPaulo(new Date());
  const defaultEnd = endFromQuery
    ? isoToDateTimeLocalSaoPaulo(endFromQuery)
    : addMinutesToDateTimeLocalSaoPaulo(defaultStart, 60);
  const [manualStartAt, setManualStartAt] = useState(defaultStart);
  const [manualEndAt, setManualEndAt] = useState(defaultEnd);

  const [depositPaid, setDepositPaid] = useState(0);
  const [status, setStatus] = useState("pending");
  const [totalValue, setTotalValue] = useState(0);
  const [guardianName, setGuardianName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const selectedServiceData = useMemo(
    () => services.find((service) => String(service.id) === String(selectedService)),
    [services, selectedService]
  );
  const selectedClientData = useMemo(
    () => clients.find((client) => String(client.id) === String(selectedClient)),
    [clients, selectedClient]
  );
  const activeClientName = isManager ? selectedClientData?.name : user?.name;
  const activeClientBirthDate = isManager ? selectedClientData?.birth_date : selfBirthDate;
  const activeClientAge = useMemo(
    () => getAgeFromBirthDate(activeClientBirthDate),
    [activeClientBirthDate]
  );
  const isActiveClientMinor = activeClientAge !== null && activeClientAge < 18;

  useEffect(() => {
    async function loadInitialData() {
      try {
        const requests = [api.request("/artists"), api.request("/appointments/services")];
        if (isManager) {
          requests.push(api.request("/users?role=cliente", { token }));
        } else {
          requests.push(api.request("/users/me", { token }));
        }
        if (isEditMode) {
          requests.push(api.request(`/appointments/${appointmentIdFromQuery}`, { token }));
        }

        const response = await Promise.all(requests);
        const artistsData = response[0];
        const servicesData = response[1];
        let responseIndex = 2;

        setArtists(artistsData);
        setServices(servicesData);

        if (isManager) {
          const clientsData = response[responseIndex];
          responseIndex += 1;
          setClients(clientsData);
        } else {
          const meData = response[responseIndex];
          responseIndex += 1;
          setSelfBirthDate(meData.birth_date || meData.clientProfile?.birthDate || "");
        }

        if (isEditMode) {
          const appointmentData = response[responseIndex];
          setEditingAppointment(appointmentData);
          setSelectedArtist(String(appointmentData.artist_id));
          setSelectedService(String(appointmentData.service_id));
          setSelectedClient(String(appointmentData.client_id));
          setManualStartAt(isoToDateTimeLocalSaoPaulo(appointmentData.start_at));
          setManualEndAt(isoToDateTimeLocalSaoPaulo(appointmentData.end_at));
          setGuardianName(appointmentData.guardian_name || "");
          setNotes(appointmentData.notes || "");
          setDepositPaid(Number(appointmentData.deposit_paid || 0));
          setStatus(
            BOOKING_STATUS_OPTIONS.some((option) => option.value === appointmentData.status)
              ? appointmentData.status
              : "pending"
          );
          setTotalValue(Number(appointmentData.total_value ?? appointmentData.service_price ?? 0));
        }
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoadingEdit(false);
      }
    }

    if (isEditMode) {
      setLoadingEdit(true);
    }
    loadInitialData();
  }, [isManager, token, isEditMode, appointmentIdFromQuery]);

  useEffect(() => {
    if (!isEditMode && selectedServiceData) {
      setDepositPaid(selectedServiceData.deposit_amount);
      setTotalValue(selectedServiceData.price);
      setStatus("pending");
    }
  }, [selectedServiceData, isEditMode]);

  useEffect(() => {
    if (!isManager || isEditMode || !selectedServiceData || !manualStartAt) return;
    const startAtIso = dateTimeLocalSaoPauloToIso(manualStartAt);
    if (!startAtIso) return;
    const endDate = new Date(
      new Date(startAtIso).getTime() + selectedServiceData.duration_minutes * 60 * 1000
    );
    setManualEndAt(isoToDateTimeLocalSaoPaulo(endDate));
  }, [isManager, isEditMode, manualStartAt, selectedServiceData]);

  useEffect(() => {
    if (!isActiveClientMinor) {
      setGuardianName("");
    }
  }, [isActiveClientMinor]);

  useEffect(() => {
    async function loadAvailability() {
      if (isManager) return;
      if (!selectedArtist || !selectedServiceData || !selectedDate) {
        setSlots([]);
        return;
      }

      setLoadingSlots(true);
      setError("");

      try {
        const query = new URLSearchParams({
          artistId: selectedArtist,
          date: selectedDate,
          durationMinutes: String(selectedServiceData.duration_minutes)
        });
        const response = await api.request(`/appointments/availability?${query.toString()}`);
        setSlots(response.slots);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoadingSlots(false);
      }
    }

    loadAvailability();
  }, [isManager, selectedArtist, selectedServiceData, selectedDate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      const basePayload = {
        artistId: Number(selectedArtist),
        serviceId: Number(selectedService),
        notes,
        depositPaid: Number(depositPaid || 0),
        guardianName: isActiveClientMinor ? guardianName.trim() : null
      };

      let response = null;

      if (isActiveClientMinor) {
        if (!guardianName.trim()) {
          throw new Error("Informe o nome do responsável para cliente menor de 18 anos.");
        }
        await showAlert({
          title: "Cliente menor de idade",
          message: `Atenção: ${activeClientName || "cliente"} possui ${activeClientAge} anos e é menor de 18 anos.`
        });
      }

      if (isManager) {
        const startAt = dateTimeLocalSaoPauloToIso(manualStartAt);
        const endAt = dateTimeLocalSaoPauloToIso(manualEndAt);
        if (!startAt || !endAt) {
          throw new Error("Informe hora inicial e hora final.");
        }
        if (new Date(startAt) >= new Date(endAt)) {
          throw new Error("A hora final deve ser maior que a hora inicial.");
        }

        if (isEditMode) {
          response = await api.request(`/appointments/${appointmentIdFromQuery}/reschedule`, {
            method: "PATCH",
            token,
            body: {
              startAt,
              endAt,
              status,
              totalValue: Number(totalValue || 0)
            }
          });
        } else {
          if (!selectedClient) {
            throw new Error("Selecione o cliente.");
          }

          response = await api.request("/appointments", {
            method: "POST",
            token,
            body: {
              ...basePayload,
              clientId: Number(selectedClient),
              startAt,
              endAt,
              status,
              totalValue: Number(totalValue || 0)
            }
          });
        }
      } else {
        if (!selectedSlot) {
          throw new Error("Selecione um horário disponível.");
        }

        response = await api.request("/appointments", {
          method: "POST",
          token,
          body: {
            ...basePayload,
            startAt: selectedSlot.startAt,
            endAt: selectedSlot.endAt
          }
        });
      }

      setSuccess(
        isEditMode
          ? `Agendamento #${response.id} atualizado para ${formatDateTime(response.start_at)} até ${formatDateTime(response.end_at)}.`
          : `Agendamento #${response.id} criado: ${formatDateTime(response.start_at)} até ${formatDateTime(response.end_at)}.`
      );
      setSelectedSlot(null);
      if (!isEditMode) {
        setNotes("");
        setGuardianName("");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManagerStatusChange(nextStatus) {
    if (!isManager) return;
    if (!isEditMode) {
      setStatus(nextStatus);
      return;
    }
    if (!editingAppointment || nextStatus === status) return;

    const nextStatusLabel =
      BOOKING_STATUS_OPTIONS.find((option) => option.value === nextStatus)?.label || nextStatus;
    const confirmed = await showConfirm({
      title: "Confirmar alteracao de status",
      message: `Deseja alterar o status do agendamento para \"${nextStatusLabel}\"?`,
      confirmLabel: "Confirmar",
      cancelLabel: "Cancelar"
    });
    if (!confirmed) return;

    setUpdatingStatus(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.request(`/appointments/${appointmentIdFromQuery}/status`, {
        method: "PATCH",
        token,
        body: {
          status: nextStatus,
          totalValue: Number(totalValue || 0)
        }
      });

      setEditingAppointment(response);
      setStatus(response.status || nextStatus);
      setTotalValue(Number(response.total_value ?? totalValue));
      setSuccess(`Status atualizado para ${nextStatusLabel}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>Agenda</h1>
          <p>
            {isEditMode
              ? "Modo alteração: ajuste o intervalo de horário do agendamento."
              : isManager
                ? "Selecione tatuador, cliente, serviço e intervalo de horário."
                : "Escolha tatuador, serviço e um horário disponível."}
          </p>
          {isEditMode ? (
            <div className="service-summary">
              <span>Agendamento #{editingAppointment?.id || appointmentIdFromQuery}</span>
              <span>
                Status atual: <StatusPill status={status} />
              </span>
            </div>
          ) : null}
        </div>

        {loadingEdit ? <p>Carregando agendamento para edição...</p> : null}
        <FeedbackMessage
          message={
            isActiveClientMinor
              ? `Atenção: ${activeClientName || "cliente"} é menor de 18 anos (${activeClientAge} anos).`
              : ""
          }
          type="warning"
        />

        <form className="form booking-form" onSubmit={handleSubmit}>
          <div className="grid-2">
            <label>
              Tatuador
              <select
                value={selectedArtist}
                onChange={(event) => setSelectedArtist(event.target.value)}
                required
                disabled={isEditMode}
              >
                <option value="">Selecione</option>
                {artists.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artist.name} - {artist.style}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Serviço
              <select
                value={selectedService}
                onChange={(event) => setSelectedService(event.target.value)}
                required
                disabled={isEditMode}
              >
                <option value="">Selecione</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({service.duration_minutes} min)
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isManager ? (
            <>
              <div className="grid-2">
                <label>
                  Cliente
                  <select
                    value={selectedClient}
                    onChange={(event) => setSelectedClient(event.target.value)}
                    required
                    disabled={isEditMode}
                  >
                    <option value="">Selecione</option>
                    {clients.map((client) => {
                      const age = getAgeFromBirthDate(client.birth_date);
                      const isMinor = age !== null && age < 18;
                      return (
                        <option key={client.id} value={client.id}>
                          {client.name} ({client.email})
                          {isMinor ? ` - menor (${age} anos)` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Sinal a pagar (R$)
                  <CurrencyInput
                    disabled={isEditMode}
                    min={0}
                    onValueChange={setDepositPaid}
                    value={depositPaid}
                  />
                </label>
              </div>

              <div className="grid-2">
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(event) => {
                      void handleManagerStatusChange(event.target.value);
                    }}
                    disabled={updatingStatus}
                  >
                    {BOOKING_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {isEditMode ? (
                    <small className="muted">
                      {updatingStatus
                        ? "Atualizando status..."
                        : "Ao mudar o status, a confirmacao acontece na hora."}
                    </small>
                  ) : null}
                </label>
                <label>
                  Valor total (R$)
                  <CurrencyInput
                    min={0}
                    onValueChange={setTotalValue}
                    value={totalValue}
                  />
                </label>
              </div>

              <div className="grid-2">
                <label>
                  Hora inicial
                  <input
                    type="datetime-local"
                    value={manualStartAt}
                    onChange={(event) => setManualStartAt(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Hora final
                  <input
                    type="datetime-local"
                    value={manualEndAt}
                    onChange={(event) => setManualEndAt(event.target.value)}
                    required
                  />
                </label>
              </div>
            </>
          ) : (
            <div className="grid-2">
              <label>
                Data
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                  required
                />
              </label>
              <label>
                Sinal a pagar (R$)
                <CurrencyInput
                  min={0}
                  onValueChange={setDepositPaid}
                  value={depositPaid}
                />
              </label>
            </div>
          )}

          {selectedServiceData ? (
            <div className="service-summary">
              <strong>{selectedServiceData.name}</strong>
              <span>Valor: {formatCurrency(selectedServiceData.price)}</span>
              {isManager ? <span>Valor total agendamento: {formatCurrency(totalValue)}</span> : null}
              <span>Sinal mínimo recomendado: {formatCurrency(selectedServiceData.deposit_amount)}</span>
            </div>
          ) : null}

          {isActiveClientMinor ? (
            <label>
              Responsável legal
              <input
                type="text"
                value={guardianName}
                onChange={(event) => setGuardianName(event.target.value)}
                placeholder="Nome completo do responsável"
                required
                disabled={isEditMode}
              />
            </label>
          ) : null}

          {!isManager ? (
            <div>
              <p className="slots-title">Horários disponíveis</p>
              {loadingSlots ? <p>Consultando disponibilidade...</p> : null}
              {!loadingSlots && slots.length === 0 ? (
                <p className="muted">Nenhum horário disponível para os filtros atuais.</p>
              ) : null}
              <div className="slots-grid">
                {slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    className={`slot-button ${
                      selectedSlot?.startAt === slot.startAt ? "selected" : ""
                    }`}
                    onClick={() => setSelectedSlot(slot)}
                    type="button"
                  >
                    {formatDateTime(slot.startAt)} até {formatDateTime(slot.endAt)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label>
            Observações
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Detalhes da ideia, referência ou cuidados."
              disabled={isEditMode}
            />
          </label>

          <FeedbackMessage message={error} type="error" />
          <FeedbackMessage message={success} type="success" />

          <button className="button button-primary" disabled={submitting || loadingEdit || updatingStatus} type="submit">
            {submitting
              ? "Salvando..."
              : isEditMode
                ? "Atualizar intervalo"
                : "Salvar agendamento"}
          </button>
        </form>
      </div>
    </section>
  );
}


