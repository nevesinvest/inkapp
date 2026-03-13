const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, notFound } = require("../../utils/http");
const {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  roundMoney,
  getTodayDate,
  normalizeDateFilter,
  normalizeMovementType,
  normalizePaymentMethod,
  getSessionCurrentBalance,
  getSessionPaymentBalances,
  getSessionPaymentMethodBalance,
  getBankById,
  getCashBankById,
  getOpenSessionByBankId,
  getCashSessionById,
  buildSessionDto,
  autoCloseExpiredCashSessions
} = require("./cashier.service");

const router = express.Router();
router.use(authenticate, requireRoles("gerente"));
router.use((_req, _res, next) => {
  try {
    autoCloseExpiredCashSessions();
    next();
  } catch (error) {
    next(error);
  }
});

function parseNumber(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function toMoneyCents(value) {
  return Math.round(roundMoney(value) * 100);
}

function isCashAccountType(bank) {
  return String(bank?.account_type || "").trim().toLowerCase() === "caixa";
}

function normalizeSessionStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "open" || normalized === "closed") return normalized;
  return null;
}

function getMovementById(movementId) {
  const row = db
    .prepare(
      `
      SELECT
        cm.id,
        cm.session_id,
        cm.bank_id,
        cm.movement_type,
        cm.payment_method,
        cm.movement_origin,
        cm.destination_bank_id,
        cm.order_id,
        cm.amount,
        cm.description,
        cm.created_at,
        b.bank_name,
        b.account_name,
        dbk.bank_name AS destination_bank_name,
        dbk.account_name AS destination_account_name,
        o.order_number,
        u.name AS created_by_name
      FROM cash_movements cm
      JOIN banks b ON b.id = cm.bank_id
      LEFT JOIN banks dbk ON dbk.id = cm.destination_bank_id
      LEFT JOIN orders o ON o.id = cm.order_id
      LEFT JOIN users u ON u.id = cm.created_by
      WHERE cm.id = ?
      LIMIT 1
    `
    )
    .get(movementId);

  if (!row) return null;
  const paymentMethod = normalizePaymentMethod(row.payment_method) || "cash";
  return {
    ...row,
    amount: roundMoney(row.amount),
    payment_method: paymentMethod,
    payment_method_label: PAYMENT_METHOD_LABELS[paymentMethod]
  };
}

function getOrderById(orderId) {
  return db
    .prepare(
      `
      SELECT
        o.*,
        u.name AS client_name
      FROM orders o
      JOIN users u ON u.id = o.client_id
      WHERE o.id = ?
      LIMIT 1
    `
    )
    .get(orderId);
}

function normalizeOrderNumberInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  const numeric = Number(digits);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function findPendingOrderByOrderNumber(orderNumber) {
  const normalizedOrderNumber = normalizeOrderNumberInput(orderNumber);
  if (!normalizedOrderNumber) return null;

  return db
    .prepare(
      `
      SELECT
        o.id
      FROM orders o
      WHERE o.status = 'paid'
        AND COALESCE(o.sale_closed, 0) = 0
        AND CAST(
          CASE
            WHEN upper(trim(COALESCE(o.order_number, ''))) LIKE 'PED-%'
              THEN substr(upper(trim(o.order_number)), 5)
            WHEN upper(trim(COALESCE(o.order_number, ''))) LIKE 'PED%'
              THEN substr(upper(trim(o.order_number)), 4)
            ELSE trim(COALESCE(o.order_number, ''))
          END AS INTEGER
        ) = ?
      ORDER BY o.id DESC
      LIMIT 1
    `
    )
    .get(normalizedOrderNumber);
}

function assertDestinationBankForTransfer(sourceBankId, destinationBankId) {
  const destinationBank = getBankById(destinationBankId);
  if (!destinationBank) {
    throw new Error("Banco de destino nao encontrado ou inativo.");
  }
  if (Number(destinationBank.id) === Number(sourceBankId)) {
    throw new Error("Banco de destino deve ser diferente do caixa de origem.");
  }
  if (isCashAccountType(destinationBank)) {
    const destinationSession = getOpenSessionByBankId(destinationBank.id);
    if (!destinationSession) {
      throw new Error("Caixa de destino esta fechado. Abra o caixa de destino para receber transferencia.");
    }
  }
  return destinationBank;
}

function transferFromOpenCashSession({
  sourceBankId,
  destinationBankId,
  paymentMethod,
  amount,
  description,
  createdBy,
  movementOrigin = "transfer_out"
}) {
  const sourceSession = getOpenSessionByBankId(sourceBankId);
  if (!sourceSession) {
    throw new Error("Caixa selecionado esta fechado. Abra o caixa para movimentar.");
  }

  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
  if (!normalizedPaymentMethod) {
    throw new Error("Forma de pagamento invalida para transferencia.");
  }

  const normalizedAmount = roundMoney(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error("Informe um valor valido para transferencia.");
  }

  const destinationBank = assertDestinationBankForTransfer(sourceBankId, destinationBankId);
  const sourcePaymentBalance = getSessionPaymentMethodBalance(sourceSession, normalizedPaymentMethod);
  if (normalizedAmount > sourcePaymentBalance) {
    throw new Error(
      `Valor maior que o saldo disponivel em ${PAYMENT_METHOD_LABELS[normalizedPaymentMethod]} (${roundMoney(
        sourcePaymentBalance
      ).toFixed(2)}).`
    );
  }

  const sourceMovementId = db
    .prepare(
      `
      INSERT INTO cash_movements
        (
          session_id,
          bank_id,
          movement_type,
          payment_method,
          movement_origin,
          destination_bank_id,
          order_id,
          amount,
          description,
          created_by
        )
      VALUES
        (?, ?, 'exit', ?, ?, ?, NULL, ?, ?, ?)
    `
    )
    .run(
      sourceSession.id,
      sourceBankId,
      normalizedPaymentMethod,
      movementOrigin,
      destinationBankId,
      normalizedAmount,
      description,
      createdBy
    ).lastInsertRowid;

  db.prepare(
    `
    UPDATE cash_sessions
    SET total_exits = total_exits + ?, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(normalizedAmount, sourceSession.id);

  if (isCashAccountType(destinationBank)) {
    const destinationSession = getOpenSessionByBankId(destinationBankId);
    if (!destinationSession) {
      throw new Error("Caixa de destino esta fechado. Abra o caixa de destino para receber transferencia.");
    }

    db.prepare(
      `
      INSERT INTO cash_movements
        (
          session_id,
          bank_id,
          movement_type,
          payment_method,
          movement_origin,
          destination_bank_id,
          order_id,
          amount,
          description,
          created_by
        )
      VALUES
        (?, ?, 'entry', ?, 'transfer_in', ?, NULL, ?, ?, ?)
    `
    ).run(
      destinationSession.id,
      destinationBankId,
      normalizedPaymentMethod,
      sourceBankId,
      normalizedAmount,
      description,
      createdBy
    );

    db.prepare(
      `
      UPDATE cash_sessions
      SET total_entries = total_entries + ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(normalizedAmount, destinationSession.id);

    const refreshedDestinationSession = getOpenSessionByBankId(destinationBankId);
    const destinationBalance = getSessionCurrentBalance(refreshedDestinationSession);
    db.prepare(
      `
      UPDATE banks
      SET current_balance = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(destinationBalance, destinationBankId);
  } else {
    db.prepare(
      `
      UPDATE banks
      SET current_balance = current_balance + ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(normalizedAmount, destinationBankId);
  }

  const refreshedSourceSession = getOpenSessionByBankId(sourceBankId);
  const sourceBalance = getSessionCurrentBalance(refreshedSourceSession);
  db.prepare(
    `
    UPDATE banks
    SET current_balance = ?, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(sourceBalance, sourceBankId);

  return {
    sourceMovementId,
    sourceSessionId: sourceSession.id
  };
}

function closeSaleByOrderId({ orderId, bankId, userId }) {
  const closeSaleTx = db.transaction(() => {
    const currentOrder = getOrderById(orderId);
    if (!currentOrder) {
      throw new Error("Pedido nao encontrado.");
    }
    if (String(currentOrder.status) !== "paid") {
      throw new Error("Somente pedidos pagos podem ser fechados no caixa.");
    }
    if (Number(currentOrder.sale_closed || 0) === 1) {
      throw new Error("Este pedido ja foi fechado no caixa.");
    }

    const currentOpenSession = getOpenSessionByBankId(bankId);
    if (!currentOpenSession) {
      throw new Error("Caixa selecionado esta fechado. Abra o caixa para fechar vendas.");
    }

    const paymentMethod = normalizePaymentMethod(currentOrder.payment_method) || "pix";
    const totalAmount = roundMoney(currentOrder.total_amount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error("Pedido com valor invalido para fechamento.");
    }

    const orderNumber = currentOrder.order_number || String(orderId).padStart(6, "0");
    const movementDescription = `Fechamento de venda ${orderNumber}`;
    const movementId = db
      .prepare(
        `
        INSERT INTO cash_movements
          (
            session_id,
            bank_id,
            movement_type,
            payment_method,
            movement_origin,
            destination_bank_id,
            order_id,
            amount,
            description,
            created_by
          )
        VALUES
          (?, ?, 'entry', ?, 'sale_close', NULL, ?, ?, ?, ?)
      `
      )
      .run(
        currentOpenSession.id,
        bankId,
        paymentMethod,
        orderId,
        totalAmount,
        movementDescription,
        userId
      ).lastInsertRowid;

    db.prepare(
      `
      UPDATE cash_sessions
      SET total_entries = total_entries + ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(totalAmount, currentOpenSession.id);

    const refreshedSession = getOpenSessionByBankId(bankId);
    const updatedBalance = getSessionCurrentBalance(refreshedSession);
    db.prepare(
      `
      UPDATE banks
      SET current_balance = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(updatedBalance, bankId);

    const updateOrderResult = db
      .prepare(
        `
        UPDATE orders
        SET
          sale_closed = 1,
          sale_closed_at = datetime('now'),
          sale_closed_by = ?,
          sale_closed_session_id = ?,
          status = 'paid'
        WHERE id = ?
          AND COALESCE(sale_closed, 0) = 0
      `
      )
      .run(userId, currentOpenSession.id, orderId);

    if (updateOrderResult.changes === 0) {
      throw new Error("Nao foi possivel fechar a venda porque o pedido ja esta fechado.");
    }

    const existingFinancial = db
      .prepare(
        `
        SELECT id
        FROM financial_transactions
        WHERE order_id = ?
          AND type = 'income'
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get(orderId);
    const occurredOn = getTodayDate();
    const financialDescription = `${movementDescription} - ${PAYMENT_METHOD_LABELS[paymentMethod]}`;

    if (existingFinancial) {
      db.prepare(
        `
        UPDATE financial_transactions
        SET
          category = 'venda loja',
          amount = ?,
          artist_id = NULL,
          appointment_id = NULL,
          description = ?,
          occurred_on = ?
        WHERE id = ?
      `
      ).run(totalAmount, financialDescription, occurredOn, existingFinancial.id);
    } else {
      db.prepare(
        `
        INSERT INTO financial_transactions
          (type, category, amount, artist_id, appointment_id, order_id, description, occurred_on)
        VALUES
          ('income', 'venda loja', ?, NULL, NULL, ?, ?, ?)
      `
      ).run(totalAmount, orderId, financialDescription, occurredOn);
    }

    return {
      movementId,
      sessionId: currentOpenSession.id
    };
  });

  return closeSaleTx();
}

router.get("/overview", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        b.id,
        b.bank_name,
        b.account_name,
        b.account_type,
        b.current_balance,
        b.initial_balance,
        b.active,
        cs.id AS open_session_id,
        cs.opened_on,
        cs.opened_at,
        cs.opening_balance,
        cs.total_entries,
        cs.total_exits,
        cs.notes AS open_session_notes,
        ob.name AS opened_by_name,
        (
          SELECT lcs.closed_at
          FROM cash_sessions lcs
          WHERE lcs.bank_id = b.id
            AND lcs.status = 'closed'
          ORDER BY lcs.closed_at DESC, lcs.id DESC
          LIMIT 1
        ) AS last_closed_at
      FROM banks b
      LEFT JOIN cash_sessions cs
        ON cs.bank_id = b.id
       AND cs.status = 'open'
      LEFT JOIN users ob ON ob.id = cs.opened_by
      WHERE lower(trim(COALESCE(b.account_type, ''))) = 'caixa'
        AND b.active = 1
      ORDER BY b.bank_name ASC, b.account_name ASC
    `
    )
    .all()
    .map((row) => {
      const hasOpenSession = Boolean(row.open_session_id);
      const openSession = hasOpenSession
        ? buildSessionDto({
            id: row.open_session_id,
            bank_id: row.id,
            opened_on: row.opened_on,
            opened_at: row.opened_at,
            opening_balance: row.opening_balance,
            total_entries: row.total_entries,
            total_exits: row.total_exits,
            notes: row.open_session_notes,
            opened_by_name: row.opened_by_name || null,
            status: "open",
            closing_balance: null
          })
        : null;

      return {
        id: row.id,
        bank_name: row.bank_name,
        account_name: row.account_name,
        account_type: row.account_type,
        current_balance: roundMoney(row.current_balance),
        initial_balance: roundMoney(row.initial_balance),
        open_session: openSession
          ? {
              id: openSession.id,
              opened_on: openSession.opened_on,
              opened_at: openSession.opened_at,
              opening_balance: openSession.opening_balance,
              total_entries: openSession.total_entries,
              total_exits: openSession.total_exits,
              current_balance: openSession.current_balance,
              payment_balances: openSession.payment_balances,
              notes: openSession.notes,
              opened_by_name: openSession.opened_by_name || null
            }
          : null,
        session_status: hasOpenSession ? "open" : "closed",
        last_closed_at: row.last_closed_at || null
      };
    });

  return res.json(rows);
});

router.get("/sessions", (req, res) => {
  const bankId = parseNullableId(req.query.bankId);
  if (req.query.bankId !== undefined && !bankId) {
    return badRequest(res, "Caixa invalido para filtro.");
  }

  const status = normalizeSessionStatus(req.query.status);
  if (req.query.status !== undefined && !status) {
    return badRequest(res, "Status invalido para filtro.");
  }

  const dateFrom = normalizeDateFilter(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateFilter(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a data final.");
  }

  const whereConditions = ["lower(trim(COALESCE(b.account_type, ''))) = 'caixa'"];
  const params = [];

  if (bankId) {
    whereConditions.push("cs.bank_id = ?");
    params.push(bankId);
  }
  if (status) {
    whereConditions.push("cs.status = ?");
    params.push(status);
  }
  if (dateFrom) {
    whereConditions.push("cs.opened_on >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("cs.opened_on <= ?");
    params.push(dateTo);
  }

  const limit = Math.min(Math.max(parseNumber(req.query.limit, 200), 1), 1000);
  const whereSql = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
      SELECT
        cs.*,
        b.bank_name,
        b.account_name,
        b.account_type,
        ob.name AS opened_by_name,
        cb.name AS closed_by_name
      FROM cash_sessions cs
      JOIN banks b ON b.id = cs.bank_id
      LEFT JOIN users ob ON ob.id = cs.opened_by
      LEFT JOIN users cb ON cb.id = cs.closed_by
      ${whereSql}
      ORDER BY cs.opened_at DESC, cs.id DESC
      LIMIT ?
    `
    )
    .all(...params, limit)
    .map((row) => buildSessionDto(row));

  return res.json(rows);
});

router.get("/movements", (req, res) => {
  const bankId = parseNullableId(req.query.bankId);
  if (req.query.bankId !== undefined && !bankId) {
    return badRequest(res, "Caixa invalido para filtro.");
  }

  const sessionId = parseNullableId(req.query.sessionId);
  if (req.query.sessionId !== undefined && !sessionId) {
    return badRequest(res, "Sessao invalida para filtro.");
  }

  const movementType = normalizeMovementType(req.query.movementType);
  if (req.query.movementType !== undefined && !movementType) {
    return badRequest(res, "Tipo de movimentacao invalido para filtro.");
  }

  const paymentMethod = normalizePaymentMethod(req.query.paymentMethod);
  if (req.query.paymentMethod !== undefined && !paymentMethod) {
    return badRequest(res, "Forma de pagamento invalida para filtro.");
  }

  const dateFrom = normalizeDateFilter(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateFilter(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a data final.");
  }

  const whereConditions = ["lower(trim(COALESCE(b.account_type, ''))) = 'caixa'"];
  const params = [];
  if (bankId) {
    whereConditions.push("cm.bank_id = ?");
    params.push(bankId);
  }
  if (sessionId) {
    whereConditions.push("cm.session_id = ?");
    params.push(sessionId);
  }
  if (movementType) {
    whereConditions.push("cm.movement_type = ?");
    params.push(movementType);
  }
  if (paymentMethod) {
    whereConditions.push("cm.payment_method = ?");
    params.push(paymentMethod);
  }
  if (dateFrom) {
    whereConditions.push("date(cm.created_at) >= date(?)");
    params.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("date(cm.created_at) <= date(?)");
    params.push(dateTo);
  }

  const limit = Math.min(Math.max(parseNumber(req.query.limit, 300), 1), 2000);
  const whereSql = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
      SELECT
        cm.id,
        cm.session_id,
        cm.bank_id,
        cm.movement_type,
        cm.payment_method,
        cm.movement_origin,
        cm.destination_bank_id,
        cm.order_id,
        cm.amount,
        cm.description,
        cm.created_at,
        b.bank_name,
        b.account_name,
        dbk.bank_name AS destination_bank_name,
        dbk.account_name AS destination_account_name,
        o.order_number,
        u.name AS created_by_name
      FROM cash_movements cm
      JOIN banks b ON b.id = cm.bank_id
      LEFT JOIN banks dbk ON dbk.id = cm.destination_bank_id
      LEFT JOIN orders o ON o.id = cm.order_id
      LEFT JOIN users u ON u.id = cm.created_by
      ${whereSql}
      ORDER BY cm.created_at DESC, cm.id DESC
      LIMIT ?
    `
    )
    .all(...params, limit)
    .map((row) => {
      const normalizedPaymentMethod = normalizePaymentMethod(row.payment_method) || "cash";
      return {
        ...row,
        amount: roundMoney(row.amount),
        payment_method: normalizedPaymentMethod,
        payment_method_label: PAYMENT_METHOD_LABELS[normalizedPaymentMethod]
      };
    });

  return res.json(rows);
});

router.get("/sales/pending", (req, res) => {
  const dateFrom = normalizeDateFilter(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateFilter(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a data final.");
  }

  const whereConditions = ["o.status = 'paid'", "COALESCE(o.sale_closed, 0) = 0"];
  const params = [];

  if (dateFrom) {
    whereConditions.push("date(o.created_at) >= date(?)");
    params.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("date(o.created_at) <= date(?)");
    params.push(dateTo);
  }

  const limit = Math.min(Math.max(parseNumber(req.query.limit, 300), 1), 2000);
  const whereSql = `WHERE ${whereConditions.join(" AND ")}`;

  const rows = db
    .prepare(
      `
      SELECT
        o.id,
        o.order_number,
        o.client_id,
        u.name AS client_name,
        o.total_amount,
        o.payment_method,
        o.paid_amount,
        o.change_amount,
        o.created_at,
        (
          SELECT COUNT(*)
          FROM order_items oi
          WHERE oi.order_id = o.id
        ) AS items_count
      FROM orders o
      JOIN users u ON u.id = o.client_id
      ${whereSql}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ?
    `
    )
    .all(...params, limit)
    .map((row) => {
      const paymentMethod = normalizePaymentMethod(row.payment_method) || "pix";
      return {
        ...row,
        total_amount: roundMoney(row.total_amount),
        paid_amount: roundMoney(row.paid_amount),
        change_amount: roundMoney(row.change_amount),
        payment_method: paymentMethod,
        payment_method_label: PAYMENT_METHOD_LABELS[paymentMethod]
      };
    });

  return res.json(rows);
});

router.post("/open", (req, res) => {
  const bankId = parseNullableId(req.body.bankId);
  if (!bankId) {
    return badRequest(res, "Informe um caixa valido para abrir.");
  }

  const bank = getCashBankById(bankId);
  if (!bank) {
    return notFound(res, "Caixa nao encontrado ou inativo.");
  }

  const alreadyOpenSession = getOpenSessionByBankId(bankId);
  if (alreadyOpenSession) {
    return badRequest(res, "Este caixa ja esta aberto.");
  }

  const hasOpeningBalance =
    req.body.openingBalance !== undefined &&
    req.body.openingBalance !== null &&
    String(req.body.openingBalance).trim() !== "";
  const parsedOpeningBalance = hasOpeningBalance
    ? parseNumber(req.body.openingBalance, NaN)
    : Number(bank.current_balance || 0);

  if (!Number.isFinite(parsedOpeningBalance) || parsedOpeningBalance < 0) {
    return badRequest(res, "Saldo de abertura invalido.");
  }

  const openingBalance = roundMoney(parsedOpeningBalance);
  const notes = toOptionalText(req.body.notes);
  const today = getTodayDate();

  const openTx = db.transaction(() => {
    const sessionId = db
      .prepare(
        `
        INSERT INTO cash_sessions
          (bank_id, opened_on, opened_by, opening_balance, notes, status)
        VALUES
          (?, ?, ?, ?, ?, 'open')
      `
      )
      .run(bankId, today, req.user.id, openingBalance, notes).lastInsertRowid;

    db.prepare(
      `
      UPDATE banks
      SET current_balance = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(openingBalance, bankId);

    return sessionId;
  });

  const sessionId = openTx();
  return res.status(201).json(buildSessionDto(getCashSessionById(sessionId)));
});

router.post("/sales/:orderId/close", (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return badRequest(res, "Pedido invalido para fechamento.");
  }

  const bankId = parseNullableId(req.body.bankId);
  if (!bankId) {
    return badRequest(res, "Informe um caixa valido para fechar a venda.");
  }

  const bank = getCashBankById(bankId);
  if (!bank) {
    return notFound(res, "Caixa nao encontrado ou inativo.");
  }

  const openSession = getOpenSessionByBankId(bankId);
  if (!openSession) {
    return badRequest(res, "Caixa selecionado esta fechado. Abra o caixa para fechar vendas.");
  }

  const order = getOrderById(orderId);
  if (!order) {
    return notFound(res, "Pedido nao encontrado.");
  }
  if (String(order.status) !== "paid") {
    return badRequest(res, "Somente pedidos pagos podem ser fechados no caixa.");
  }
  if (Number(order.sale_closed || 0) === 1) {
    return badRequest(res, "Este pedido ja foi fechado no caixa.");
  }

  const totalAmount = roundMoney(order.total_amount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return badRequest(res, "Pedido com valor invalido para fechamento.");
  }

  try {
    const result = closeSaleByOrderId({
      orderId,
      bankId,
      userId: req.user.id
    });
    return res.status(201).json({
      movement: getMovementById(result.movementId),
      session: buildSessionDto(getCashSessionById(result.sessionId)),
      order: getOrderById(orderId)
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

router.post("/transfer", (req, res) => {
  const bankId = parseNullableId(req.body.bankId);
  if (!bankId) {
    return badRequest(res, "Informe um caixa valido para transferir valores.");
  }

  const bank = getCashBankById(bankId);
  if (!bank) {
    return notFound(res, "Caixa nao encontrado ou inativo.");
  }

  const sourceSession = getOpenSessionByBankId(bankId);
  if (!sourceSession) {
    return badRequest(res, "Caixa selecionado esta fechado. Abra o caixa para movimentar.");
  }

  const destinationBankId = parseNullableId(req.body.destinationBankId);
  if (!destinationBankId) {
    return badRequest(res, "Banco de destino e obrigatorio para transferencia.");
  }

  const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
  if (!paymentMethod) {
    return badRequest(res, "Forma de pagamento invalida para transferencia.");
  }

  const parsedAmount = parseNumber(req.body.amount, NaN);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return badRequest(res, "Informe um valor valido para transferencia.");
  }

  const amount = roundMoney(parsedAmount);
  const methodBalance = getSessionPaymentMethodBalance(sourceSession, paymentMethod);
  if (amount > methodBalance) {
    return badRequest(
      res,
      `Valor maior que o saldo disponivel em ${PAYMENT_METHOD_LABELS[paymentMethod]} (${roundMoney(
        methodBalance
      ).toFixed(2)}).`
    );
  }

  const description = toOptionalText(req.body.description) || "Transferencia manual do caixa";

  try {
    const transferTx = db.transaction(() => {
      const transferResult = transferFromOpenCashSession({
        sourceBankId: bankId,
        destinationBankId,
        paymentMethod,
        amount,
        description,
        createdBy: req.user.id
      });

      return {
        movement: getMovementById(transferResult.sourceMovementId),
        session: buildSessionDto(getCashSessionById(transferResult.sourceSessionId))
      };
    });

    const result = transferTx();
    return res.status(201).json(result);
  } catch (error) {
    return badRequest(res, error.message);
  }
});

router.post("/sales/close-by-number", (req, res) => {
  const bankId = parseNullableId(req.body.bankId);
  if (!bankId) {
    return badRequest(res, "Informe um caixa valido para fechar a venda.");
  }

  const bank = getCashBankById(bankId);
  if (!bank) {
    return notFound(res, "Caixa nao encontrado ou inativo.");
  }

  const openSession = getOpenSessionByBankId(bankId);
  if (!openSession) {
    return badRequest(res, "Caixa selecionado esta fechado. Abra o caixa para fechar vendas.");
  }

  const normalizedOrderNumber = normalizeOrderNumberInput(req.body.orderNumber);
  if (!normalizedOrderNumber) {
    return badRequest(res, "Informe um numero de pedido valido.");
  }

  const pendingOrder = findPendingOrderByOrderNumber(normalizedOrderNumber);
  if (!pendingOrder) {
    return notFound(res, "Pedido pendente nao encontrado para o numero informado.");
  }

  const order = getOrderById(pendingOrder.id);
  if (!order) {
    return notFound(res, "Pedido nao encontrado.");
  }

  try {
    const result = closeSaleByOrderId({
      orderId: order.id,
      bankId,
      userId: req.user.id
    });
    return res.status(201).json({
      movement: getMovementById(result.movementId),
      session: buildSessionDto(getCashSessionById(result.sessionId)),
      order: getOrderById(order.id)
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

router.post("/close", (req, res) => {
  const bankId = parseNullableId(req.body.bankId);
  if (!bankId) {
    return badRequest(res, "Informe um caixa valido para fechar.");
  }

  const bank = getCashBankById(bankId);
  if (!bank) {
    return notFound(res, "Caixa nao encontrado ou inativo.");
  }

  const session = getOpenSessionByBankId(bankId);
  if (!session) {
    return badRequest(res, "Este caixa ja esta fechado.");
  }

  const closeNotes = toOptionalText(req.body.notes);
  const paymentBalances = getSessionPaymentBalances(session);

  const transferPayload = req.body.transfers;
  if (transferPayload !== undefined && !Array.isArray(transferPayload)) {
    return badRequest(res, "Formato invalido para transferencias do fechamento.");
  }
  const transferRows = Array.isArray(transferPayload) ? transferPayload : [];

  const requestedTransferByMethod = new Map();
  for (const row of transferRows) {
    const paymentMethod = normalizePaymentMethod(row?.paymentMethod);
    if (!paymentMethod) {
      return badRequest(res, "Forma de pagamento invalida na transferencia de fechamento.");
    }
    if (requestedTransferByMethod.has(paymentMethod)) {
      return badRequest(
        res,
        `Existe mais de uma transferencia para ${PAYMENT_METHOD_LABELS[paymentMethod]}.`
      );
    }

    const parsedAmount = parseNumber(row?.amount, NaN);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return badRequest(
        res,
        `Valor invalido para transferencia de ${PAYMENT_METHOD_LABELS[paymentMethod]}.`
      );
    }

    requestedTransferByMethod.set(paymentMethod, {
      paymentMethod,
      amount: roundMoney(parsedAmount),
      destinationBankId: parseNullableId(row?.destinationBankId),
      description: toOptionalText(row?.description)
    });
  }

  const transferPlan = [];

  for (const paymentMethod of PAYMENT_METHODS) {
    const methodBalance = roundMoney(paymentBalances[paymentMethod]?.balance || 0);
    const requestedTransfer = requestedTransferByMethod.get(paymentMethod);

    if (paymentMethod === "cash") {
      if (!requestedTransfer) continue;

      if (requestedTransfer.amount <= 0) {
        continue;
      }
      if (requestedTransfer.amount > methodBalance) {
        return badRequest(
          res,
          `Transferencia em Dinheiro maior que o saldo disponivel (${roundMoney(methodBalance).toFixed(2)}).`
        );
      }
      if (!requestedTransfer.destinationBankId) {
        return badRequest(res, "Informe o banco de destino para transferencia de Dinheiro.");
      }

      transferPlan.push({
        ...requestedTransfer,
        amount: roundMoney(requestedTransfer.amount)
      });
      continue;
    }

    if (methodBalance <= 0) {
      if (requestedTransfer && requestedTransfer.amount > 0) {
        return badRequest(
          res,
          `Nao ha saldo em ${PAYMENT_METHOD_LABELS[paymentMethod]} para transferir.`
        );
      }
      continue;
    }

    if (!requestedTransfer) {
      return badRequest(
        res,
        `No fechamento, ${PAYMENT_METHOD_LABELS[paymentMethod]} deve ser transferido integralmente.`
      );
    }
    if (!requestedTransfer.destinationBankId) {
      return badRequest(
        res,
        `Informe o banco de destino para ${PAYMENT_METHOD_LABELS[paymentMethod]}.`
      );
    }

    if (toMoneyCents(requestedTransfer.amount) !== toMoneyCents(methodBalance)) {
      return badRequest(
        res,
        `${PAYMENT_METHOD_LABELS[paymentMethod]} deve ser transferido no valor total (${roundMoney(
          methodBalance
        ).toFixed(2)}).`
      );
    }

    transferPlan.push({
      ...requestedTransfer,
      amount: methodBalance
    });
  }

  for (const transferItem of transferPlan) {
    if (!transferItem.destinationBankId) {
      return badRequest(res, "Banco de destino obrigatorio nas transferencias do fechamento.");
    }
    try {
      assertDestinationBankForTransfer(bankId, transferItem.destinationBankId);
    } catch (error) {
      return badRequest(res, error.message);
    }
  }

  try {
    const closeTx = db.transaction(() => {
      const transferMovementIds = [];
      transferPlan.forEach((transferItem) => {
        const transferResult = transferFromOpenCashSession({
          sourceBankId: bankId,
          destinationBankId: transferItem.destinationBankId,
          paymentMethod: transferItem.paymentMethod,
          amount: transferItem.amount,
          description:
            transferItem.description ||
            `Transferencia de fechamento (${PAYMENT_METHOD_LABELS[transferItem.paymentMethod]})`,
          createdBy: req.user.id
        });

        transferMovementIds.push(transferResult.sourceMovementId);
      });

      const refreshedSession = getOpenSessionByBankId(bankId);
      if (!refreshedSession) {
        throw new Error("Nao foi possivel fechar o caixa porque a sessao nao esta aberta.");
      }

      const closingBalance = getSessionCurrentBalance(refreshedSession);
      const mergedNotes = closeNotes || refreshedSession.notes || null;

      db.prepare(
        `
        UPDATE cash_sessions
        SET
          status = 'closed',
          closed_at = datetime('now'),
          closed_by = ?,
          closing_balance = ?,
          closing_reason = 'manual_close',
          notes = ?,
          updated_at = datetime('now')
        WHERE id = ?
          AND status = 'open'
      `
      ).run(req.user.id, closingBalance, mergedNotes, refreshedSession.id);

      db.prepare(
        `
        UPDATE banks
        SET current_balance = ?, updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(closingBalance, bankId);

      return {
        sessionId: refreshedSession.id,
        transferMovementIds,
        closingBalance
      };
    });

    const result = closeTx();
    return res.json({
      ...buildSessionDto(getCashSessionById(result.sessionId)),
      transfer_movement_ids: result.transferMovementIds
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

module.exports = router;
