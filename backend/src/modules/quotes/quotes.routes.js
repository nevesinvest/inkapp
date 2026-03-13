const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, forbidden, notFound } = require("../../utils/http");
const { dayjs, isValidIsoDate } = require("../../utils/date");
const {
  getArtistIdForUser,
  findScheduleConflicts
} = require("../appointments/appointments.service");
const {
  extractQuoteContact,
  sendQuoteResponseDelivery
} = require("./quote-delivery.service");

const router = express.Router();

const quoteSelectBase = `
  SELECT
    q.*,
    u.name AS preferred_artist_name
  FROM quotes q
  LEFT JOIN artists a ON a.id = q.preferred_artist_id
  LEFT JOIN users u ON u.id = a.user_id
`;

const createQuoteStmt = db.prepare(`
  INSERT INTO quotes
    (
      client_name,
      client_contact,
      client_email,
      client_whatsapp,
      description,
      style,
      body_part,
      size_estimate,
      preferred_artist_id,
      reference_images,
      status
    )
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
`);
const getServiceForScheduleStmt = db.prepare(`
  SELECT id, name, duration_minutes, price, active
  FROM services
  WHERE id = ?
`);
const findUserByEmailStmt = db.prepare(`
  SELECT id, role
  FROM users
  WHERE lower(email) = lower(?)
  LIMIT 1
`);
const listClientsWithPhoneStmt = db.prepare(`
  SELECT id, phone
  FROM users
  WHERE role = 'cliente'
    AND phone IS NOT NULL
    AND trim(phone) <> ''
`);
const createLeadClientStmt = db.prepare(`
  INSERT INTO users (name, email, phone, password_hash, role)
  VALUES (?, ?, ?, ?, 'cliente')
`);
const createAppointmentFromQuoteStmt = db.prepare(`
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
    (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, 0, 'none')
`);
const updateQuoteAsAcceptedStmt = db.prepare(`
  UPDATE quotes
  SET status = 'accepted', updated_at = datetime('now')
  WHERE id = ?
`);
const createNotificationStmt = db.prepare(`
  INSERT INTO notifications (type, target_user_id, message, channel, status)
  VALUES (?, ?, ?, ?, ?)
`);
const getAppointmentByIdStmt = db.prepare(`
  SELECT
    ap.*,
    s.name AS service_name,
    u.name AS client_name
  FROM appointments ap
  JOIN services s ON s.id = ap.service_id
  JOIN users u ON u.id = ap.client_id
  WHERE ap.id = ?
`);

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function parseReferenceImages(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeWhatsapp(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function parseMoney(value, fallback = 0) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhoneDigits(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) {
    return digits.slice(-11);
  }
  if (digits.length >= 10) {
    return digits.slice(-11);
  }
  return null;
}

function buildUniqueLeadEmail(quoteId) {
  const base = `lead-orcamento-${quoteId}`;
  let index = 0;

  while (index < 500) {
    const candidate = index === 0 ? `${base}@inkapp.local` : `${base}-${index}@inkapp.local`;
    const existing = findUserByEmailStmt.get(candidate);
    if (!existing) return candidate;
    index += 1;
  }

  return `lead-orcamento-${quoteId}-${Date.now()}@inkapp.local`;
}

function resolveLeadPhone(quote, contact) {
  if (contact?.whatsapp) {
    return `+${String(contact.whatsapp).replace(/^(\+)?/, "")}`;
  }

  const fallbackDigits = normalizePhoneDigits(quote?.client_contact);
  if (!fallbackDigits) return null;
  return `+55${fallbackDigits}`;
}

function getQuoteByIdRaw(quoteId) {
  return db.prepare(`${quoteSelectBase} WHERE q.id = ?`).get(quoteId);
}

function mapQuote(row) {
  if (!row) return null;
  return {
    ...row,
    reference_images: parseReferenceImages(row.reference_images)
  };
}

function validateQuoteAccess(quote, user) {
  if (user.role !== "tatuador") return true;

  const artistId = getArtistIdForUser(user.id);
  if (!artistId) return false;
  if (quote.preferred_artist_id && quote.preferred_artist_id !== artistId) return false;
  return true;
}

router.post("/", (req, res) => {
  const {
    clientName,
    clientContact,
    clientEmail,
    clientWhatsapp,
    description,
    style,
    bodyPart,
    sizeEstimate,
    preferredArtistId,
    referenceImages
  } = req.body;

  if (!clientName || !clientContact || !description || !style || !bodyPart || !sizeEstimate) {
    return badRequest(
      res,
      "Campos obrigatorios: clientName, clientContact, description, style, bodyPart, sizeEstimate."
    );
  }

  const images = Array.isArray(referenceImages) ? referenceImages.slice(0, 8) : [];
  const quoteId = createQuoteStmt.run(
    String(clientName).trim(),
    String(clientContact).trim(),
    normalizeEmail(clientEmail),
    normalizeWhatsapp(clientWhatsapp),
    String(description).trim(),
    String(style).trim(),
    String(bodyPart).trim(),
    String(sizeEstimate).trim(),
    preferredArtistId ? Number(preferredArtistId) : null,
    JSON.stringify(images)
  ).lastInsertRowid;

  const managers = db.prepare("SELECT id FROM users WHERE role = 'gerente'").all();
  const notifyStmt = db.prepare(`
    INSERT INTO notifications (type, target_user_id, message, channel, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  managers.forEach((manager) => {
    notifyStmt.run(
      "quote_new",
      manager.id,
      `Novo orcamento #${quoteId} recebido e aguardando analise.`,
      "app",
      "pending"
    );
  });

  return res.status(201).json({
    id: quoteId,
    message: "Solicitacao de orcamento enviada com sucesso."
  });
});

router.get("/", authenticate, requireRoles("gerente", "tatuador"), (req, res) => {
  const params = [];
  const filters = [];

  if (req.user.role === "tatuador") {
    const artistId = getArtistIdForUser(req.user.id);
    if (!artistId) {
      return notFound(res, "Perfil de tatuador nao encontrado.");
    }
    filters.push("(q.preferred_artist_id = ? OR q.preferred_artist_id IS NULL)");
    params.push(artistId);
  }

  if (req.query.status) {
    filters.push("q.status = ?");
    params.push(req.query.status);
  }

  if (req.query.preferredArtistId) {
    filters.push("q.preferred_artist_id = ?");
    params.push(Number(req.query.preferredArtistId));
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const quotes = db
    .prepare(
      `
      ${quoteSelectBase}
      ${whereClause}
      ORDER BY q.created_at DESC
    `
    )
    .all(...params)
    .map((quote) => mapQuote(quote));

  return res.json(quotes);
});

router.get("/:id", authenticate, requireRoles("gerente", "tatuador"), (req, res) => {
  const quoteId = Number(req.params.id);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return badRequest(res, "ID de orcamento invalido.");
  }

  const quote = getQuoteByIdRaw(quoteId);
  if (!quote) {
    return notFound(res, "Orcamento nao encontrado.");
  }

  if (!validateQuoteAccess(quote, req.user)) {
    return forbidden(res);
  }

  return res.json(mapQuote(quote));
});

router.patch("/:id", authenticate, requireRoles("gerente", "tatuador"), async (req, res) => {
  const quoteId = Number(req.params.id);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return badRequest(res, "ID de orcamento invalido.");
  }

  const { status, response, responseAmount, sendEmail, sendWhatsapp } = req.body;

  const allowedStatus = ["pending", "reviewing", "replied", "accepted", "rejected"];
  if (status && !allowedStatus.includes(status)) {
    return badRequest(res, "Status invalido para orcamento.");
  }

  const quote = getQuoteByIdRaw(quoteId);
  if (!quote) {
    return notFound(res, "Orcamento nao encontrado.");
  }

  if (!validateQuoteAccess(quote, req.user)) {
    return forbidden(res);
  }

  const hasResponseAmount = responseAmount !== undefined && responseAmount !== null && responseAmount !== "";
  let parsedResponseAmount = null;
  if (hasResponseAmount) {
    parsedResponseAmount = Number(responseAmount);
    if (!Number.isFinite(parsedResponseAmount) || parsedResponseAmount <= 0) {
      return badRequest(res, "O valor do orcamento deve ser maior que zero.");
    }
  }

  const shouldSendEmail = parseBoolean(sendEmail);
  const shouldSendWhatsapp = parseBoolean(sendWhatsapp);

  if ((shouldSendEmail || shouldSendWhatsapp) && !toOptionalText(response)) {
    return badRequest(res, "Informe as consideracoes do tatuador antes de enviar a resposta.");
  }

  const contact = extractQuoteContact(quote);
  if (shouldSendEmail && !contact.email) {
    return badRequest(res, "Este orcamento nao possui e-mail valido para envio.");
  }
  if (shouldSendWhatsapp && !contact.whatsapp) {
    return badRequest(res, "Este orcamento nao possui WhatsApp valido para envio.");
  }

  db.prepare(
    `
      UPDATE quotes
      SET
        status = COALESCE(?, status),
        response = COALESCE(?, response),
        response_amount = CASE WHEN ? = 1 THEN ? ELSE response_amount END,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(status || null, toOptionalText(response), hasResponseAmount ? 1 : 0, parsedResponseAmount, quoteId);

  const updated = mapQuote(getQuoteByIdRaw(quoteId));

  let delivery = null;
  if (shouldSendEmail || shouldSendWhatsapp) {
    delivery = await sendQuoteResponseDelivery({
      quote: updated,
      artistName: req.user.name,
      responseText: toOptionalText(response),
      responseAmount: hasResponseAmount ? parsedResponseAmount : updated.response_amount,
      sendEmail: shouldSendEmail,
      sendWhatsapp: shouldSendWhatsapp
    });
  }

  return res.json({
    ...updated,
    delivery
  });
});

router.post("/:id/schedule", authenticate, requireRoles("tatuador"), (req, res) => {
  const quoteId = Number(req.params.id);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return badRequest(res, "ID de orcamento invalido.");
  }

  const { serviceId, startAt, endAt, notes, totalValue } = req.body;
  if (!serviceId || !startAt) {
    return badRequest(res, "Campos obrigatorios: serviceId e startAt.");
  }
  if (!isValidIsoDate(startAt)) {
    return badRequest(res, "startAt invalido.");
  }
  if (endAt && !isValidIsoDate(endAt)) {
    return badRequest(res, "endAt invalido.");
  }

  const parsedServiceId = Number(serviceId);
  if (!Number.isInteger(parsedServiceId) || parsedServiceId <= 0) {
    return badRequest(res, "serviceId invalido.");
  }

  const quote = getQuoteByIdRaw(quoteId);
  if (!quote) {
    return notFound(res, "Orcamento nao encontrado.");
  }
  if (!validateQuoteAccess(quote, req.user)) {
    return forbidden(res);
  }
  if (String(quote.status || "").toLowerCase() === "accepted") {
    return res.status(409).json({
      message:
        "Este orcamento ja foi agendado. Para alterar horario, use diretamente a agenda do tatuador."
    });
  }

  const artistId = getArtistIdForUser(req.user.id);
  if (!artistId) {
    return notFound(res, "Perfil de tatuador nao encontrado.");
  }

  const service = getServiceForScheduleStmt.get(parsedServiceId);
  if (!service || !service.active) {
    return notFound(res, "Servico nao encontrado.");
  }

  const start = dayjs(startAt);
  const end = endAt ? dayjs(endAt) : start.add(service.duration_minutes, "minute");
  if (!start.isBefore(end)) {
    return badRequest(res, "Horario final precisa ser posterior ao horario inicial.");
  }

  const conflicts = findScheduleConflicts(artistId, start.toISOString(), end.toISOString());
  if (conflicts.appointments.length || conflicts.blocks.length) {
    return res.status(409).json({
      message: "Horario indisponivel para o tatuador selecionado.",
      conflicts
    });
  }

  const parsedTotalValue = parseMoney(totalValue, quote.response_amount || service.price);
  if (!Number.isFinite(parsedTotalValue) || parsedTotalValue < 0) {
    return badRequest(res, "Valor total invalido.");
  }

  const contact = extractQuoteContact(quote);

  try {
    const result = db.transaction(() => {
      let clientId = null;
      let autoCreatedClient = false;

      if (contact.email) {
        const byEmail = findUserByEmailStmt.get(contact.email);
        if (byEmail && byEmail.role === "cliente") {
          clientId = byEmail.id;
        }
      }

      if (!clientId && contact.whatsapp) {
        const targetDigits = normalizePhoneDigits(contact.whatsapp);
        if (targetDigits) {
          const phoneMatch = listClientsWithPhoneStmt
            .all()
            .find((item) => normalizePhoneDigits(item.phone) === targetDigits);
          if (phoneMatch) {
            clientId = phoneMatch.id;
          }
        }
      }

      if (!clientId) {
        const availableEmail =
          contact.email && !findUserByEmailStmt.get(contact.email)
            ? contact.email
            : buildUniqueLeadEmail(quote.id);
        const leadName = toOptionalText(quote.client_name) || `Cliente Orcamento #${quote.id}`;
        const leadPhone = resolveLeadPhone(quote, contact);
        const temporaryPasswordHash = bcrypt.hashSync(
          `inkapp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          10
        );

        clientId = createLeadClientStmt.run(
          leadName,
          availableEmail,
          leadPhone,
          temporaryPasswordHash
        ).lastInsertRowid;
        autoCreatedClient = true;
      }

      const notesPrefix = [
        `Agendado via orcamento #${quote.id}.`,
        `Estilo: ${quote.style || "-"}.`,
        `Regiao do corpo: ${quote.body_part || "-"}.`,
        `Tamanho estimado: ${quote.size_estimate || "-"}.`,
        `Descricao do cliente: ${quote.description || "-"}`
      ].join("\n");

      const extraNotes = String(notes || "").trim();
      const finalNotes = extraNotes ? `${notesPrefix}\n\n${extraNotes}` : notesPrefix;

      const appointmentId = createAppointmentFromQuoteStmt.run(
        clientId,
        artistId,
        parsedServiceId,
        start.toISOString(),
        end.toISOString(),
        roundMoney(parsedTotalValue),
        finalNotes
      ).lastInsertRowid;

      updateQuoteAsAcceptedStmt.run(quoteId);

      const createdAppointment = getAppointmentByIdStmt.get(appointmentId);

      createNotificationStmt.run(
        "appointment_created",
        clientId,
        `Seu agendamento para ${createdAppointment.service_name} foi registrado para ${dayjs(
          createdAppointment.start_at
        ).format("DD/MM/YYYY HH:mm")}.`,
        "email",
        "pending"
      );
      createNotificationStmt.run(
        "appointment_created",
        req.user.id,
        `Agendamento #${appointmentId} criado para ${createdAppointment.client_name}.`,
        "app",
        "pending"
      );

      return {
        appointment: createdAppointment,
        quote: mapQuote(getQuoteByIdRaw(quoteId)),
        client: {
          id: clientId,
          autoCreated: autoCreatedClient
        }
      };
    })();

    return res.status(201).json(result);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("UNIQUE constraint failed: users.email")) {
      return res.status(409).json({
        message: "Nao foi possivel criar cliente automatico. Tente novamente."
      });
    }
    console.error(error);
    return res.status(500).json({
      message: "Erro ao criar agendamento a partir do orcamento."
    });
  }
});

router.delete("/:id", authenticate, requireRoles("gerente", "tatuador"), (req, res) => {
  const quoteId = Number(req.params.id);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return badRequest(res, "ID de orcamento invalido.");
  }

  const quote = getQuoteByIdRaw(quoteId);
  if (!quote) {
    return notFound(res, "Orcamento nao encontrado.");
  }

  if (!validateQuoteAccess(quote, req.user)) {
    return forbidden(res);
  }

  db.prepare("DELETE FROM quotes WHERE id = ?").run(quoteId);
  return res.json({ message: "Orcamento excluido com sucesso." });
});

module.exports = router;
