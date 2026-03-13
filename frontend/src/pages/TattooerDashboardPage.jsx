import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { StatusPill } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { formatCurrency, formatDateTime } from "../utils/format";
import {
  dateTimeLocalSaoPauloToIso,
  isoToDateTimeLocalSaoPaulo,
  toDateInputSaoPaulo
} from "../utils/timezone";

const amountFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const SCHEDULE_START_HOUR = 9;
const SCHEDULE_END_HOUR = 20;
const SCHEDULE_SLOT_STEP_MINUTES = 30;

function datetimeLocalToIso(value) {
  return value ? dateTimeLocalSaoPauloToIso(value) : null;
}

function isoToDatetimeLocal(value) {
  return isoToDateTimeLocalSaoPaulo(value);
}

function dateAndTimeToIso(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  return dateTimeLocalSaoPauloToIso(`${dateValue}T${timeValue}`);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeWhatsappDigits(value) {
  let digits = onlyDigits(value);
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.length < 10) return null;
  return digits.slice(-11);
}

function formatWhatsappDisplay(value) {
  const digits = normalizeWhatsappDigits(value);
  if (!digits) return "-";

  const ddd = digits.slice(0, 2);
  if (digits.length === 11) {
    return `(${ddd}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return `(${ddd}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

function formatAmountInput(value) {
  const digits = onlyDigits(value);
  if (!digits) return "";
  const amount = Number(digits) / 100;
  return amountFormatter.format(amount);
}

function formatAmountFromNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amountFormatter.format(amount);
}

function parseAmountInput(value) {
  const digits = onlyDigits(value);
  if (!digits) return NaN;
  return Number(digits) / 100;
}

function extractQuoteContacts(quote) {
  const emailFromField = normalizeEmail(quote?.client_email);
  const whatsappFromField = normalizeWhatsappDigits(quote?.client_whatsapp);

  if (emailFromField || whatsappFromField) {
    return {
      email: emailFromField,
      whatsapp: whatsappFromField
    };
  }

  const rawContact = String(quote?.client_contact || "");
  const emailMatch = rawContact.match(/[^\s|]+@[^\s|]+\.[^\s|]+/i);

  return {
    email: normalizeEmail(emailMatch ? emailMatch[0] : ""),
    whatsapp: normalizeWhatsappDigits(rawContact)
  };
}

function getDefaultScheduleForm(quote = null) {
  const date = toDateInputSaoPaulo(new Date());
  return {
    serviceId: "",
    date,
    startAt: "",
    endAt: "",
    notes: quote?.description
      ? `Agendamento iniciado a partir do orçamento.\n\nPedido do cliente:\n${quote.description}`
      : "Agendamento iniciado a partir do orçamento."
  };
}

function formatLocalTime(datetimeLocal) {
  return String(datetimeLocal || "").slice(11, 16) || "--:--";
}

function dateFromDatetimeLocal(datetimeLocal) {
  return String(datetimeLocal || "").slice(0, 10);
}

function buildSlotKey(startLocal, endLocal) {
  return `${startLocal}|${endLocal}`;
}

function intervalsOverlap(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(startB) < new Date(endA);
}

function buildScheduleDayData({ date, durationMinutes, appointments, blocks }) {
  const safeDuration = Number(durationMinutes || 0);
  if (!date || !Number.isFinite(safeDuration) || safeDuration <= 0) {
    return { busy: [], slots: [] };
  }

  const dayStartIso = dateTimeLocalSaoPauloToIso(`${date}T00:00`);
  const dayEndIso = dateTimeLocalSaoPauloToIso(`${date}T23:59`);
  if (!dayStartIso || !dayEndIso) {
    return { busy: [], slots: [] };
  }

  const busyFromAppointments = (appointments || [])
    .filter((item) => item?.status !== "cancelled")
    .map((item) => ({
      type: "appointment",
      startAt: item.start_at,
      endAt: item.end_at,
      label: `${item.client_name || "Cliente"}${item.service_name ? ` - ${item.service_name}` : ""}`
    }));

  const busyFromBlocks = (blocks || []).map((item) => ({
    type: "block",
    startAt: item.start_at,
    endAt: item.end_at,
    label: item.reason || "Bloqueio de agenda"
  }));

  const busy = [...busyFromAppointments, ...busyFromBlocks]
    .filter((interval) =>
      interval?.startAt &&
      interval?.endAt &&
      intervalsOverlap(interval.startAt, interval.endAt, dayStartIso, dayEndIso)
    )
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  const slots = [];
  const dayStartMinutes = SCHEDULE_START_HOUR * 60;
  const dayEndMinutes = SCHEDULE_END_HOUR * 60;

  for (
    let minuteCursor = dayStartMinutes;
    minuteCursor + safeDuration <= dayEndMinutes;
    minuteCursor += SCHEDULE_SLOT_STEP_MINUTES
  ) {
    const hour = String(Math.floor(minuteCursor / 60)).padStart(2, "0");
    const minute = String(minuteCursor % 60).padStart(2, "0");
    const startLocal = `${date}T${hour}:${minute}`;
    const startIso = dateTimeLocalSaoPauloToIso(startLocal);
    if (!startIso) continue;

    const endIso = new Date(new Date(startIso).getTime() + safeDuration * 60 * 1000).toISOString();
    const endLocal = isoToDatetimeLocal(endIso);
    const available = !busy.some((interval) =>
      intervalsOverlap(startIso, endIso, interval.startAt, interval.endAt)
    );

    slots.push({
      startLocal,
      endLocal,
      startIso,
      endIso,
      available,
      label: `${formatLocalTime(startLocal)} - ${formatLocalTime(endLocal)}`
    });
  }

  return { busy, slots };
}

function AgendaActionIcon({ type }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  if (type === "confirm") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" {...commonProps} />
      </svg>
    );
  }

  if (type === "complete") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" {...commonProps} />
        <polyline points="16 10 11 15 8 12" {...commonProps} />
      </svg>
    );
  }

  if (type === "reschedule") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="17" rx="2" {...commonProps} />
        <line x1="8" y1="2" x2="8" y2="6" {...commonProps} />
        <line x1="16" y1="2" x2="16" y2="6" {...commonProps} />
        <line x1="3" y1="10" x2="21" y2="10" {...commonProps} />
        <polyline points="10 14 12 16 15 13" {...commonProps} />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" {...commonProps} />
      <line x1="6" y1="6" x2="18" y2="18" {...commonProps} />
    </svg>
  );
}

export function TattooerDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useAuth();
  const { showConfirm } = useDialog();
  const [appointments, setAppointments] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [myArtistId, setMyArtistId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rescheduleTargetId, setRescheduleTargetId] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    date: "",
    startAt: "",
    endAt: ""
  });
  const [rescheduleActionLoading, setRescheduleActionLoading] = useState(false);
  const [rescheduleAvailabilityLoading, setRescheduleAvailabilityLoading] = useState(false);
  const [rescheduleAvailableSlotKeys, setRescheduleAvailableSlotKeys] = useState(null);
  const [blockForm, setBlockForm] = useState({
    date: "",
    startTime: "09:00",
    endTime: "18:00",
    fullDay: false,
    reason: ""
  });

  const [viewQuote, setViewQuote] = useState(null);
  const [replyQuote, setReplyQuote] = useState(null);
  const [scheduleQuote, setScheduleQuote] = useState(null);
  const [quoteActionLoading, setQuoteActionLoading] = useState(false);
  const [scheduleActionLoading, setScheduleActionLoading] = useState(false);
  const [scheduleServicesLoading, setScheduleServicesLoading] = useState(false);
  const [scheduleAvailabilityLoading, setScheduleAvailabilityLoading] = useState(false);
  const [scheduleAvailableSlotKeys, setScheduleAvailableSlotKeys] = useState(null);
  const [scheduleServices, setScheduleServices] = useState([]);
  const [replyForm, setReplyForm] = useState({
    responseText: "",
    responseAmount: "",
    sendEmail: true,
    sendWhatsapp: true
  });
  const [scheduleForm, setScheduleForm] = useState(() => getDefaultScheduleForm());
  const [resumeScheduleRequest, setResumeScheduleRequest] = useState(() => {
    const quoteId = Number(location.state?.resumeQuoteSchedule?.quoteId);
    const clientId = Number(location.state?.resumeQuoteSchedule?.clientId);
    if (!Number.isInteger(quoteId) || quoteId <= 0) return null;

    return {
      quoteId,
      clientId: Number.isInteger(clientId) && clientId > 0 ? clientId : null
    };
  });
  const rescheduleFormRef = useRef(null);

  async function loadData() {
    try {
      const [appointmentsData, quotesData, blocksData, meData] = await Promise.all([
        api.request("/appointments/me", { token }),
        api.request("/quotes", { token }),
        api.request("/appointments/blocks/me", { token }),
        api.request("/users/me", { token })
      ]);
      setAppointments(appointmentsData);
      setQuotes(quotesData);
      setBlocks(blocksData);
      setMyArtistId(Number(meData?.artistId) || null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  useEffect(() => {
    const incomingQuoteId = Number(location.state?.resumeQuoteSchedule?.quoteId);
    if (!Number.isInteger(incomingQuoteId) || incomingQuoteId <= 0) {
      return;
    }

    const incomingClientId = Number(location.state?.resumeQuoteSchedule?.clientId);
    setResumeScheduleRequest({
      quoteId: incomingQuoteId,
      clientId: Number.isInteger(incomingClientId) && incomingClientId > 0 ? incomingClientId : null
    });
    navigate(
      {
        pathname: location.pathname,
        search: location.search
      },
      { replace: true, state: null }
    );
  }, [location.state, location.pathname, location.search, navigate]);

  async function changeStatus(appointmentId, status) {
    setError("");
    try {
      await api.request(`/appointments/${appointmentId}/status`, {
        method: "PATCH",
        token,
        body: { status }
      });
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function cancelAppointment(appointment) {
    if (appointment.status === "completed") {
      setError("Agendamentos concluídos não podem ser cancelados.");
      return;
    }

    const confirmed = await showConfirm({
      title: "Cancelar agendamento",
      message: `Deseja realmente cancelar o agendamento de ${appointment.client_name}?`,
      confirmLabel: "Cancelar agendamento",
      cancelLabel: "Manter agendamento"
    });
    if (!confirmed) return;
    changeStatus(appointment.id, "cancelled");
  }

  function startReschedule(appointment) {
    if (appointment.status === "completed") {
      setError("Agendamentos concluídos não podem ser reagendados.");
      return;
    }

    const startLocal = isoToDatetimeLocal(appointment.start_at);
    const endLocal = isoToDatetimeLocal(appointment.end_at);

    setRescheduleTargetId(appointment.id);
    setRescheduleAvailableSlotKeys(null);
    setRescheduleForm({
      date: dateFromDatetimeLocal(startLocal),
      startAt: startLocal,
      endAt: endLocal
    });
  }

  function cancelReschedule() {
    setRescheduleTargetId(null);
    setRescheduleActionLoading(false);
    setRescheduleAvailabilityLoading(false);
    setRescheduleAvailableSlotKeys(null);
    setRescheduleForm({
      date: "",
      startAt: "",
      endAt: ""
    });
  }

  async function submitReschedule(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!rescheduleTargetId) {
      setError("Selecione um agendamento para reagendar.");
      return;
    }

    const selectedSlot = rescheduleSlots.find(
      (slot) =>
        slot.available &&
        slot.startLocal === rescheduleForm.startAt &&
        slot.endLocal === rescheduleForm.endAt
    );
    if (!selectedSlot) {
      setError("Selecione um horário disponível na grade de reagendamento.");
      return;
    }

    const startAtIso = datetimeLocalToIso(rescheduleForm.startAt);
    const endAtIso = datetimeLocalToIso(rescheduleForm.endAt);

    if (!startAtIso || !endAtIso) {
      setError("Informe a hora de início e a hora final.");
      return;
    }

    setRescheduleActionLoading(true);
    try {
      await api.request(`/appointments/${rescheduleTargetId}/reschedule`, {
        method: "PATCH",
        token,
        body: {
          startAt: startAtIso,
          endAt: endAtIso
        }
      });
      setSuccess("Agendamento reagendado com sucesso.");
      cancelReschedule();
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRescheduleActionLoading(false);
    }
  }

  async function submitBlock(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!blockForm.date) {
      setError("Informe a data para o bloqueio.");
      return;
    }

    const startAtIso = blockForm.fullDay
      ? dateAndTimeToIso(blockForm.date, "00:00")
      : dateAndTimeToIso(blockForm.date, blockForm.startTime);
    const endAtIso = blockForm.fullDay
      ? dateAndTimeToIso(blockForm.date, "23:59")
      : dateAndTimeToIso(blockForm.date, blockForm.endTime);

    if (!startAtIso || !endAtIso) {
      setError("Informe horário inicial e final do bloqueio.");
      return;
    }

    if (new Date(startAtIso) >= new Date(endAtIso)) {
      setError("A hora final precisa ser maior que a hora de início.");
      return;
    }

    try {
      await api.request("/appointments/block", {
        method: "POST",
        token,
        body: {
          startAt: startAtIso,
          endAt: endAtIso,
          reason: blockForm.reason
        }
      });
      setSuccess("Bloqueio de agenda criado.");
      setBlockForm({
        date: "",
        startTime: "09:00",
        endTime: "18:00",
        fullDay: false,
        reason: ""
      });
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeBlock(blockId) {
    setError("");
    setSuccess("");
    try {
      await api.request(`/appointments/block/${blockId}`, {
        method: "DELETE",
        token
      });
      setSuccess("Bloqueio removido.");
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function openViewQuote(quote) {
    setViewQuote(quote);
  }

  function closeViewQuote() {
    setViewQuote(null);
  }

  function openReplyQuote(quote) {
    const contacts = extractQuoteContacts(quote);
    setReplyQuote(quote);
    setReplyForm({
      responseText: quote.response || "",
      responseAmount: quote.response_amount ? formatAmountFromNumber(quote.response_amount) : "",
      sendEmail: Boolean(contacts.email),
      sendWhatsapp: Boolean(contacts.whatsapp)
    });
  }

  function closeReplyQuote() {
    setReplyQuote(null);
    setReplyForm({
      responseText: "",
      responseAmount: "",
      sendEmail: true,
      sendWhatsapp: true
    });
  }

  async function ensureScheduleServicesLoaded() {
    if (scheduleServices.length > 0) {
      return scheduleServices;
    }

    setScheduleServicesLoading(true);
    try {
      const services = await api.request("/appointments/services");
      setScheduleServices(Array.isArray(services) ? services : []);
      return Array.isArray(services) ? services : [];
    } catch (requestError) {
      setError(requestError.message);
      return [];
    } finally {
      setScheduleServicesLoading(false);
    }
  }

  function startClientRegistrationForQuote(quote) {
    if (String(quote?.status || "").toLowerCase() === "accepted") {
      setError("Este orcamento ja foi agendado. Altere o horario diretamente na agenda.");
      return;
    }

    const contacts = extractQuoteContacts(quote);
    navigate("/cadastros", {
      state: {
        clientRegistrationFlow: {
          source: "quote-schedule",
          quoteId: quote.id,
          clientName: quote.client_name || "",
          clientEmail: contacts.email || "",
          clientWhatsapp: contacts.whatsapp || ""
        }
      }
    });
  }

  async function fetchClientForSchedule(clientId) {
    const normalizedClientId = Number(clientId);
    if (!Number.isInteger(normalizedClientId) || normalizedClientId <= 0) {
      return null;
    }

    const clients = await api.request("/registry/clients?includeInactive=1", { token });
    if (!Array.isArray(clients)) {
      return null;
    }

    return clients.find((client) => Number(client?.id) === normalizedClientId) || null;
  }

  function mergeQuoteWithClientData(quote, client) {
    if (!quote || !client) {
      return quote;
    }

    const clientName = String(client.name || "").trim();
    const clientEmail = String(client.email || "").trim();
    const clientWhatsapp = String(client.phone || "").trim();
    const mergedContact = [clientWhatsapp, clientEmail].filter(Boolean).join(" | ");

    return {
      ...quote,
      client_name: clientName || quote.client_name,
      client_email: clientEmail || quote.client_email,
      client_whatsapp: clientWhatsapp || quote.client_whatsapp,
      client_contact: mergedContact || quote.client_contact
    };
  }

  async function openScheduleQuote(quote) {
    if (String(quote?.status || "").toLowerCase() === "accepted") {
      setError("Este orçamento já foi agendado. Altere o horário diretamente na agenda.");
      return;
    }

    setError("");
    setSuccess("");
    setScheduleQuote(quote);
    setScheduleAvailableSlotKeys(null);

    const baseForm = getDefaultScheduleForm(quote);
    const services = await ensureScheduleServicesLoaded();
    if (services.length > 0) {
      baseForm.serviceId = String(services[0].id);
    }
    setScheduleForm(baseForm);
  }

  function closeScheduleQuote() {
    setScheduleQuote(null);
    setScheduleAvailableSlotKeys(null);
    setScheduleForm(getDefaultScheduleForm());
  }

  async function submitScheduleQuote(event) {
    event.preventDefault();
    if (!scheduleQuote) return;

    setError("");
    setSuccess("");

    const serviceId = Number(scheduleForm.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      setError("Selecione um serviço para o agendamento.");
      return;
    }

    const startAtIso = datetimeLocalToIso(scheduleForm.startAt);
    const endAtIso = datetimeLocalToIso(scheduleForm.endAt);
    if (!startAtIso || !endAtIso) {
      setError("Informe hora de início e hora final válidas.");
      return;
    }
    if (new Date(startAtIso) >= new Date(endAtIso)) {
      setError("A hora final deve ser maior que a hora de início.");
      return;
    }
    const selectedSlot = scheduleSlots.find(
      (slot) =>
        slot.available &&
        slot.startLocal === scheduleForm.startAt &&
        slot.endLocal === scheduleForm.endAt
    );
    if (!selectedSlot) {
      setError("Selecione um horário disponível na grade de agenda.");
      return;
    }

    setScheduleActionLoading(true);
    try {
      const response = await api.request(`/quotes/${scheduleQuote.id}/schedule`, {
        method: "POST",
        token,
        body: {
          serviceId,
          startAt: startAtIso,
          endAt: endAtIso,
          notes: scheduleForm.notes
        }
      });

      const createdAppointment = response?.appointment || response;
      if (createdAppointment?.id) {
        setSuccess(
          `Agendamento #${createdAppointment.id} criado para ${formatDateTime(
            createdAppointment.start_at
          )} até ${formatDateTime(createdAppointment.end_at)}.`
        );
      } else {
        setSuccess("Agendamento criado com sucesso.");
      }

      closeScheduleQuote();
      if (viewQuote?.id === scheduleQuote.id && response?.quote) {
        setViewQuote(response.quote);
      }
      if (replyQuote?.id === scheduleQuote.id && response?.quote) {
        setReplyQuote(response.quote);
      }
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setScheduleActionLoading(false);
    }
  }

  async function submitReplyQuote(event) {
    event.preventDefault();
    if (!replyQuote) return;

    setError("");
    setSuccess("");

    const responseText = String(replyForm.responseText || "").trim();
    const responseAmount = parseAmountInput(replyForm.responseAmount);
    if (!responseText) {
      setError("Informe as considerações do tatuador.");
      return;
    }
    if (!Number.isFinite(responseAmount) || responseAmount <= 0) {
      setError("Informe um valor de orçamento maior que zero.");
      return;
    }

    if (!replyForm.sendEmail && !replyForm.sendWhatsapp) {
      setError("Selecione ao menos um canal de envio (e-mail e/ou WhatsApp).");
      return;
    }

    setQuoteActionLoading(true);
    try {
      const payload = {
        status: "replied",
        response: responseText,
        responseAmount,
        sendEmail: replyForm.sendEmail,
        sendWhatsapp: replyForm.sendWhatsapp
      };

      const updated = await api.request(`/quotes/${replyQuote.id}`, {
        method: "PATCH",
        token,
        body: payload
      });

      const deliveryResults = updated?.delivery?.results || [];
      const failures = deliveryResults.filter((item) => item.status !== "sent");
      if (failures.length > 0) {
        const reasonList = failures
          .map((item) => `${item.channel}: ${item.reason || item.status}`)
          .join(" | ");
        setSuccess(`Resposta salva. Alguns envios falharam: ${reasonList}`);
      } else if (deliveryResults.length > 0) {
        setSuccess("Resposta enviada com sucesso.");
      } else {
        setSuccess("Resposta salva com sucesso.");
      }

      closeReplyQuote();
      if (viewQuote?.id === replyQuote.id) {
        setViewQuote(updated);
      }
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setQuoteActionLoading(false);
    }
  }

  async function deleteQuote(quote) {
    const confirmed = window.confirm(`Deseja realmente excluir o orçamento #${quote.id}?`);
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setQuoteActionLoading(true);

    try {
      await api.request(`/quotes/${quote.id}`, {
        method: "DELETE",
        token
      });
      if (viewQuote?.id === quote.id) {
        closeViewQuote();
      }
      if (replyQuote?.id === quote.id) {
        closeReplyQuote();
      }
      if (scheduleQuote?.id === quote.id) {
        closeScheduleQuote();
      }
      setSuccess("Orçamento excluído com sucesso.");
      loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setQuoteActionLoading(false);
    }
  }

  const viewQuoteContacts = useMemo(() => extractQuoteContacts(viewQuote || {}), [viewQuote]);
  const replyQuoteContacts = useMemo(() => extractQuoteContacts(replyQuote || {}), [replyQuote]);
  const scheduleQuoteContacts = useMemo(
    () => extractQuoteContacts(scheduleQuote || {}),
    [scheduleQuote]
  );
  const rescheduleTargetAppointment = useMemo(
    () =>
      appointments.find((appointment) => Number(appointment.id) === Number(rescheduleTargetId)) ||
      null,
    [appointments, rescheduleTargetId]
  );
  const rescheduleDurationMinutes = useMemo(() => {
    if (!rescheduleTargetAppointment) return 0;
    const startMs = new Date(rescheduleTargetAppointment.start_at).getTime();
    const endMs = new Date(rescheduleTargetAppointment.end_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return 0;
    }
    return Math.round((endMs - startMs) / (60 * 1000));
  }, [rescheduleTargetAppointment]);
  const rescheduleDayData = useMemo(() => {
    const appointmentsWithoutCurrent = appointments.filter(
      (appointment) => Number(appointment.id) !== Number(rescheduleTargetId)
    );
    return buildScheduleDayData({
      date: rescheduleForm.date,
      durationMinutes: rescheduleDurationMinutes,
      appointments: appointmentsWithoutCurrent,
      blocks
    });
  }, [rescheduleForm.date, rescheduleDurationMinutes, appointments, blocks, rescheduleTargetId]);
  const rescheduleBusyIntervals = rescheduleDayData.busy;
  const rescheduleSlots = useMemo(() => {
    const hasServerAvailability = Array.isArray(rescheduleAvailableSlotKeys);
    const availableKeySet = new Set(rescheduleAvailableSlotKeys || []);
    return rescheduleDayData.slots.map((slot) => ({
      ...slot,
      available: hasServerAvailability
        ? availableKeySet.has(buildSlotKey(slot.startLocal, slot.endLocal))
        : false
    }));
  }, [rescheduleDayData.slots, rescheduleAvailableSlotKeys]);
  const selectedScheduleService = useMemo(
    () =>
      scheduleServices.find(
        (service) => String(service.id) === String(scheduleForm.serviceId)
      ) || null,
    [scheduleServices, scheduleForm.serviceId]
  );
  const scheduleDurationMinutes = useMemo(
    () => Number(selectedScheduleService?.duration_minutes || 0),
    [selectedScheduleService]
  );
  const scheduleDayData = useMemo(
    () =>
      buildScheduleDayData({
        date: scheduleForm.date,
        durationMinutes: scheduleDurationMinutes,
        appointments,
        blocks
      }),
    [scheduleForm.date, scheduleDurationMinutes, appointments, blocks]
  );
  const scheduleBusyIntervals = scheduleDayData.busy;
  const scheduleSlots = useMemo(() => {
    const hasServerAvailability = Array.isArray(scheduleAvailableSlotKeys);
    const availableKeySet = new Set(scheduleAvailableSlotKeys || []);
    return scheduleDayData.slots.map((slot) => ({
      ...slot,
      available: hasServerAvailability
        ? availableKeySet.has(buildSlotKey(slot.startLocal, slot.endLocal))
        : false
      }));
  }, [scheduleDayData.slots, scheduleAvailableSlotKeys]);

  useEffect(() => {
    if (
      !rescheduleTargetAppointment ||
      !myArtistId ||
      !rescheduleForm.date ||
      rescheduleDurationMinutes <= 0
    ) {
      setRescheduleAvailabilityLoading(false);
      setRescheduleAvailableSlotKeys(null);
      return;
    }

    let active = true;
    setRescheduleAvailabilityLoading(true);
    setRescheduleAvailableSlotKeys(null);

    async function loadRescheduleAvailability() {
      try {
        const query = new URLSearchParams({
          artistId: String(myArtistId),
          date: rescheduleForm.date,
          durationMinutes: String(rescheduleDurationMinutes),
          excludeAppointmentId: String(rescheduleTargetAppointment.id)
        });
        const response = await api.request(`/appointments/availability?${query.toString()}`, { token });
        if (!active) return;

        const availableKeys = Array.isArray(response?.slots)
          ? response.slots
              .map((slot) => {
                const startLocal = isoToDatetimeLocal(slot.startAt);
                const endLocal = isoToDatetimeLocal(slot.endAt);
                return startLocal && endLocal ? buildSlotKey(startLocal, endLocal) : null;
              })
              .filter(Boolean)
          : [];
        setRescheduleAvailableSlotKeys(availableKeys);
      } catch (requestError) {
        if (!active) return;
        setRescheduleAvailableSlotKeys([]);
        setError(requestError.message);
      } finally {
        if (active) {
          setRescheduleAvailabilityLoading(false);
        }
      }
    }

    loadRescheduleAvailability();
    return () => {
      active = false;
    };
  }, [
    rescheduleTargetAppointment,
    myArtistId,
    rescheduleForm.date,
    rescheduleDurationMinutes,
    token
  ]);

  useEffect(() => {
    if (!rescheduleTargetAppointment) return;

    const selectedIsStillAvailable = rescheduleSlots.some(
      (slot) =>
        slot.available &&
        slot.startLocal === rescheduleForm.startAt &&
        slot.endLocal === rescheduleForm.endAt
    );
    if (selectedIsStillAvailable) {
      return;
    }

    const firstAvailable = rescheduleSlots.find((slot) => slot.available);
    if (!firstAvailable) {
      if (!rescheduleForm.startAt && !rescheduleForm.endAt) return;
      setRescheduleForm((prev) => ({ ...prev, startAt: "", endAt: "" }));
      return;
    }

    setRescheduleForm((prev) => {
      if (prev.startAt === firstAvailable.startLocal && prev.endAt === firstAvailable.endLocal) {
        return prev;
      }
      return {
        ...prev,
        startAt: firstAvailable.startLocal,
        endAt: firstAvailable.endLocal
      };
    });
  }, [rescheduleTargetAppointment, rescheduleSlots, rescheduleForm.startAt, rescheduleForm.endAt]);

  useEffect(() => {
    if (!scheduleQuote || !myArtistId || !scheduleForm.date || scheduleDurationMinutes <= 0) {
      setScheduleAvailabilityLoading(false);
      setScheduleAvailableSlotKeys(null);
      return;
    }

    let active = true;
    setScheduleAvailabilityLoading(true);
    setScheduleAvailableSlotKeys(null);

    async function loadScheduleAvailability() {
      try {
        const query = new URLSearchParams({
          artistId: String(myArtistId),
          date: scheduleForm.date,
          durationMinutes: String(scheduleDurationMinutes)
        });
        const response = await api.request(`/appointments/availability?${query.toString()}`, { token });
        if (!active) return;

        const availableKeys = Array.isArray(response?.slots)
          ? response.slots
              .map((slot) => {
                const startLocal = isoToDatetimeLocal(slot.startAt);
                const endLocal = isoToDatetimeLocal(slot.endAt);
                return startLocal && endLocal ? buildSlotKey(startLocal, endLocal) : null;
              })
              .filter(Boolean)
          : [];
        setScheduleAvailableSlotKeys(availableKeys);
      } catch (requestError) {
        if (!active) return;
        setScheduleAvailableSlotKeys([]);
        setError(requestError.message);
      } finally {
        if (active) {
          setScheduleAvailabilityLoading(false);
        }
      }
    }

    loadScheduleAvailability();
    return () => {
      active = false;
    };
  }, [scheduleQuote, myArtistId, scheduleForm.date, scheduleDurationMinutes, token]);

  useEffect(() => {
    if (!scheduleQuote) return;

    const selectedIsStillAvailable = scheduleSlots.some(
      (slot) =>
        slot.available &&
        slot.startLocal === scheduleForm.startAt &&
        slot.endLocal === scheduleForm.endAt
    );
    if (selectedIsStillAvailable) {
      return;
    }

    const firstAvailable = scheduleSlots.find((slot) => slot.available);
    if (!firstAvailable) {
      if (!scheduleForm.startAt && !scheduleForm.endAt) return;
      setScheduleForm((prev) => ({ ...prev, startAt: "", endAt: "" }));
      return;
    }

    setScheduleForm((prev) => {
      if (prev.startAt === firstAvailable.startLocal && prev.endAt === firstAvailable.endLocal) {
        return prev;
      }
      return {
        ...prev,
        startAt: firstAvailable.startLocal,
        endAt: firstAvailable.endLocal
      };
    });
  }, [scheduleQuote, scheduleSlots, scheduleForm.startAt, scheduleForm.endAt]);

  useEffect(() => {
    if (!resumeScheduleRequest || quotes.length === 0) return;

    let active = true;
    const pendingRequest = resumeScheduleRequest;
    setResumeScheduleRequest(null);

    async function resumeScheduleAfterClientRegistration() {
      const targetQuote = quotes.find(
        (quote) => Number(quote.id) === Number(pendingRequest.quoteId)
      );
      if (!targetQuote) {
        if (!active) return;
        setError("Orcamento para agendamento nao encontrado.");
        return;
      }

      let quoteToSchedule = targetQuote;
      if (pendingRequest.clientId) {
        try {
          const client = await fetchClientForSchedule(pendingRequest.clientId);
          if (!active) return;
          if (client) {
            quoteToSchedule = mergeQuoteWithClientData(targetQuote, client);
            setQuotes((prevQuotes) =>
              prevQuotes.map((quote) =>
                Number(quote.id) === Number(targetQuote.id)
                  ? mergeQuoteWithClientData(quote, client)
                  : quote
              )
            );
            setViewQuote((prevQuote) =>
              Number(prevQuote?.id) === Number(targetQuote.id)
                ? mergeQuoteWithClientData(prevQuote, client)
                : prevQuote
            );
            setReplyQuote((prevQuote) =>
              Number(prevQuote?.id) === Number(targetQuote.id)
                ? mergeQuoteWithClientData(prevQuote, client)
                : prevQuote
            );
            setScheduleQuote((prevQuote) =>
              Number(prevQuote?.id) === Number(targetQuote.id)
                ? mergeQuoteWithClientData(prevQuote, client)
                : prevQuote
            );
          }
        } catch (_requestError) {
          // Keep scheduling available even if client refresh fails.
        }
      }

      if (!active) return;
      await openScheduleQuote(quoteToSchedule);
    }

    resumeScheduleAfterClientRegistration();
    return () => {
      active = false;
    };
  }, [resumeScheduleRequest, quotes, token]);

  useEffect(() => {
    if (rescheduleTargetId && rescheduleFormRef.current) {
      rescheduleFormRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [rescheduleTargetId]);

  return (
    <section className="section">
      <div className="container dashboard-grid">
        <div>
          <div className="page-heading">
            <h1>Painel do Tatuador</h1>
            <p>Controle de agenda com hora de início/fim, bloqueios e orçamentos.</p>
          </div>

          <FeedbackMessage message={error} type="error" />
          <FeedbackMessage message={success} type="success" />

          <section className="panel">
            <h2>Minha Agenda</h2>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Serviço</th>
                    <th>Inicio</th>
                    <th>Fim</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((appointment) => {
                    const isCompleted = appointment.status === "completed";
                    return (
                      <tr key={appointment.id}>
                        <td>{appointment.client_name}</td>
                        <td>{appointment.service_name}</td>
                        <td>{formatDateTime(appointment.start_at)}</td>
                        <td>{formatDateTime(appointment.end_at)}</td>
                        <td>
                          <StatusPill status={appointment.status} />
                        </td>
                        <td>
                          <div className="table-actions table-actions-icon">
                            <button
                              aria-label="Confirmar agendamento"
                              className="button button-outline small action-icon-button action-confirm"
                              onClick={() => changeStatus(appointment.id, "confirmed")}
                              disabled={isCompleted}
                              title="Confirmar"
                              type="button"
                            >
                              <AgendaActionIcon type="confirm" />
                            </button>
                            <button
                              aria-label="Concluir agendamento"
                              className="button button-outline small action-icon-button action-complete"
                              onClick={() => changeStatus(appointment.id, "completed")}
                              disabled={isCompleted}
                              title="Concluir"
                              type="button"
                            >
                              <AgendaActionIcon type="complete" />
                            </button>
                            <button
                              aria-label="Reagendar"
                              className="button button-outline small action-icon-button action-reschedule"
                              onClick={() => startReschedule(appointment)}
                              disabled={isCompleted}
                              title="Reagendar"
                              type="button"
                            >
                              <AgendaActionIcon type="reschedule" />
                            </button>
                            <button
                              aria-label="Cancelar agendamento"
                              className="button button-outline small action-icon-button action-cancel"
                              onClick={() => cancelAppointment(appointment)}
                              disabled={appointment.status === "cancelled" || isCompleted}
                              title="Cancelar"
                              type="button"
                            >
                              <AgendaActionIcon type="cancel" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {rescheduleTargetId ? (
              <form className="form inline-form reschedule-form" onSubmit={submitReschedule} ref={rescheduleFormRef}>
                <h3>Reagendar atendimento</h3>
                <div className="reschedule-meta">
                  <span>
                    <strong>Cliente:</strong> {rescheduleTargetAppointment?.client_name || "-"}
                  </span>
                  <span>
                    <strong>Duração:</strong>{" "}
                    {rescheduleDurationMinutes > 0 ? `${rescheduleDurationMinutes} min` : "-"}
                  </span>
                </div>

                <label className="quote-reply-field">
                  Data
                  <input
                    type="date"
                    value={rescheduleForm.date}
                    onChange={(event) =>
                      setRescheduleForm((prev) => ({
                        ...prev,
                        date: event.target.value
                      }))
                    }
                    required
                  />
                </label>

                <div className="schedule-busy-block">
                  <strong>Horários indisponíveis no dia selecionado</strong>
                  {rescheduleBusyIntervals.length === 0 ? (
                    <p className="muted">Nenhum horário bloqueado para esta data.</p>
                  ) : (
                    <ul className="schedule-busy-list">
                      {rescheduleBusyIntervals.map((interval, index) => (
                        <li key={`reschedule-${interval.type}-${interval.startAt}-${index}`}>
                          <span>
                            {formatLocalTime(isoToDatetimeLocal(interval.startAt))} -{" "}
                            {formatLocalTime(isoToDatetimeLocal(interval.endAt))}
                          </span>
                          <small>
                            {interval.type === "block" ? "Bloqueio" : "Agendamento"}: {interval.label}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="schedule-slots-block">
                  <strong>Selecione um horário disponível</strong>
                  <div className="slot-legend">
                    <span className="slot-legend-item available">Disponivel</span>
                    <span className="slot-legend-item unavailable">Indisponivel</span>
                  </div>
                  {rescheduleAvailabilityLoading ? (
                    <p className="muted">Carregando horários disponíveis...</p>
                  ) : null}
                  {!rescheduleAvailabilityLoading && rescheduleSlots.length === 0 ? (
                    <p className="muted">Selecione a data para carregar os horários da agenda.</p>
                  ) : null}
                  {rescheduleSlots.length > 0 ? (
                    <div className="slots-grid schedule-slots-grid">
                      {rescheduleSlots.map((slot) => (
                        <button
                          key={`reschedule-slot-${slot.startLocal}`}
                          className={`slot-button${slot.startLocal === rescheduleForm.startAt ? " selected" : ""}${slot.available ? "" : " unavailable"}`}
                          disabled={!slot.available || rescheduleAvailabilityLoading}
                          onClick={() =>
                            setRescheduleForm((prev) => ({
                              ...prev,
                              startAt: slot.startLocal,
                              endAt: slot.endLocal
                            }))
                          }
                          type="button"
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid-2">
                  <label className="quote-reply-field">
                    Inicio
                    <input type="datetime-local" value={rescheduleForm.startAt} readOnly required />
                  </label>
                  <label className="quote-reply-field">
                    Fim
                    <input type="datetime-local" value={rescheduleForm.endAt} readOnly required />
                  </label>
                </div>

                <p className="muted schedule-helper">
                  Horários indisponíveis ficam bloqueados e não podem ser selecionados.
                </p>
                <div className="table-actions">
                  <button className="button button-primary small" disabled={rescheduleActionLoading} type="submit">
                    {rescheduleActionLoading ? "Salvando..." : "Salvar horário"}
                  </button>
                  <button
                    className="button button-outline small"
                    disabled={rescheduleActionLoading}
                    onClick={cancelReschedule}
                    type="button"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <section className="panel">
            <h2>Orçamentos Relacionados</h2>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Estilo</th>
                    <th>Status</th>
                    <th>Valor</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>{quote.client_name}</td>
                      <td>{quote.style}</td>
                      <td>
                        <StatusPill status={quote.status} />
                      </td>
                      <td>{quote.response_amount ? formatCurrency(quote.response_amount) : "-"}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="button button-outline small"
                            onClick={() => openViewQuote(quote)}
                            type="button"
                          >
                            Ver
                          </button>
                          <button
                            className="button button-outline small"
                            onClick={() => openReplyQuote(quote)}
                            type="button"
                          >
                            Responder
                          </button>
                          <button
                            className="button button-outline small"
                            onClick={() => startClientRegistrationForQuote(quote)}
                            disabled={scheduleActionLoading || quote.status === "accepted"}
                            type="button"
                          >
                            {quote.status === "accepted" ? "Agendado" : "Agendar"}
                          </button>
                          <button
                            className="button button-outline small"
                            onClick={() => deleteQuote(quote)}
                            disabled={quoteActionLoading}
                            type="button"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="panel side">
          <h2>Bloquear Data e Horário</h2>
          <form className="form" onSubmit={submitBlock}>
            <label>
              Data
              <input
                type="date"
                value={blockForm.date}
                onChange={(event) =>
                  setBlockForm((prev) => ({ ...prev, date: event.target.value }))
                }
                required
              />
            </label>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={blockForm.fullDay}
                onChange={(event) =>
                  setBlockForm((prev) => ({ ...prev, fullDay: event.target.checked }))
                }
              />
              Bloquear dia inteiro
            </label>

            {!blockForm.fullDay ? (
              <div className="grid-2">
                <label>
                  Hora de início
                  <input
                    type="time"
                    value={blockForm.startTime}
                    onChange={(event) =>
                      setBlockForm((prev) => ({ ...prev, startTime: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Hora final
                  <input
                    type="time"
                    value={blockForm.endTime}
                    onChange={(event) =>
                      setBlockForm((prev) => ({ ...prev, endTime: event.target.value }))
                    }
                    required
                  />
                </label>
              </div>
            ) : null}

            <label>
              Motivo
              <textarea
                rows={3}
                value={blockForm.reason}
                onChange={(event) =>
                  setBlockForm((prev) => ({ ...prev, reason: event.target.value }))
                }
                required
              />
            </label>
            <button className="button button-primary" type="submit">
              Criar bloqueio
            </button>
          </form>

          <div className="section compact">
            <h3>Bloqueios cadastrados</h3>
            {blocks.length === 0 ? <p className="muted">Nenhum bloqueio ativo.</p> : null}
            <ul className="list">
              {blocks.map((block) => (
                <li key={block.id}>
                  <strong>{block.reason}</strong>
                  <span>
                    {formatDateTime(block.start_at)} ate {formatDateTime(block.end_at)}
                  </span>
                  <button
                    className="button button-outline small"
                    onClick={() => removeBlock(block.id)}
                    type="button"
                  >
                    Remover bloqueio
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {viewQuote ? (
        <div className="dialog-backdrop">
          <div className="dialog-card view-quote-dialog">
            <header className="dialog-header">
              <h3>Orçamento #{viewQuote.id}</h3>
            </header>
            <div className="dialog-body quote-view-body">
              <section className="quote-reply-section">
                <h4>Contato do cliente</h4>
                <div className="quote-meta-grid quote-meta-grid-contact">
                  <article className="quote-meta-card">
                    <span>Cliente</span>
                    <strong>{viewQuote.client_name}</strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>WhatsApp</span>
                    <strong>{formatWhatsappDisplay(viewQuoteContacts.whatsapp)}</strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>E-mail</span>
                    <strong>{viewQuoteContacts.email || "-"}</strong>
                  </article>
                </div>
              </section>

              <section className="quote-reply-section">
                <h4>Resumo do orçamento</h4>
                <div className="quote-meta-grid">
                  <article className="quote-meta-card">
                    <span>Estilo</span>
                    <strong>{viewQuote.style || "-"}</strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>Região do corpo</span>
                    <strong>{viewQuote.body_part || "-"}</strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>Tamanho estimado</span>
                    <strong>{viewQuote.size_estimate || "-"}</strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>Artista preferido</span>
                    <strong>{viewQuote.preferred_artist_name || "Indiferente"}</strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>Status</span>
                    <strong><StatusPill status={viewQuote.status} /></strong>
                  </article>
                  <article className="quote-meta-card">
                    <span>Data da solicitação</span>
                    <strong>{formatDateTime(viewQuote.created_at)}</strong>
                  </article>
                </div>
              </section>

              <section className="quote-reply-section">
                <h4>Descrição da ideia</h4>
                <p className="quote-description-text">{viewQuote.description || "-"}</p>
              </section>

              <section className="quote-reply-section">
                <h4>Imagens de referência</h4>
                {Array.isArray(viewQuote.reference_images) && viewQuote.reference_images.length > 0 ? (
                  <div className="portfolio-grid">
                    {viewQuote.reference_images.map((imageUrl, index) => (
                      <img key={`${viewQuote.id}-reference-${index}`} src={imageUrl} alt={`Referência ${index + 1}`} />
                    ))}
                  </div>
                ) : (
                  <p className="muted">Nenhuma imagem enviada.</p>
                )}
              </section>
            </div>
            <footer className="dialog-actions">
              <button className="button button-outline" onClick={closeViewQuote} type="button">
                Fechar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {scheduleQuote ? (
        <div className="dialog-backdrop">
          <div className="dialog-card schedule-quote-dialog">
            <header className="dialog-header">
              <h3>Agendar orçamento #{scheduleQuote.id}</h3>
            </header>
            <form onSubmit={submitScheduleQuote}>
              <div className="dialog-body quote-reply-body">
                <section className="quote-reply-section">
                  <h4>Dados do cliente</h4>
                  <div className="quote-meta-grid quote-meta-grid-contact">
                    <article className="quote-meta-card">
                      <span>Cliente</span>
                      <strong>{scheduleQuote.client_name}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>WhatsApp</span>
                      <strong>{formatWhatsappDisplay(scheduleQuoteContacts.whatsapp)}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>E-mail</span>
                      <strong>{scheduleQuoteContacts.email || "-"}</strong>
                    </article>
                  </div>
                </section>

                <section className="quote-reply-section">
                  <h4>Agenda do tatuador</h4>
                  <div className="quote-reply-form-grid">
                    <label className="quote-reply-field">
                      Serviço
                      <select
                        value={scheduleForm.serviceId}
                        onChange={(event) =>
                          setScheduleForm((prev) => ({
                            ...prev,
                            serviceId: event.target.value
                          }))
                        }
                        required
                      >
                        <option value="">
                          {scheduleServicesLoading ? "Carregando serviços..." : "Selecione"}
                        </option>
                        {scheduleServices.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name} ({service.duration_minutes} min)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="quote-reply-field">
                      Data
                      <input
                        type="date"
                        value={scheduleForm.date}
                        onChange={(event) =>
                          setScheduleForm((prev) => ({
                            ...prev,
                            date: event.target.value
                          }))
                        }
                        required
                      />
                    </label>

                    <div className="schedule-busy-block">
                      <strong>Horários indisponíveis no dia selecionado</strong>
                      {scheduleBusyIntervals.length === 0 ? (
                        <p className="muted">Nenhum horário bloqueado para esta data.</p>
                      ) : (
                        <ul className="schedule-busy-list">
                          {scheduleBusyIntervals.map((interval, index) => (
                            <li key={`${interval.type}-${interval.startAt}-${index}`}>
                              <span>
                                {formatLocalTime(isoToDatetimeLocal(interval.startAt))} -{" "}
                                {formatLocalTime(isoToDatetimeLocal(interval.endAt))}
                              </span>
                              <small>
                                {interval.type === "block" ? "Bloqueio" : "Agendamento"}: {interval.label}
                              </small>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="schedule-slots-block">
                      <strong>Selecione um horário disponível</strong>
                      {scheduleAvailabilityLoading ? (
                        <p className="muted">Carregando horários disponíveis...</p>
                      ) : null}
                      {!scheduleAvailabilityLoading && scheduleSlots.length === 0 ? (
                        <p className="muted">
                          Selecione serviço e data para carregar os horários da agenda.
                        </p>
                      ) : null}
                      {scheduleSlots.length > 0 ? (
                        <div className="slots-grid schedule-slots-grid">
                          {scheduleSlots.map((slot) => (
                            <button
                              key={slot.startLocal}
                              className={`slot-button${slot.startLocal === scheduleForm.startAt ? " selected" : ""}${slot.available ? "" : " unavailable"}`}
                              disabled={!slot.available || scheduleAvailabilityLoading}
                              onClick={() =>
                                setScheduleForm((prev) => ({
                                  ...prev,
                                  startAt: slot.startLocal,
                                  endAt: slot.endLocal
                                }))
                              }
                              type="button"
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid-2">
                      <label className="quote-reply-field">
                        Início
                        <input
                          type="datetime-local"
                          value={scheduleForm.startAt}
                          readOnly
                          required
                        />
                      </label>
                      <label className="quote-reply-field">
                        Fim
                        <input
                          type="datetime-local"
                          value={scheduleForm.endAt}
                          readOnly
                          required
                        />
                      </label>
                    </div>

                    <label className="quote-reply-field">
                      Observações internas
                      <textarea
                        rows={5}
                        value={scheduleForm.notes}
                        onChange={(event) =>
                          setScheduleForm((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        placeholder="Informações adicionais para o agendamento."
                      />
                    </label>
                  </div>
                  <p className="muted schedule-helper">
                    Horários indisponíveis ficam bloqueados e não podem ser selecionados.
                  </p>
                </section>
              </div>
              <footer className="dialog-actions">
                <button className="button button-outline" onClick={closeScheduleQuote} type="button">
                  Cancelar
                </button>
                <button className="button button-primary" disabled={scheduleActionLoading} type="submit">
                  {scheduleActionLoading ? "Agendando..." : "Confirmar agendamento"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {replyQuote ? (
        <div className="dialog-backdrop">
          <div className="dialog-card reply-quote-dialog">
            <header className="dialog-header">
              <h3>Responder orçamento #{replyQuote.id}</h3>
            </header>
            <form onSubmit={submitReplyQuote}>
              <div className="dialog-body quote-reply-body">
                <section className="quote-reply-section">
                  <h4>Contato do cliente</h4>
                  <div className="quote-meta-grid quote-meta-grid-contact">
                    <article className="quote-meta-card">
                      <span>Cliente</span>
                      <strong>{replyQuote.client_name}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>WhatsApp</span>
                      <strong>{formatWhatsappDisplay(replyQuoteContacts.whatsapp)}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>E-mail</span>
                      <strong>{replyQuoteContacts.email || "-"}</strong>
                    </article>
                  </div>
                </section>

                <section className="quote-reply-section">
                  <h4>Resumo do orçamento</h4>
                  <div className="quote-meta-grid">
                    <article className="quote-meta-card">
                      <span>Estilo</span>
                      <strong>{replyQuote.style || "-"}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>Região do corpo</span>
                      <strong>{replyQuote.body_part || "-"}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>Tamanho estimado</span>
                      <strong>{replyQuote.size_estimate || "-"}</strong>
                    </article>
                    <article className="quote-meta-card">
                      <span>Solicitado em</span>
                      <strong>{formatDateTime(replyQuote.created_at)}</strong>
                    </article>
                  </div>
                </section>

                <section className="quote-reply-section">
                  <h4>Mensagem de resposta</h4>
                  <div className="quote-reply-form-grid">
                    <label className="quote-reply-field">
                      Considera??es do tatuador
                      <textarea
                        rows={5}
                        value={replyForm.responseText}
                        onChange={(event) =>
                          setReplyForm((prev) => ({ ...prev, responseText: event.target.value }))
                        }
                        placeholder="Descreva orientações, sugestões e detalhes do atendimento."
                        required
                      />
                    </label>

                    <label className="quote-reply-field">
                      Valor do orçamento (R$)
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={replyForm.responseAmount}
                        onChange={(event) =>
                          setReplyForm((prev) => ({
                            ...prev,
                            responseAmount: formatAmountInput(event.target.value)
                          }))
                        }
                        placeholder="Ex.: 450,00"
                        required
                      />
                    </label>
                  </div>
                </section>

                <section className="quote-reply-section">
                  <h4>Canais de envio</h4>
                  <div className="quote-channel-grid">
                    <label
                      className={`quote-channel-card${replyForm.sendEmail ? " selected" : ""}${!replyQuoteContacts.email ? " disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={replyForm.sendEmail}
                        disabled={!replyQuoteContacts.email}
                        onChange={(event) =>
                          setReplyForm((prev) => ({ ...prev, sendEmail: event.target.checked }))
                        }
                      />
                      <span>
                        <strong>E-mail</strong>
                        {replyQuoteContacts.email || "Canal indisponível para este cliente."}
                      </span>
                    </label>

                    <label
                      className={`quote-channel-card${replyForm.sendWhatsapp ? " selected" : ""}${!replyQuoteContacts.whatsapp ? " disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={replyForm.sendWhatsapp}
                        disabled={!replyQuoteContacts.whatsapp}
                        onChange={(event) =>
                          setReplyForm((prev) => ({ ...prev, sendWhatsapp: event.target.checked }))
                        }
                      />
                      <span>
                        <strong>WhatsApp</strong>
                        {replyQuoteContacts.whatsapp
                          ? formatWhatsappDisplay(replyQuoteContacts.whatsapp)
                          : "Canal indisponível para este cliente."}
                      </span>
                    </label>
                  </div>
                </section>
              </div>
              <footer className="dialog-actions">
                <button className="button button-outline" onClick={closeReplyQuote} type="button">
                  Cancelar
                </button>
                <button className="button button-primary" disabled={quoteActionLoading} type="submit">
                  {quoteActionLoading ? "Enviando..." : "Responder"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
