const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, forbidden, notFound } = require("../../utils/http");
const { dayjs, isValidIsoDate } = require("../../utils/date");
const {
  getArtistIdForUser,
  findScheduleConflicts,
  buildAvailabilitySlots
} = require("./appointments.service");

const router = express.Router();

const getServiceStmt = db.prepare(`
  SELECT id, name, duration_minutes, price, deposit_amount, active
  FROM services
  WHERE id = ?
`);
const getArtistStmt = db.prepare(`
  SELECT a.id, a.user_id, u.name AS artist_name, COALESCE(a.commission_percentage, 0) AS commission_percentage
  FROM artists a
  JOIN users u ON u.id = a.user_id
  WHERE a.id = ?
`);
const getClientForSchedulingStmt = db.prepare(`
  SELECT
    u.id,
    u.name,
    u.role,
    cp.birth_date
  FROM users u
  LEFT JOIN client_profiles cp ON cp.user_id = u.id
  WHERE u.id = ?
`);
const createAppointmentStmt = db.prepare(`
  INSERT INTO appointments
    (
      client_id,
      artist_id,
      service_id,
      start_at,
      end_at,
      status,
      total_value,
      notes,
      guardian_name,
      deposit_paid,
      deposit_payment_status
    )
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const createNotificationStmt = db.prepare(`
  INSERT INTO notifications (type, target_user_id, message, channel, status)
  VALUES (?, ?, ?, ?, ?)
`);
const createFinancialStmt = db.prepare(`
  INSERT INTO financial_transactions
    (type, category, amount, artist_id, appointment_id, order_id, description, occurred_on)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?)
`);
const findCompletionIncomeStmt = db.prepare(`
  SELECT id
  FROM financial_transactions
  WHERE type = 'income'
    AND category = 'sessao concluida'
    AND appointment_id = ?
  LIMIT 1
`);
const findCompletionCommissionStmt = db.prepare(`
  SELECT id
  FROM artist_commission_movements
  WHERE movement_type = 'entry'
    AND reference_type = 'appointment_completion'
    AND reference_id = ?
  LIMIT 1
`);
const createCommissionMovementStmt = db.prepare(`
  INSERT INTO artist_commission_movements
    (
      artist_id,
      movement_type,
      amount,
      description,
      occurred_on,
      reference_type,
      reference_id,
      created_by
    )
  VALUES
    (?, 'entry', ?, ?, ?, 'appointment_completion', ?, ?)
`);
const createBlockStmt = db.prepare(`
  INSERT INTO calendar_blocks (artist_id, start_at, end_at, reason, created_by)
  VALUES (?, ?, ?, ?, ?)
`);
const getAppointmentRawStmt = db.prepare(`
  SELECT
    ap.*,
    s.name AS service_name,
    s.price AS service_price,
    s.deposit_amount AS service_deposit,
    u.name AS client_name,
    au.name AS artist_name,
    a.user_id AS artist_user_id,
    COALESCE(a.commission_percentage, 0) AS commission_percentage
  FROM appointments ap
  JOIN services s ON s.id = ap.service_id
  JOIN users u ON u.id = ap.client_id
  JOIN artists a ON a.id = ap.artist_id
  JOIN users au ON au.id = a.user_id
  WHERE ap.id = ?
`);

function getAppointmentById(id) {
  return getAppointmentRawStmt.get(id);
}

function parseIdList(rawValue) {
  if (!rawValue) return [];
  const values = String(rawValue)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return [...new Set(values)];
}

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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseMoney(value, fallback = 0) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeBookingStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["pending", "confirmed", "completed", "cancelled"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeAppointmentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["pending", "confirmed", "completed", "cancelled"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function applyCompletionEffects({ appointment, totalValue, updatedBy }) {
  const resolvedTotalValue = roundMoney(Math.max(Number(totalValue || 0), 0));
  const depositPaid = roundMoney(Number(appointment.deposit_paid || 0));

  const remainingAmount = roundMoney(Math.max(resolvedTotalValue - depositPaid, 0));
  const existingCompletionIncome = findCompletionIncomeStmt.get(appointment.id);
  if (!existingCompletionIncome && remainingAmount > 0) {
    createFinancialStmt.run(
      "income",
      "sessao concluida",
      remainingAmount,
      appointment.artist_id,
      appointment.id,
      null,
      `Finalizacao do atendimento de ${appointment.client_name}`,
      dayjs().format("YYYY-MM-DD")
    );
  }

  const artistCommissionPercentage = Number(appointment.commission_percentage || 0);
  const commissionAmount = roundMoney((resolvedTotalValue * artistCommissionPercentage) / 100);
  const existingCompletionCommission = findCompletionCommissionStmt.get(appointment.id);
  if (!existingCompletionCommission && commissionAmount > 0) {
    createCommissionMovementStmt.run(
      appointment.artist_id,
      commissionAmount,
      `Comissao gerada pelo agendamento #${appointment.id}`,
      dayjs().format("YYYY-MM-DD"),
      appointment.id,
      updatedBy || null
    );
  }
}

router.get("/availability", (req, res) => {
  const artistId = Number(req.query.artistId);
  const date = req.query.date;
  const durationMinutes = Number(req.query.durationMinutes || 120);
  const rawExcludeAppointmentId = req.query.excludeAppointmentId;
  const excludeAppointmentId =
    rawExcludeAppointmentId === undefined ? null : Number(rawExcludeAppointmentId);

  if (!artistId || !date) {
    return badRequest(res, "Parâmetros obrigatórios: artistId e date (YYYY-MM-DD).");
  }
  if (Number.isNaN(durationMinutes) || durationMinutes <= 0) {
    return badRequest(res, "durationMinutes inválido.");
  }
  if (
    rawExcludeAppointmentId !== undefined &&
    (!Number.isInteger(excludeAppointmentId) || excludeAppointmentId <= 0)
  ) {
    return badRequest(res, "excludeAppointmentId invalido.");
  }

  const artist = getArtistStmt.get(artistId);
  if (!artist) {
    return notFound(res, "Artista não encontrado.");
  }

  const slots = buildAvailabilitySlots({
    artistId,
    date,
    durationMinutes,
    excludeAppointmentId
  });
  return res.json({
    artistId,
    date,
    durationMinutes,
    slots
  });
});

router.get("/services", (_req, res) => {
  const services = db
    .prepare(
      `
      SELECT id, name, description, duration_minutes, price, deposit_amount
      FROM services
      WHERE active = 1
      ORDER BY price ASC
    `
    )
    .all();
  return res.json(services);
});

router.post("/", authenticate, requireRoles("cliente", "gerente", "tatuador"), (req, res) => {
  const {
    artistId,
    serviceId,
    startAt,
    endAt,
    notes,
    clientId,
    depositPaid,
    guardianName,
    status: requestedStatus,
    totalValue
  } = req.body;

  if ((!artistId && req.user.role !== "tatuador") || !serviceId || !startAt) {
    return badRequest(res, "Campos obrigatorios: artistId, serviceId e startAt.");
  }
  if (!isValidIsoDate(startAt)) {
    return badRequest(res, "startAt invalido.");
  }
  if (endAt && !isValidIsoDate(endAt)) {
    return badRequest(res, "endAt invalido.");
  }

  const targetClientId = req.user.role === "cliente" ? req.user.id : Number(clientId);
  if (!targetClientId) {
    return badRequest(res, "clientId e obrigatorio para o gerente.");
  }
  const client = getClientForSchedulingStmt.get(targetClientId);
  if (!client || client.role !== "cliente") {
    return notFound(res, "Cliente nao encontrado.");
  }

  const clientAge = getAgeFromBirthDate(client.birth_date);
  const isClientMinor = clientAge !== null && clientAge < 18;
  const normalizedGuardianName = String(guardianName || "").trim();
  if (isClientMinor && !normalizedGuardianName) {
    return badRequest(res, "Cliente menor de 18 anos: informe o responsavel.");
  }

  const requestedArtistId = Number(artistId);
  let targetArtistId = requestedArtistId;

  if (req.user.role === "tatuador") {
    const ownArtistId = getArtistIdForUser(req.user.id);
    if (!ownArtistId) {
      return notFound(res, "Perfil de tatuador nao encontrado.");
    }
    if (
      Number.isInteger(requestedArtistId) &&
      requestedArtistId > 0 &&
      requestedArtistId !== ownArtistId
    ) {
      return forbidden(res);
    }
    targetArtistId = ownArtistId;
  }

  if (!Number.isInteger(targetArtistId) || targetArtistId <= 0) {
    return badRequest(res, "artistId invalido.");
  }

  const service = getServiceStmt.get(serviceId);
  if (!service || !service.active) {
    return notFound(res, "Servico nao encontrado.");
  }

  const artist = getArtistStmt.get(targetArtistId);
  if (!artist) {
    return notFound(res, "Artista nao encontrado.");
  }

  const start = dayjs(startAt);
  const end = endAt ? dayjs(endAt) : start.add(service.duration_minutes, "minute");
  if (!start.isBefore(end)) {
    return badRequest(res, "Horario final precisa ser posterior ao horario inicial.");
  }

  const conflicts = findScheduleConflicts(targetArtistId, start.toISOString(), end.toISOString());
  if (conflicts.appointments.length || conflicts.blocks.length) {
    return res.status(409).json({
      message: "Horario indisponivel para o artista selecionado.",
      conflicts
    });
  }

  const safeDepositPaid = parseMoney(depositPaid, 0);
  if (!Number.isFinite(safeDepositPaid) || safeDepositPaid < 0) {
    return badRequest(res, "Valor de sinal invalido.");
  }
  const resolvedDeposit = roundMoney(safeDepositPaid > 0 ? safeDepositPaid : 0);

  const parsedTotalValue = parseMoney(totalValue, service.price);
  if (!Number.isFinite(parsedTotalValue) || parsedTotalValue < 0) {
    return badRequest(res, "Valor total invalido.");
  }
  const resolvedTotalValue = roundMoney(parsedTotalValue);

  let status = "pending";
  if (req.user.role === "gerente") {
    status = resolvedDeposit >= service.deposit_amount ? "confirmed" : "pending";
    if (requestedStatus !== undefined) {
      const normalizedStatus = normalizeBookingStatus(requestedStatus);
      if (!normalizedStatus) {
        return badRequest(res, "Status invalido.");
      }
      status = normalizedStatus;
    }
  }

  const paymentStatus = resolvedDeposit > 0 ? "paid" : "none";

  const appointmentId = createAppointmentStmt.run(
    targetClientId,
    targetArtistId,
    serviceId,
    start.toISOString(),
    end.toISOString(),
    status,
    resolvedTotalValue,
    notes || "",
    normalizedGuardianName || null,
    resolvedDeposit,
    paymentStatus
  ).lastInsertRowid;

  const createdAppointment = getAppointmentById(appointmentId);

  createNotificationStmt.run(
    "appointment_created",
    targetClientId,
    `Seu agendamento para ${createdAppointment.service_name} foi registrado para ${dayjs(createdAppointment.start_at).format("DD/MM/YYYY HH:mm")}.`,
    "email",
    "pending"
  );
  createNotificationStmt.run(
    "appointment_created",
    createdAppointment.artist_user_id,
    `Novo agendamento recebido de ${createdAppointment.client_name}.`,
    "app",
    "pending"
  );

  if (resolvedDeposit > 0) {
    createFinancialStmt.run(
      "income",
      "sinal agendamento",
      resolvedDeposit,
      targetArtistId,
      appointmentId,
      null,
      `Sinal de ${createdAppointment.client_name}`,
      dayjs().format("YYYY-MM-DD")
    );
  }

  if (status === "completed") {
    applyCompletionEffects({
      appointment: createdAppointment,
      totalValue: resolvedTotalValue,
      updatedBy: req.user.id
    });
  }

  return res.status(201).json(getAppointmentById(appointmentId));
});

router.get("/me", authenticate, requireRoles("cliente", "tatuador"), (req, res) => {
  let appointments = [];

  if (req.user.role === "cliente") {
    appointments = db
      .prepare(
        `
          SELECT
            ap.*,
            s.name AS service_name,
            s.price AS service_price,
            u.name AS artist_name
          FROM appointments ap
          JOIN services s ON s.id = ap.service_id
          JOIN artists a ON a.id = ap.artist_id
          JOIN users u ON u.id = a.user_id
          WHERE ap.client_id = ?
          ORDER BY ap.start_at DESC
        `
      )
      .all(req.user.id);
  } else {
    const artistId = getArtistIdForUser(req.user.id);
    if (!artistId) {
      return notFound(res, "Perfil de tatuador não encontrado.");
    }
    appointments = db
      .prepare(
        `
          SELECT
            ap.*,
            s.name AS service_name,
            s.price AS service_price,
            u.name AS client_name
          FROM appointments ap
          JOIN services s ON s.id = ap.service_id
          JOIN users u ON u.id = ap.client_id
          WHERE ap.artist_id = ?
          ORDER BY ap.start_at DESC
        `
      )
      .all(artistId);
  }

  return res.json(appointments);
});

router.get("/manager", authenticate, requireRoles("gerente"), (req, res) => {
  const filters = [];
  const params = [];

  const artistIds = parseIdList(req.query.artistIds);
  if (artistIds.length > 0) {
    filters.push(`ap.artist_id IN (${artistIds.map(() => "?").join(",")})`);
    params.push(...artistIds);
  } else if (req.query.artistId) {
    filters.push("ap.artist_id = ?");
    params.push(Number(req.query.artistId));
  }
  if (req.query.status) {
    filters.push("ap.status = ?");
    params.push(req.query.status);
  }
  if (req.query.serviceId) {
    filters.push("ap.service_id = ?");
    params.push(Number(req.query.serviceId));
  }
  if (req.query.from) {
    filters.push("ap.start_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    filters.push("ap.start_at <= ?");
    params.push(req.query.to);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const sql = `
    SELECT
      ap.id,
      ap.start_at,
      ap.end_at,
      ap.status,
      ap.total_value,
      ap.notes,
      ap.cancel_reason,
      ap.deposit_paid,
      s.name AS service_name,
      c.name AS client_name,
      a.id AS artist_id,
      au.name AS artist_name,
      a.color_code
    FROM appointments ap
    JOIN services s ON s.id = ap.service_id
    JOIN users c ON c.id = ap.client_id
    JOIN artists a ON a.id = ap.artist_id
    JOIN users au ON au.id = a.user_id
    ${whereSql}
    ORDER BY ap.start_at ASC
  `;

  const appointments = db.prepare(sql).all(...params);
  return res.json(appointments);
});

router.get("/calendar", authenticate, requireRoles("gerente", "tatuador"), (req, res) => {
  const now = dayjs();
  const fromBase = req.query.from && isValidIsoDate(req.query.from)
    ? dayjs(req.query.from)
    : now.startOf("month");
  const toBase = req.query.to && isValidIsoDate(req.query.to)
    ? dayjs(req.query.to)
    : now.endOf("month");

  if (!fromBase.isValid() || !toBase.isValid()) {
    return badRequest(res, "Parâmetros de período inválidos.");
  }
  if (fromBase.isAfter(toBase)) {
    return badRequest(res, "Período inválido: from deve ser anterior a to.");
  }

  const fromIso = fromBase.startOf("day").toISOString();
  const toIso = toBase.endOf("day").toISOString();

  let artistIds = [];
  if (req.user.role === "tatuador") {
    const ownArtistId = getArtistIdForUser(req.user.id);
    if (!ownArtistId) {
      return notFound(res, "Perfil de tatuador não encontrado.");
    }
    artistIds = [ownArtistId];
  } else {
    const fromList = parseIdList(req.query.artistIds);
    if (fromList.length > 0) {
      artistIds = fromList;
    } else if (req.query.artistId) {
      artistIds = parseIdList(req.query.artistId);
    }
  }

  const artistFilterSql = artistIds.length
    ? ` AND ap.artist_id IN (${artistIds.map(() => "?").join(",")})`
    : "";
  const blockArtistFilterSql = artistIds.length
    ? ` AND b.artist_id IN (${artistIds.map(() => "?").join(",")})`
    : "";

  const appointments = db
    .prepare(
      `
      SELECT
        ap.id,
        ap.artist_id,
        ap.client_id,
        ap.service_id,
        ap.start_at,
        ap.end_at,
        ap.status,
        ap.notes,
        s.name AS service_name,
        c.name AS client_name,
        a.color_code,
        au.name AS artist_name
      FROM appointments ap
      JOIN services s ON s.id = ap.service_id
      JOIN users c ON c.id = ap.client_id
      JOIN artists a ON a.id = ap.artist_id
      JOIN users au ON au.id = a.user_id
      WHERE ap.status <> 'cancelled'
        AND ? < ap.end_at
        AND ? > ap.start_at
        ${artistFilterSql}
      ORDER BY ap.start_at ASC
    `
    )
    .all(fromIso, toIso, ...(artistIds.length ? artistIds : []));

  const blocks = db
    .prepare(
      `
      SELECT
        b.id,
        b.artist_id,
        b.start_at,
        b.end_at,
        b.reason,
        b.created_at,
        a.color_code,
        au.name AS artist_name
      FROM calendar_blocks b
      JOIN artists a ON a.id = b.artist_id
      JOIN users au ON au.id = a.user_id
      WHERE ? < b.end_at
        AND ? > b.start_at
        ${blockArtistFilterSql}
      ORDER BY b.start_at ASC
    `
    )
    .all(fromIso, toIso, ...(artistIds.length ? artistIds : []));

  return res.json({
    from: fromIso,
    to: toIso,
    artistIds,
    appointments,
    blocks
  });
});

router.post("/block", authenticate, requireRoles("tatuador", "gerente"), (req, res) => {
  const { artistId, startAt, endAt, reason } = req.body;
  if (!startAt || !endAt || !reason) {
    return badRequest(res, "Campos obrigatórios: startAt, endAt e reason.");
  }
  if (!isValidIsoDate(startAt) || !isValidIsoDate(endAt)) {
    return badRequest(res, "Datas inválidas.");
  }
  if (!dayjs(startAt).isBefore(dayjs(endAt))) {
    return badRequest(res, "startAt precisa ser anterior a endAt.");
  }

  let targetArtistId = Number(artistId);
  if (req.user.role === "tatuador") {
    targetArtistId = getArtistIdForUser(req.user.id);
    if (!targetArtistId) {
      return notFound(res, "Perfil de tatuador não encontrado.");
    }
  } else if (!targetArtistId) {
    return badRequest(res, "artistId é obrigatório para gerente.");
  }

  const artist = getArtistStmt.get(targetArtistId);
  if (!artist) {
    return notFound(res, "Artista não encontrado.");
  }

  const conflicts = findScheduleConflicts(targetArtistId, startAt, endAt);
  const blockId = createBlockStmt.run(
    targetArtistId,
    startAt,
    endAt,
    String(reason).trim(),
    req.user.id
  ).lastInsertRowid;

  if (conflicts.appointments.length > 0) {
    const clientIds = db
      .prepare(
        `
          SELECT DISTINCT client_id
          FROM appointments
          WHERE id IN (${conflicts.appointments.map(() => "?").join(",")})
        `
      )
      .all(...conflicts.appointments.map((item) => item.id))
      .map((row) => row.client_id);

    clientIds.forEach((clientId) => {
      createNotificationStmt.run(
        "schedule_conflict",
        clientId,
        `Seu horário com ${artist.artist_name} entrou em conflito por bloqueio de agenda.`,
        "email",
        "pending"
      );
    });
  }

  return res.status(201).json({
    id: blockId,
    artistId: targetArtistId,
    startAt,
    endAt,
    reason,
    conflicts
  });
});

router.get("/blocks/me", authenticate, requireRoles("tatuador", "gerente"), (req, res) => {
  const filters = [];
  const params = [];

  if (req.user.role === "tatuador") {
    const artistId = getArtistIdForUser(req.user.id);
    if (!artistId) {
      return notFound(res, "Perfil de tatuador não encontrado.");
    }
    filters.push("b.artist_id = ?");
    params.push(artistId);
  } else if (req.query.artistId) {
    filters.push("b.artist_id = ?");
    params.push(Number(req.query.artistId));
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const blocks = db
    .prepare(
      `
      SELECT
        b.id,
        b.artist_id,
        b.start_at,
        b.end_at,
        b.reason,
        b.created_at,
        au.name AS artist_name,
        cu.name AS created_by_name
      FROM calendar_blocks b
      JOIN artists a ON a.id = b.artist_id
      JOIN users au ON au.id = a.user_id
      JOIN users cu ON cu.id = b.created_by
      ${whereSql}
      ORDER BY b.start_at DESC
    `
    )
    .all(...params);

  return res.json(blocks);
});

router.delete("/block/:id", authenticate, requireRoles("tatuador", "gerente"), (req, res) => {
  const blockId = Number(req.params.id);
  if (!blockId) {
    return badRequest(res, "ID do bloqueio inválido.");
  }

  const block = db
    .prepare(
      `
      SELECT b.id, b.artist_id
      FROM calendar_blocks b
      WHERE b.id = ?
    `
    )
    .get(blockId);

  if (!block) {
    return notFound(res, "Bloqueio não encontrado.");
  }

  if (req.user.role === "tatuador") {
    const ownArtistId = getArtistIdForUser(req.user.id);
    if (ownArtistId !== block.artist_id) {
      return forbidden(res);
    }
  }

  db.prepare("DELETE FROM calendar_blocks WHERE id = ?").run(blockId);
  return res.json({ message: "Bloqueio removido com sucesso." });
});

router.get("/:id", authenticate, requireRoles("cliente", "tatuador", "gerente"), (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!appointmentId) {
    return badRequest(res, "ID do agendamento inválido.");
  }

  const appointment = getAppointmentById(appointmentId);
  if (!appointment) {
    return notFound(res, "Agendamento não encontrado.");
  }

  if (req.user.role === "cliente" && appointment.client_id !== req.user.id) {
    return forbidden(res);
  }

  if (req.user.role === "tatuador") {
    const ownArtistId = getArtistIdForUser(req.user.id);
    if (ownArtistId !== appointment.artist_id) {
      return forbidden(res);
    }
  }

  return res.json(appointment);
});

router.patch("/:id/status", authenticate, requireRoles("cliente", "tatuador", "gerente"), (req, res) => {
  const appointmentId = Number(req.params.id);
  const { status, cancelReason, refundDeposit, totalValue } = req.body;

  const nextStatus = normalizeAppointmentStatus(status);
  if (!nextStatus) {
    return badRequest(res, "Status invalido.");
  }

  const appointment = getAppointmentById(appointmentId);
  if (!appointment) {
    return notFound(res, "Agendamento nao encontrado.");
  }

  if (req.user.role === "cliente") {
    if (appointment.client_id !== req.user.id) {
      return forbidden(res);
    }
    if (nextStatus !== "cancelled") {
      return badRequest(res, "Cliente so pode cancelar o proprio agendamento.");
    }
  }

  if (req.user.role === "tatuador") {
    const ownArtistId = getArtistIdForUser(req.user.id);
    if (ownArtistId !== appointment.artist_id) {
      return forbidden(res);
    }
  }

  if (appointment.status === "completed" && nextStatus !== "completed") {
    return badRequest(res, "Agendamento concluido nao pode ser alterado.");
  }

  const parsedTotalValue = parseMoney(totalValue, appointment.total_value ?? appointment.service_price);
  if (!Number.isFinite(parsedTotalValue) || parsedTotalValue < 0) {
    return badRequest(res, "Valor total invalido.");
  }
  const resolvedTotalValue = roundMoney(parsedTotalValue);

  db.prepare(
    `
      UPDATE appointments
      SET status = ?, total_value = ?, cancel_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(nextStatus, resolvedTotalValue, cancelReason || null, appointmentId);

  if (nextStatus === "completed" && appointment.status !== "completed") {
    applyCompletionEffects({
      appointment,
      totalValue: resolvedTotalValue,
      updatedBy: req.user.id
    });
  }

  if (
    nextStatus === "cancelled" &&
    refundDeposit === true &&
    appointment.deposit_paid > 0 &&
    appointment.deposit_payment_status === "paid"
  ) {
    db.prepare(
      `
        UPDATE appointments
        SET deposit_payment_status = 'refunded', updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(appointmentId);

    createFinancialStmt.run(
      "expense",
      "reembolso sinal",
      appointment.deposit_paid,
      appointment.artist_id,
      appointment.id,
      null,
      `Reembolso para ${appointment.client_name}`,
      dayjs().format("YYYY-MM-DD")
    );
  }

  createNotificationStmt.run(
    "appointment_status",
    appointment.client_id,
    `Seu agendamento #${appointment.id} foi atualizado para: ${nextStatus}.`,
    "email",
    "pending"
  );

  if (req.user.role === "cliente") {
    createNotificationStmt.run(
      "appointment_status",
      appointment.artist_user_id,
      `O cliente ${appointment.client_name} cancelou o agendamento #${appointment.id}.`,
      "app",
      "pending"
    );
  }

  return res.json(getAppointmentById(appointmentId));
});

router.patch("/:id/reschedule", authenticate, requireRoles("cliente", "tatuador", "gerente"), (req, res) => {
  const appointmentId = Number(req.params.id);
  const { startAt, endAt, status, totalValue } = req.body;

  if (!startAt || !isValidIsoDate(startAt)) {
    return badRequest(res, "startAt invalido.");
  }
  if (endAt && !isValidIsoDate(endAt)) {
    return badRequest(res, "endAt invalido.");
  }

  const appointment = getAppointmentById(appointmentId);
  if (!appointment) {
    return notFound(res, "Agendamento nao encontrado.");
  }
  if (req.user.role === "cliente") {
    if (appointment.client_id !== req.user.id) {
      return forbidden(res);
    }
    if (status !== undefined) {
      return badRequest(res, "Cliente nao pode alterar status ao reagendar.");
    }
  }
  if (req.user.role === "tatuador") {
    const ownArtistId = getArtistIdForUser(req.user.id);
    if (ownArtistId !== appointment.artist_id) {
      return forbidden(res);
    }
  }

  if (appointment.status === "completed") {
    return badRequest(res, "Agendamento concluido nao pode ser reagendado.");
  }

  const parsedStatus = status !== undefined ? normalizeBookingStatus(status) : null;
  if (status !== undefined && !parsedStatus) {
    return badRequest(res, "Status invalido.");
  }

  const parsedTotalValue = parseMoney(totalValue, appointment.total_value ?? appointment.service_price);
  if (!Number.isFinite(parsedTotalValue) || parsedTotalValue < 0) {
    return badRequest(res, "Valor total invalido.");
  }
  const resolvedTotalValue = roundMoney(parsedTotalValue);

  const newStart = dayjs(startAt);
  let newEnd = null;

  if (endAt) {
    newEnd = dayjs(endAt);
  } else {
    const durationMinutes = dayjs(appointment.end_at).diff(dayjs(appointment.start_at), "minute");
    newEnd = newStart.add(durationMinutes, "minute");
  }

  if (!newStart.isBefore(newEnd)) {
    return badRequest(res, "Horario final precisa ser posterior ao inicio.");
  }

  const conflicts = findScheduleConflicts(
    appointment.artist_id,
    newStart.toISOString(),
    newEnd.toISOString(),
    appointmentId
  );

  if (conflicts.appointments.length || conflicts.blocks.length) {
    return res.status(409).json({
      message: "Novo horario indisponivel.",
      conflicts
    });
  }

  const nextStatus = req.user.role === "cliente" ? "pending" : parsedStatus || "confirmed";

  db.prepare(
    `
      UPDATE appointments
      SET start_at = ?, end_at = ?, status = ?, total_value = ?, updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(newStart.toISOString(), newEnd.toISOString(), nextStatus, resolvedTotalValue, appointmentId);

  if (nextStatus === "completed" && appointment.status !== "completed") {
    applyCompletionEffects({
      appointment,
      totalValue: resolvedTotalValue,
      updatedBy: req.user.id
    });
  }

  createNotificationStmt.run(
    "appointment_rescheduled",
    appointment.client_id,
    `Seu agendamento #${appointment.id} foi atualizado para ${newStart.format("DD/MM/YYYY HH:mm")} ate ${newEnd.format("HH:mm")}.`,
    "email",
    "pending"
  );

  if (req.user.role === "cliente") {
    createNotificationStmt.run(
      "appointment_rescheduled",
      appointment.artist_user_id,
      `O cliente ${appointment.client_name} reagendou para ${newStart.format("DD/MM/YYYY HH:mm")} ate ${newEnd.format("HH:mm")}.`,
      "app",
      "pending"
    );
  }

  return res.json(getAppointmentById(appointmentId));
});

module.exports = router;





