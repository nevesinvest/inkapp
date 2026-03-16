import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../context/AuthContext";
import {
  SAO_PAULO_TIMEZONE,
  dateTimeLocalSaoPauloToIso,
  toDateInputSaoPaulo
} from "../utils/timezone";

const VIEW_TODAY = "today";
const VIEW_DAY = "day";
const VIEW_WEEK = "week";
const VIEW_MONTH = "month";
const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_HEIGHT = 56;
const MAX_VISIBLE_CONFLICT_COLUMNS = 3;
const ARTIST_PALETTE = [
  { main: "#1d4ed8", soft: "rgba(29, 78, 216, 0.14)" },
  { main: "#b91c1c", soft: "rgba(185, 28, 28, 0.14)" },
  { main: "#047857", soft: "rgba(4, 120, 87, 0.14)" },
  { main: "#7c3aed", soft: "rgba(124, 58, 237, 0.14)" },
  { main: "#c2410c", soft: "rgba(194, 65, 12, 0.14)" },
  { main: "#0f766e", soft: "rgba(15, 118, 110, 0.14)" },
  { main: "#a16207", soft: "rgba(161, 98, 7, 0.14)" },
  { main: "#be185d", soft: "rgba(190, 24, 93, 0.14)" }
];
const APPOINTMENT_STATUS_LABELS = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Conclu\u00eddo",
  cancelled: "Cancelado"
};

function cloneDate(date) {
  return new Date(date.getTime());
}

function startOfDay(date) {
  const value = cloneDate(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, days) {
  const value = cloneDate(date);
  value.setDate(value.getDate() + days);
  return value;
}

function addMonths(date, months) {
  const value = cloneDate(date);
  value.setMonth(value.getMonth() + months);
  return value;
}

function startOfWeek(date) {
  const value = startOfDay(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(value, diff);
}

function startOfMonth(date) {
  const value = startOfDay(date);
  value.setDate(1);
  return value;
}

function endOfMonth(date) {
  const value = startOfMonth(date);
  value.setMonth(value.getMonth() + 1);
  value.setDate(0);
  return value;
}

function toDateInputValue(date) {
  return toDateInputSaoPaulo(date);
}

function getSaoPauloDateParts(date) {
  const [year, month, day] = toDateInputSaoPaulo(date).split("-").map((item) => Number(item));
  return {
    year,
    month,
    day
  };
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    weekday: "short"
  }).format(date);
}

function formatMonthTitle(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatHour(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function buildIsoAtHour(date, hour, minute = 0) {
  const dateInput = toDateInputSaoPaulo(date);
  const hourValue = String(hour).padStart(2, "0");
  const minuteValue = String(minute).padStart(2, "0");
  return dateTimeLocalSaoPauloToIso(`${dateInput}T${hourValue}:${minuteValue}`);
}

function buildViewDays(viewMode, currentDate) {
  if (viewMode === VIEW_TODAY || viewMode === VIEW_DAY) {
    return [startOfDay(currentDate)];
  }
  if (viewMode === VIEW_WEEK) {
    const weekStart = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }

  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function parseEventDate(value) {
  return new Date(value);
}

function getAppointmentStatusLabel(status) {
  return APPOINTMENT_STATUS_LABELS[status] || status || "Pendente";
}

function getEventsForDay(events, day) {
  const dayStartIso = buildIsoAtHour(day, 0, 0);
  const nextDayIso = buildIsoAtHour(addDays(day, 1), 0, 0);
  const dayStart = dayStartIso ? new Date(dayStartIso) : startOfDay(day);
  const dayEnd = nextDayIso ? new Date(nextDayIso) : addDays(dayStart, 1);
  return events
    .filter((event) => event.start < dayEnd && event.end > dayStart)
    .sort((first, second) => first.start - second.start);
}

function getDayRangeAtHour(day, hour) {
  const startIso = buildIsoAtHour(day, hour, 0);
  const endIso = buildIsoAtHour(day, hour + 1, 0);
  const start = startIso ? new Date(startIso) : startOfDay(day);
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

function getEventGeometryForDay(event, day) {
  const visibleStartIso = buildIsoAtHour(day, HOUR_START, 0);
  const visibleEndIso = buildIsoAtHour(day, HOUR_END, 0);
  if (!visibleStartIso || !visibleEndIso) return null;
  const visibleStart = new Date(visibleStartIso);
  const visibleEnd = new Date(visibleEndIso);

  const clippedStart = event.start > visibleStart ? event.start : visibleStart;
  const clippedEnd = event.end < visibleEnd ? event.end : visibleEnd;
  const durationMs = clippedEnd - clippedStart;
  if (durationMs <= 0) return null;

  const minutesFromStart = (clippedStart - visibleStart) / (1000 * 60);
  const durationMinutes = durationMs / (1000 * 60);
  const top = (minutesFromStart / 60) * HOUR_HEIGHT;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 22);

  return {
    top,
    height,
    startMs: clippedStart.getTime(),
    endMs: clippedEnd.getTime()
  };
}

function buildDayEventPlacementMap(dayEvents, day) {
  const placementMap = new Map();
  const items = dayEvents
    .map((event) => {
      const geometry = getEventGeometryForDay(event, day);
      if (!geometry) return null;
      return { event, ...geometry };
    })
    .filter(Boolean)
    .sort((first, second) => {
      if (first.startMs !== second.startMs) return first.startMs - second.startMs;
      return second.endMs - first.endMs;
    });

  if (items.length === 0) {
    return placementMap;
  }

  const cluster = [];
  let active = [];
  let clusterEndMs = 0;

  function flushCluster() {
    if (cluster.length === 0) return;
    const totalColumns = Math.max(...cluster.map((item) => item.column)) + 1;
    const visibleColumns = Math.max(1, Math.min(totalColumns, MAX_VISIBLE_CONFLICT_COLUMNS));
    const hiddenItems = cluster.filter((item) => item.column >= visibleColumns);

    cluster.forEach((item) => {
      if (item.column >= visibleColumns) {
        return;
      }

      const leftPercent = (item.column * 100) / visibleColumns;
      const widthPercent = 100 / visibleColumns;
      const overflowCount =
        hiddenItems.length > 0 && item.column === visibleColumns - 1
          ? hiddenItems.filter(
              (hiddenItem) => hiddenItem.startMs < item.endMs && item.startMs < hiddenItem.endMs
            ).length
          : 0;

      placementMap.set(item.event, {
        columnCount: visibleColumns,
        totalColumnCount: totalColumns,
        height: item.height,
        overflowCount,
        style: {
          top: `${item.top}px`,
          height: `${item.height}px`,
          left: `calc(${leftPercent}% + 4px)`,
          width: `calc(${widthPercent}% - 8px)`,
          right: "auto"
        }
      });
    });
    cluster.length = 0;
    active = [];
    clusterEndMs = 0;
  }

  items.forEach((item) => {
    if (cluster.length > 0 && item.startMs >= clusterEndMs) {
      flushCluster();
    }

    active = active.filter((activeItem) => activeItem.endMs > item.startMs);
    const usedColumns = new Set(active.map((activeItem) => activeItem.column));
    let nextColumn = 0;
    while (usedColumns.has(nextColumn)) {
      nextColumn += 1;
    }

    const entry = { ...item, column: nextColumn };
    cluster.push(entry);
    active.push(entry);
    clusterEndMs = Math.max(clusterEndMs, item.endMs);
  });

  flushCluster();
  return placementMap;
}

export function CalendarManagementPage({ scope = "manager" }) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const isTattooerScope = scope === "tattooer";
  const [viewMode, setViewMode] = useState(VIEW_WEEK);
  const [cursorDate, setCursorDate] = useState(new Date());
  const [artists, setArtists] = useState([]);
  const [selectedArtistIds, setSelectedArtistIds] = useState([]);
  const [periodStart, setPeriodStart] = useState(toDateInputValue(startOfMonth(new Date())));
  const [periodEnd, setPeriodEnd] = useState(toDateInputValue(endOfMonth(new Date())));
  const [calendarData, setCalendarData] = useState({ appointments: [], blocks: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    async function loadArtists() {
      if (isTattooerScope) {
        setArtists([]);
        setSelectedArtistIds([]);
        return;
      }

      try {
        const data = await api.request("/artists");
        setArtists(data);
        setSelectedArtistIds(data.map((artist) => artist.id));
      } catch (requestError) {
        setError(requestError.message);
      }
    }
    loadArtists();
  }, [isTattooerScope]);

  useEffect(() => {
    async function loadCalendar() {
      if (!token) return;
      if (!isTattooerScope && artists.length === 0) return;
      if (!isTattooerScope && selectedArtistIds.length === 0) {
        setCalendarData({ appointments: [], blocks: [] });
        return;
      }

      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          from: periodStart,
          to: periodEnd
        });
        if (!isTattooerScope) {
          query.set("artistIds", selectedArtistIds.join(","));
        }
        const data = await api.request(`/appointments/calendar?${query.toString()}`, { token });
        setCalendarData(data);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    }

    loadCalendar();
  }, [token, artists.length, selectedArtistIds, periodStart, periodEnd, refreshCounter, isTattooerScope]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setRefreshCounter((current) => current + 1);
    }, 30000);

    return () => clearInterval(intervalId);
  }, []);

  const artistColorMap = useMemo(() => {
    const map = new Map();
    artists.forEach((artist, index) => {
      const paletteColor = ARTIST_PALETTE[index % ARTIST_PALETTE.length];
      map.set(artist.id, paletteColor);
    });
    return map;
  }, [artists]);

  const events = useMemo(() => {
    const appointmentEvents = (calendarData.appointments || []).map((item) => {
      const color = artistColorMap.get(item.artist_id) || ARTIST_PALETTE[0];
      return {
        id: `appt-${item.id}`,
        type: "appointment",
        appointmentId: item.id,
        artistId: item.artist_id,
        artistName: item.artist_name,
        status: item.status || "pending",
        statusLabel: getAppointmentStatusLabel(item.status),
        color: color.main,
        bgColor: color.soft,
        title: `${item.service_name} - ${item.client_name}`,
        start: parseEventDate(item.start_at),
        end: parseEventDate(item.end_at)
      };
    });

    const blockEvents = (calendarData.blocks || []).map((item) => {
      const color = artistColorMap.get(item.artist_id) || ARTIST_PALETTE[0];
      return {
        id: `block-${item.id}`,
        type: "block",
        artistId: item.artist_id,
        artistName: item.artist_name,
        color: color.main,
        bgColor: color.soft,
        title: `Bloqueio - ${item.reason}`,
        status: "blocked",
        statusLabel: "Bloqueio",
        start: parseEventDate(item.start_at),
        end: parseEventDate(item.end_at)
      };
    });

    return [...appointmentEvents, ...blockEvents];
  }, [calendarData, artistColorMap]);

  const referenceDate = useMemo(
    () => (viewMode === VIEW_TODAY ? startOfDay(new Date()) : cursorDate),
    [viewMode, cursorDate]
  );
  const viewDays = useMemo(() => buildViewDays(viewMode, referenceDate), [viewMode, referenceDate]);
  const allArtistsSelected =
    artists.length > 0 && selectedArtistIds.length === artists.length;

  const bookingLink = useMemo(() => {
    if (isTattooerScope) {
      return "/painel-tatuador";
    }
    const params = new URLSearchParams();
    if (selectedArtistIds.length === 1) {
      params.set("artistId", String(selectedArtistIds[0]));
    }
    params.set("date", toDateInputValue(referenceDate));
    const quickStartIso = buildIsoAtHour(referenceDate, 10, 0);
    const quickEndIso = buildIsoAtHour(referenceDate, 11, 0);
    if (quickStartIso && quickEndIso) {
      params.set("startAt", quickStartIso);
      params.set("endAt", quickEndIso);
    }
    return `/agendar?${params.toString()}`;
  }, [selectedArtistIds, referenceDate, isTattooerScope]);

  function toggleAllArtists() {
    if (allArtistsSelected) {
      setSelectedArtistIds([]);
    } else {
      setSelectedArtistIds(artists.map((artist) => artist.id));
    }
  }

  function toggleArtist(artistId) {
    setSelectedArtistIds((current) => {
      if (current.includes(artistId)) {
        return current.filter((item) => item !== artistId);
      }
      return [...current, artistId].sort((first, second) => first - second);
    });
  }

  function moveCursor(step) {
    if (viewMode === VIEW_TODAY) {
      return;
    }
    if (viewMode === VIEW_DAY) {
      setCursorDate((current) => addDays(current, step));
      return;
    }
    if (viewMode === VIEW_WEEK) {
      setCursorDate((current) => addDays(current, step * 7));
      return;
    }
    setCursorDate((current) => addMonths(current, step));
  }

  function updateDayDate(value) {
    if (!value) return;
    const nextDateIso = dateTimeLocalSaoPauloToIso(`${value}T12:00`);
    if (!nextDateIso) return;
    setCursorDate(new Date(nextDateIso));
  }

  function openEventInBooking(event) {
    if (isTattooerScope) {
      if (event.type === "appointment" && event.appointmentId) {
        navigate("/painel-tatuador", {
          state: {
            openAppointmentEdit: {
              appointmentId: event.appointmentId
            }
          }
        });
      } else {
        navigate("/painel-tatuador");
      }
      return;
    }

    const params = new URLSearchParams({
      artistId: String(event.artistId),
      date: toDateInputValue(event.start),
      startAt: event.start.toISOString(),
      endAt: event.end.toISOString()
    });
    if (event.type === "appointment" && event.appointmentId) {
      params.set("appointmentId", String(event.appointmentId));
    }
    navigate(`/agendar?${params.toString()}`);
  }

  function openSlotInBooking(day, hour) {
    if (isTattooerScope) {
      const range = getDayRangeAtHour(day, hour);
      const params = new URLSearchParams({
        date: toDateInputValue(day),
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString()
      });
      const ownArtistId = Number(Array.isArray(calendarData?.artistIds) ? calendarData.artistIds[0] : 0);
      if (Number.isInteger(ownArtistId) && ownArtistId > 0) {
        params.set("artistId", String(ownArtistId));
      }
      navigate(`/agendar?${params.toString()}`);
      return;
    }

    const range = getDayRangeAtHour(day, hour);
    const params = new URLSearchParams({
      date: toDateInputValue(day),
      startAt: range.start.toISOString(),
      endAt: range.end.toISOString()
    });
    if (selectedArtistIds.length === 1) {
      params.set("artistId", String(selectedArtistIds[0]));
    }
    navigate(`/agendar?${params.toString()}`);
  }

  const hours = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => HOUR_START + index),
    []
  );

  const visibleTitle = useMemo(() => {
    if (viewMode === VIEW_TODAY) {
      const today = startOfDay(new Date());
      return `Hoje, ${formatWeekday(today)}, ${formatDateLabel(today)}`;
    }
    if (viewMode === VIEW_DAY) {
      return `${formatWeekday(cursorDate)}, ${formatDateLabel(cursorDate)}`;
    }
    if (viewMode === VIEW_WEEK) {
      const weekStart = viewDays[0];
      const weekEnd = viewDays[viewDays.length - 1];
      return `${formatDateLabel(weekStart)} - ${formatDateLabel(weekEnd)}`;
    }
    return formatMonthTitle(cursorDate);
  }, [viewMode, cursorDate, viewDays]);

  return (
    <section className="section">
      <div className="container">
        <div className="page-heading">
          <h1>{isTattooerScope ? "Agenda do Tatuador" : "Agenda Gerencial"}</h1>
          <p>
            {isTattooerScope
              ? "Visualize seus agendamentos em formato calendar e acesse o painel para manutencao."
              : "Visão diária, semanal e mensal com filtro por período e múltiplos tatuadores."}
          </p>
        </div>

        <FeedbackMessage message={error} type="error" />

        <div className="calendar-layout">
          <aside className="panel calendar-sidebar">
            <h2>Filtros</h2>
            <div className="form">
              <label>
                Período inicial
                <input
                  type="date"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                />
              </label>
              <label>
                Período final
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                />
              </label>
            </div>

            {!isTattooerScope ? (
              <div className="calendar-artist-filter">
                <h3>Tatuadores</h3>
                <label className="calendar-check-item">
                  <input type="checkbox" checked={allArtistsSelected} onChange={toggleAllArtists} />
                  <span>Todos</span>
                </label>
                <div className="calendar-checklist">
                  {artists.map((artist) => (
                    <label className="calendar-check-item" key={artist.id}>
                      <input
                        type="checkbox"
                        checked={selectedArtistIds.includes(artist.id)}
                        onChange={() => toggleArtist(artist.id)}
                      />
                      <span
                        className="calendar-artist-dot"
                        style={{ backgroundColor: (artistColorMap.get(artist.id) || ARTIST_PALETTE[0]).main }}
                      />
                      <span>{artist.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted">Exibindo apenas os seus horários.</p>
            )}

            <Link className="button button-primary full" to={bookingLink}>
              {isTattooerScope ? "Ir para Painel do Tatuador" : "Ir para Agendamento"}
            </Link>
            <button
              className="button button-outline full"
              onClick={() => setRefreshCounter((current) => current + 1)}
              type="button"
            >
              Atualizar agenda
            </button>
          </aside>

          <section className="panel calendar-main">
            <div className="calendar-toolbar">
              <div className="calendar-view-buttons">
                <button
                  className={`button button-outline small ${viewMode === VIEW_TODAY ? "active" : ""}`}
                  onClick={() => setViewMode(VIEW_TODAY)}
                  type="button"
                >
                  Hoje
                </button>
                <button
                  className={`button button-outline small ${viewMode === VIEW_DAY ? "active" : ""}`}
                  onClick={() => setViewMode(VIEW_DAY)}
                  type="button"
                >
                  Dia
                </button>
                <button
                  className={`button button-outline small ${viewMode === VIEW_WEEK ? "active" : ""}`}
                  onClick={() => setViewMode(VIEW_WEEK)}
                  type="button"
                >
                  Semana
                </button>
                <button
                  className={`button button-outline small ${viewMode === VIEW_MONTH ? "active" : ""}`}
                  onClick={() => setViewMode(VIEW_MONTH)}
                  type="button"
                >
                  Mês
                </button>
              </div>

              <div className="calendar-nav">
                <button
                  className="button button-outline small"
                  disabled={viewMode === VIEW_TODAY}
                  onClick={() => moveCursor(-1)}
                  type="button"
                >
                  Anterior
                </button>
                <input
                  className="calendar-nav-date"
                  disabled={viewMode === VIEW_TODAY}
                  onChange={(event) => updateDayDate(event.target.value)}
                  type="date"
                  value={toDateInputValue(referenceDate)}
                />
                <button
                  className="button button-outline small"
                  disabled={viewMode === VIEW_TODAY}
                  onClick={() => moveCursor(1)}
                  type="button"
                >
                  Próximo
                </button>
              </div>

              <strong className="calendar-title">{visibleTitle}</strong>
            </div>

            {loading ? <p>Carregando agenda...</p> : null}

            {viewMode === VIEW_MONTH ? (
              <div className="calendar-month-grid">
                {viewDays.map((day) => {
                  const dayEvents = getEventsForDay(events, day);
                  const dayParts = getSaoPauloDateParts(day);
                  const cursorParts = getSaoPauloDateParts(cursorDate);
                  const inCurrentMonth = dayParts.month === cursorParts.month;
                  const dayKey = toDateInputValue(day);
                  return (
                    <article
                      className={`calendar-month-cell ${inCurrentMonth ? "" : "outside"}`}
                      key={`${dayKey}-month`}
                    >
                      <header>
                        <strong>{dayParts.day}</strong>
                        <span>{formatWeekday(day)}</span>
                      </header>
                      <div className="calendar-month-events">
                        {dayEvents.slice(0, 3).map((event) => (
                          <button
                            className={`calendar-month-event ${event.type}`}
                            key={event.id}
                            onClick={() => openEventInBooking(event)}
                            style={{
                              borderLeftColor: event.color,
                              backgroundColor: event.bgColor
                            }}
                            title={`${event.artistName} | ${event.title} | ${formatHour(event.start)} - ${formatHour(event.end)} | ${event.statusLabel}`}
                            type="button"
                          >
                            <span className="calendar-month-event-title">
                              {formatHour(event.start)} {event.artistName}
                            </span>
                            {event.type === "appointment" ? (
                              <span className={`calendar-status-badge calendar-status-${event.status}`}>
                                {event.statusLabel}
                              </span>
                            ) : (
                              <span className="calendar-status-badge calendar-status-badge-block">
                                Bloqueio
                              </span>
                            )}
                          </button>
                        ))}
                        {dayEvents.length > 3 ? (
                          <span className="calendar-more-events">+{dayEvents.length - 3} eventos</span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={`calendar-time-grid days-${viewDays.length}`}>
                <div className="calendar-time-axis">
                  <div className="calendar-time-axis-header" />
                  <div className="calendar-time-axis-body" style={{ height: `${(HOUR_END - HOUR_START) * HOUR_HEIGHT}px` }}>
                    {hours.map((hour) => (
                      <div className="calendar-hour-label" key={`axis-${hour}`}>
                        {String(hour).padStart(2, "0")}:00
                      </div>
                    ))}
                  </div>
                </div>

                {viewDays.map((day) => {
                  const dayEvents = getEventsForDay(events, day);
                  const dayEventPlacementMap = buildDayEventPlacementMap(dayEvents, day);
                  const dayKey = toDateInputValue(day);
                  return (
                    <div className="calendar-time-column" key={dayKey}>
                      <div className="calendar-time-column-header">
                        <strong>{formatWeekday(day)}</strong>
                        <span>{formatDateLabel(day)}</span>
                      </div>
                      <div
                        className="calendar-time-column-body"
                        style={{ height: `${(HOUR_END - HOUR_START) * HOUR_HEIGHT}px` }}
                      >
                        {hours.slice(0, -1).map((hour) => (
                          <button
                            className="calendar-hour-line"
                            key={`${dayKey}-${hour}`}
                            onClick={() => openSlotInBooking(day, hour)}
                            type="button"
                          />
                        ))}

                        {dayEvents.map((event) => {
                          const placement = dayEventPlacementMap.get(event);
                          if (!placement) return null;
                          const isCompact = Number.isFinite(placement.height) && placement.height < 56;
                          const isCrowded = placement.totalColumnCount > 1;
                          const overflowTitleSuffix =
                            placement.overflowCount > 0 ? ` | +${placement.overflowCount} simultaneos` : "";
                          return (
                            <button
                              className={`calendar-event-chip ${event.type} ${isCompact ? "compact" : ""} ${isCrowded ? "crowded" : ""}`}
                              key={`${event.id}-${dayKey}`}
                              onClick={() => openEventInBooking(event)}
                              style={{
                                ...placement.style,
                                borderLeftColor: event.color,
                                backgroundColor: event.bgColor
                              }}
                              title={`${event.artistName} | ${event.title} | ${formatHour(event.start)} - ${formatHour(event.end)} | ${event.statusLabel}${overflowTitleSuffix}`}
                              type="button"
                            >
                              <strong className="calendar-event-artist">{event.artistName}</strong>
                              {placement.overflowCount > 0 ? (
                                <span className="calendar-overflow-badge">+{placement.overflowCount}</span>
                              ) : null}
                              <span className="calendar-event-title">{event.title}</span>
                              <div className="calendar-event-meta">
                                <small>
                                  {formatHour(event.start)}-{formatHour(event.end)}
                                </small>
                                {event.type === "appointment" ? (
                                  <span className={`calendar-status-badge calendar-status-${event.status}`}>
                                    {event.statusLabel}
                                  </span>
                                ) : (
                                  <span className="calendar-status-badge calendar-status-badge-block">
                                    Bloqueio
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
