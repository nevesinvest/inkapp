const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, notFound } = require("../../utils/http");
const { dayjs } = require("../../utils/date");

const router = express.Router();
router.use(authenticate, requireRoles("gerente"));

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "sim";
  }
  return fallback;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  return roundMoney(value).toFixed(2).replace(".", ",");
}

function parseNullableId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function normalizeDateValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function normalizeMovementType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "entry" || normalized === "payment") {
    return normalized;
  }
  return null;
}

function getArtistById(artistId) {
  return db
    .prepare(
      `
      SELECT
        a.id,
        a.user_id,
        a.style,
        a.bio,
        COALESCE(a.commission_percentage, 0) AS commission_percentage,
        u.name,
        u.email
      FROM artists a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = ?
    `
    )
    .get(artistId);
}

function getArtistCommissionBalance(artistId) {
  const row = db
    .prepare(
      `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN movement_type = 'entry' THEN amount
              WHEN movement_type = 'payment' THEN -amount
              ELSE 0
            END
          ),
          0
        ) AS balance
      FROM artist_commission_movements
      WHERE artist_id = ?
    `
    )
    .get(artistId);
  return roundMoney(row?.balance || 0);
}

function getCommissionMovementById(movementId) {
  return db
    .prepare(
      `
      SELECT
        acm.id,
        acm.artist_id,
        acm.movement_type,
        acm.amount,
        acm.description,
        acm.occurred_on,
        acm.reference_type,
        acm.reference_id,
        acm.created_at,
        a.commission_percentage,
        u.name AS artist_name,
        cu.name AS created_by_name
      FROM artist_commission_movements acm
      JOIN artists a ON a.id = acm.artist_id
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users cu ON cu.id = acm.created_by
      WHERE acm.id = ?
    `
    )
    .get(movementId);
}

const createMovementTx = db.transaction((payload) => {
  const artist = getArtistById(payload.artistId);
  if (!artist) {
    throw new Error("Artista não encontrado.");
  }

  const amount = roundMoney(payload.amount);
  const balanceBefore = getArtistCommissionBalance(payload.artistId);
  const tolerance = 0.000001;
  if (
    payload.movementType === "payment" &&
    amount - balanceBefore > tolerance &&
    !payload.allowOverbalance
  ) {
    const error = new Error(`Pagamento maior que saldo disponível (${formatMoney(balanceBefore)}).`);
    error.code = "OVERBALANCE_PAYMENT";
    error.balance = balanceBefore;
    throw error;
  }

  const movementId = db
    .prepare(
      `
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
        (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      payload.artistId,
      payload.movementType,
      amount,
      toOptionalText(payload.description),
      payload.occurredOn,
      toOptionalText(payload.referenceType),
      parseNullableId(payload.referenceId),
      payload.createdBy
    ).lastInsertRowid;

  if (payload.movementType === "payment") {
    db.prepare(
      `
      INSERT INTO financial_transactions
        (type, category, amount, artist_id, appointment_id, order_id, description, occurred_on)
      VALUES
        ('expense', 'pagamento comissão', ?, ?, NULL, NULL, ?, ?)
    `
    ).run(
      amount,
      payload.artistId,
      toOptionalText(payload.description) || `Pagamento de comissão - ${artist.name}`,
      payload.occurredOn
    );
  }

  const movement = getCommissionMovementById(movementId);
  const balanceAfter = getArtistCommissionBalance(payload.artistId);

  return {
    movement,
    balanceBefore,
    balanceAfter
  };
});

router.get("/artists", (_req, res) => {
  const artists = db
    .prepare(
      `
      SELECT
        a.id,
        a.style,
        a.bio,
        COALESCE(a.commission_percentage, 0) AS commission_percentage,
        u.name,
        u.email,
        COALESCE(
          SUM(
            CASE
              WHEN acm.movement_type = 'entry' THEN acm.amount
              WHEN acm.movement_type = 'payment' THEN -acm.amount
              ELSE 0
            END
          ),
          0
        ) AS balance
      FROM artists a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN artist_commission_movements acm ON acm.artist_id = a.id
      GROUP BY a.id, a.style, a.bio, a.commission_percentage, u.name, u.email
      ORDER BY u.name ASC
    `
    )
    .all()
    .map((artist) => ({
      ...artist,
      balance: roundMoney(artist.balance)
    }));

  return res.json(artists);
});

router.patch("/artists/:id/commission-percentage", (req, res) => {
  const artistId = Number(req.params.id);
  if (!artistId) {
    return badRequest(res, "ID de artista inválido.");
  }

  const currentArtist = getArtistById(artistId);
  if (!currentArtist) {
    return notFound(res, "Artista não encontrado.");
  }

  const nextCommission = parseNumber(req.body.commissionPercentage, NaN);
  if (!Number.isFinite(nextCommission) || nextCommission < 0 || nextCommission > 100) {
    return badRequest(res, "Percentual de comissão deve estar entre 0 e 100.");
  }

  db.prepare("UPDATE artists SET commission_percentage = ? WHERE id = ?").run(nextCommission, artistId);

  return res.json({
    ...getArtistById(artistId),
    balance: getArtistCommissionBalance(artistId)
  });
});

router.get("/movements", (req, res) => {
  const artistId = parseNullableId(req.query.artistId);
  if (req.query.artistId !== undefined && !artistId) {
    return badRequest(res, "Artista inválido para filtro.");
  }

  const movementType = normalizeMovementType(req.query.movementType);
  if (req.query.movementType !== undefined && !movementType) {
    return badRequest(res, "Tipo de movimentação inválido.");
  }

  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial inválida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final inválida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial não pode ser maior que a final.");
  }

  const whereConditions = [];
  const queryParams = [];

  if (artistId) {
    whereConditions.push("acm.artist_id = ?");
    queryParams.push(artistId);
  }
  if (movementType) {
    whereConditions.push("acm.movement_type = ?");
    queryParams.push(movementType);
  }
  if (dateFrom) {
    whereConditions.push("acm.occurred_on >= ?");
    queryParams.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("acm.occurred_on <= ?");
    queryParams.push(dateTo);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(parseNumber(req.query.limit, 300), 1), 1000);

  const movements = db
    .prepare(
      `
      SELECT
        acm.id,
        acm.artist_id,
        acm.movement_type,
        acm.amount,
        acm.description,
        acm.occurred_on,
        acm.reference_type,
        acm.reference_id,
        acm.created_at,
        u.name AS artist_name,
        cu.name AS created_by_name
      FROM artist_commission_movements acm
      JOIN artists a ON a.id = acm.artist_id
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users cu ON cu.id = acm.created_by
      ${whereClause}
      ORDER BY acm.occurred_on DESC, acm.id DESC
      LIMIT ?
    `
    )
    .all(...queryParams, limit)
    .map((movement) => ({
      ...movement,
      amount: roundMoney(movement.amount)
    }));

  return res.json(movements);
});

router.get("/summary", (req, res) => {
  const artistId = parseNullableId(req.query.artistId);
  if (req.query.artistId !== undefined && !artistId) {
    return badRequest(res, "Artista inválido para filtro.");
  }

  const movementType = normalizeMovementType(req.query.movementType);
  if (req.query.movementType !== undefined && !movementType) {
    return badRequest(res, "Tipo de movimentação inválido.");
  }

  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial inválida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final inválida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial não pode ser maior que a final.");
  }

  const whereConditions = [];
  const queryParams = [];
  if (artistId) {
    whereConditions.push("artist_id = ?");
    queryParams.push(artistId);
  }
  if (movementType) {
    whereConditions.push("movement_type = ?");
    queryParams.push(movementType);
  }
  if (dateFrom) {
    whereConditions.push("occurred_on >= ?");
    queryParams.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("occurred_on <= ?");
    queryParams.push(dateTo);
  }
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const totals = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN movement_type = 'entry' THEN amount ELSE 0 END), 0) AS total_entries,
        COALESCE(SUM(CASE WHEN movement_type = 'payment' THEN amount ELSE 0 END), 0) AS total_payments,
        COALESCE(
          SUM(
            CASE
              WHEN movement_type = 'entry' THEN amount
              WHEN movement_type = 'payment' THEN -amount
              ELSE 0
            END
          ),
          0
        ) AS balance
      FROM artist_commission_movements
      ${whereClause}
    `
    )
    .get(...queryParams);

  return res.json({
    totalEntries: roundMoney(totals?.total_entries || 0),
    totalPayments: roundMoney(totals?.total_payments || 0),
    balance: roundMoney(totals?.balance || 0)
  });
});

router.get("/pending", (req, res) => {
  const artistId = parseNullableId(req.query.artistId);
  if (req.query.artistId !== undefined && !artistId) {
    return badRequest(res, "Artista inválido para filtro.");
  }

  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial inválida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final inválida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial não pode ser maior que a final.");
  }

  const joinConditions = ["acm.artist_id = a.id"];
  const joinParams = [];
  if (dateFrom) {
    joinConditions.push("acm.occurred_on >= ?");
    joinParams.push(dateFrom);
  }
  if (dateTo) {
    joinConditions.push("acm.occurred_on <= ?");
    joinParams.push(dateTo);
  }

  const whereConditions = [];
  const whereParams = [];
  if (artistId) {
    whereConditions.push("a.id = ?");
    whereParams.push(artistId);
  }

  const joinClause = joinConditions.join(" AND ");
  const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
      SELECT
        a.id AS artist_id,
        u.name AS artist_name,
        COALESCE(a.commission_percentage, 0) AS commission_percentage,
        COALESCE(SUM(CASE WHEN acm.movement_type = 'entry' AND acm.reference_type = 'appointment_completion' THEN acm.amount ELSE 0 END), 0) AS generated_total,
        COALESCE(SUM(CASE WHEN acm.movement_type = 'entry' AND (acm.reference_type IS NULL OR acm.reference_type <> 'appointment_completion') THEN acm.amount ELSE 0 END), 0) AS manual_entries_total,
        COALESCE(SUM(CASE WHEN acm.movement_type = 'payment' THEN acm.amount ELSE 0 END), 0) AS payments_total,
        COALESCE(
          SUM(
            CASE
              WHEN acm.movement_type = 'entry' THEN acm.amount
              WHEN acm.movement_type = 'payment' THEN -acm.amount
              ELSE 0
            END
          ),
          0
        ) AS pending_balance
      FROM artists a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN artist_commission_movements acm ON ${joinClause}
      ${whereClause}
      GROUP BY a.id, u.name, a.commission_percentage
      ORDER BY u.name ASC
    `
    )
    .all(...joinParams, ...whereParams)
    .map((row) => ({
      ...row,
      generated_total: roundMoney(row.generated_total),
      manual_entries_total: roundMoney(row.manual_entries_total),
      payments_total: roundMoney(row.payments_total),
      pending_balance: roundMoney(row.pending_balance)
    }));

  return res.json(rows);
});

router.get("/ledger", (req, res) => {
  const artistId = parseNullableId(req.query.artistId);
  if (!artistId) {
    return badRequest(res, "Artista é obrigatório para conta corrente.");
  }

  const artist = getArtistById(artistId);
  if (!artist) {
    return notFound(res, "Artista não encontrado.");
  }

  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial inválida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final inválida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial não pode ser maior que a final.");
  }

  const whereConditions = ["acm.artist_id = ?"];
  const queryParams = [artistId];
  if (dateFrom) {
    whereConditions.push("acm.occurred_on >= ?");
    queryParams.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("acm.occurred_on <= ?");
    queryParams.push(dateTo);
  }
  const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

  let openingBalance = 0;
  if (dateFrom) {
    const openingRow = db
      .prepare(
        `
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN movement_type = 'entry' THEN amount
                WHEN movement_type = 'payment' THEN -amount
                ELSE 0
              END
            ),
            0
          ) AS opening_balance
        FROM artist_commission_movements
        WHERE artist_id = ?
          AND occurred_on < ?
      `
      )
      .get(artistId, dateFrom);
    openingBalance = roundMoney(openingRow?.opening_balance || 0);
  }

  const movements = db
    .prepare(
      `
      SELECT
        acm.id,
        acm.movement_type,
        acm.amount,
        acm.description,
        acm.occurred_on,
        acm.reference_type,
        acm.reference_id,
        acm.created_at,
        cu.name AS created_by_name
      FROM artist_commission_movements acm
      LEFT JOIN users cu ON cu.id = acm.created_by
      ${whereClause}
      ORDER BY acm.occurred_on ASC, acm.id ASC
    `
    )
    .all(...queryParams);

  let runningBalance = openingBalance;
  const rows = movements.map((movement) => {
    const amount = roundMoney(movement.amount);
    if (movement.movement_type === "entry") {
      runningBalance = roundMoney(runningBalance + amount);
    } else {
      runningBalance = roundMoney(runningBalance - amount);
    }

    const movementOrigin =
      movement.movement_type === "payment"
        ? "payment"
        : movement.reference_type === "appointment_completion"
          ? "generated"
          : "manual_entry";

    return {
      ...movement,
      amount,
      movement_origin: movementOrigin,
      running_balance: runningBalance
    };
  });

  return res.json({
    artist: {
      id: artist.id,
      name: artist.name,
      commission_percentage: roundMoney(artist.commission_percentage)
    },
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    openingBalance,
    rows
  });
});

router.post("/movements", (req, res) => {
  const artistId = parseNullableId(req.body.artistId);
  if (!artistId) {
    return badRequest(res, "Artista é obrigatório.");
  }

  const movementType = normalizeMovementType(req.body.movementType);
  if (!movementType) {
    return badRequest(res, "Tipo de movimentação inválido.");
  }

  const amount = roundMoney(parseNumber(req.body.amount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest(res, "Valor da comissão inválido.");
  }

  const occurredOn = req.body.occurredOn
    ? normalizeDateValue(req.body.occurredOn)
    : dayjs().format("YYYY-MM-DD");
  if (!occurredOn) {
    return badRequest(res, "Data inválida. Use YYYY-MM-DD.");
  }

  const allowOverbalance = parseBoolean(req.body.allowOverbalance, false);

  try {
    const result = createMovementTx({
      artistId,
      movementType,
      amount,
      description: req.body.description,
      occurredOn,
      referenceType: req.body.referenceType || "manual",
      referenceId: req.body.referenceId,
      allowOverbalance,
      createdBy: req.user.id
    });

    return res.status(201).json({
      ...result.movement,
      amount: roundMoney(result.movement?.amount || 0),
      balance_before: roundMoney(result.balanceBefore),
      balance_after: roundMoney(result.balanceAfter)
    });
  } catch (error) {
    if (error.code === "OVERBALANCE_PAYMENT") {
      return res.status(409).json({
        message: error.message,
        code: error.code,
        balance: roundMoney(error.balance || 0)
      });
    }
    return badRequest(res, error.message);
  }
});

module.exports = router;


