const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, notFound } = require("../../utils/http");
const { dayjs } = require("../../utils/date");

const router = express.Router();
router.use(authenticate, requireRoles("gerente"));

const PAYABLE_STATUS_VALUES = ["pending", "paid", "cancelled"];
const RECEIVABLE_STATUS_VALUES = ["pending", "received", "cancelled"];

function parseNumber(value, fallback = 0) {
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function normalizeStatus(value, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  if (allowedValues.includes(normalized)) return normalized;
  return null;
}

function normalizePayableFilterStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (PAYABLE_STATUS_VALUES.includes(normalized) || normalized === "overdue") {
    return normalized;
  }
  return null;
}

function normalizeReceivableFilterStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (RECEIVABLE_STATUS_VALUES.includes(normalized) || normalized === "overdue") {
    return normalized;
  }
  return null;
}

function normalizeEntryType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "payable" || normalized === "receivable") return normalized;
  return null;
}

function normalizeSettlementStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["pending", "liquidated", "cancelled"].includes(normalized)) return normalized;
  return null;
}

function normalizeEntriesPeriodMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "issue";
  if (["issue", "issue_or_liquidated"].includes(normalized)) return normalized;
  return null;
}

function resolvePeriodStart(period) {
  if (period === "daily") return dayjs().startOf("day");
  if (period === "weekly") return dayjs().startOf("week");
  return dayjs().startOf("month");
}

function getTodayDate() {
  return dayjs().format("YYYY-MM-DD");
}

function getIssueDateFromCreatedAt(createdAtValue) {
  const issueDate = String(createdAtValue || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate : null;
}

function validateIssueDateNotAfterToday(res, issueDate, today = getTodayDate()) {
  if (!issueDate) return null;
  if (issueDate > today) {
    return badRequest(res, "Data de emissao nao pode ser superior a data atual.");
  }
  return null;
}

function validateLiquidationDateAgainstIssueDate(res, liquidationDate, issueDate, today = getTodayDate()) {
  if (!liquidationDate) return null;
  if (liquidationDate > today) {
    return badRequest(res, "Data de liquidacao nao pode ser superior a data atual.");
  }
  if (issueDate && liquidationDate < issueDate) {
    return badRequest(res, "Data de liquidacao nao pode ser inferior a data de emissao.");
  }
  return null;
}

function validateDueDateAgainstIssueAndToday(res, dueDate, issueDate) {
  if (!dueDate) return null;
  if (issueDate && dueDate < issueDate) {
    return badRequest(res, "Data de vencimento nao pode ser inferior a data de emissao.");
  }
  return null;
}

function getSupplierById(supplierId) {
  return db
    .prepare(
      `
      SELECT id, name, active
      FROM suppliers
      WHERE id = ?
    `
    )
    .get(supplierId);
}

function getExpenseTypeById(expenseTypeId) {
  return db
    .prepare(
      `
      SELECT id, name, active
      FROM expense_types
      WHERE id = ?
    `
    )
    .get(expenseTypeId);
}

function getClientById(clientId) {
  return db
    .prepare(
      `
      SELECT id, name, role
      FROM users
      WHERE id = ?
    `
    )
    .get(clientId);
}

function parseNonNegativeNumber(value, fallback = NaN) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parsePercentageNumber(value, fallback = NaN) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return parsed;
}

function getDirectorTargetByRange(dateFrom, dateTo) {
  return db
    .prepare(
      `
      SELECT
        id,
        date_from,
        date_to,
        revenue_target,
        expense_limit,
        projected_margin_target,
        liquidation_rate_target,
        receivable_delinquency_limit,
        pending_coverage_target,
        notes,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM financial_director_targets
      WHERE date_from = ? AND date_to = ?
      LIMIT 1
    `
    )
    .get(dateFrom, dateTo);
}

function toDirectorTargetDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    date_from: row.date_from,
    date_to: row.date_to,
    revenue_target: roundMoney(row.revenue_target),
    expense_limit: roundMoney(row.expense_limit),
    projected_margin_target: roundMoney(row.projected_margin_target),
    liquidation_rate_target: roundMoney(row.liquidation_rate_target),
    receivable_delinquency_limit: roundMoney(row.receivable_delinquency_limit),
    pending_coverage_target: roundMoney(row.pending_coverage_target),
    notes: row.notes || null,
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function getPayableById(accountId) {
  return db
    .prepare(
      `
      SELECT
        ap.id,
        ap.supplier_id,
        ap.expense_type_id,
        ap.description,
        ap.amount,
        ap.issue_date,
        ap.due_date,
        ap.status,
        ap.paid_on,
        ap.notes,
        ap.financial_transaction_id,
        ap.created_by,
        ap.created_at,
        ap.updated_at,
        s.name AS supplier_name,
        et.name AS expense_type_name,
        cu.name AS created_by_name
      FROM accounts_payable ap
      JOIN suppliers s ON s.id = ap.supplier_id
      JOIN expense_types et ON et.id = ap.expense_type_id
      LEFT JOIN users cu ON cu.id = ap.created_by
      WHERE ap.id = ?
    `
    )
    .get(accountId);
}

function getReceivableById(accountId) {
  return db
    .prepare(
      `
      SELECT
        ar.id,
        ar.client_id,
        ar.description,
        ar.amount,
        ar.issue_date,
        ar.due_date,
        ar.status,
        ar.received_on,
        ar.notes,
        ar.financial_transaction_id,
        ar.created_by,
        ar.created_at,
        ar.updated_at,
        u.name AS client_name,
        cu.name AS created_by_name
      FROM accounts_receivable ar
      JOIN users u ON u.id = ar.client_id
      LEFT JOIN users cu ON cu.id = ar.created_by
      WHERE ar.id = ?
    `
    )
    .get(accountId);
}

function toPayableDto(account, today = getTodayDate()) {
  if (!account) return null;
  const isOverdue = account.status === "pending" && account.due_date < today;
  return {
    ...account,
    amount: roundMoney(account.amount),
    is_overdue: isOverdue,
    computed_status: isOverdue ? "overdue" : account.status
  };
}

function toReceivableDto(account, today = getTodayDate()) {
  if (!account) return null;
  const isOverdue = account.status === "pending" && account.due_date < today;
  return {
    ...account,
    amount: roundMoney(account.amount),
    is_overdue: isOverdue,
    computed_status: isOverdue ? "overdue" : account.status
  };
}

function syncPayableFinancialTransaction(accountId) {
  const row = getPayableById(accountId);
  if (!row) {
    throw new Error("Conta a pagar não encontrada.");
  }

  if (row.status !== "paid") {
    if (row.financial_transaction_id) {
      db.prepare("DELETE FROM financial_transactions WHERE id = ?").run(row.financial_transaction_id);
      db.prepare("UPDATE accounts_payable SET financial_transaction_id = NULL WHERE id = ?").run(accountId);
    }
    return;
  }

  const occurredOn = row.paid_on || getTodayDate();
  const category = row.expense_type_name || "conta a pagar";
  const description =
    toOptionalText(row.description) ||
    `Conta a pagar #${row.id}${row.supplier_name ? ` - ${row.supplier_name}` : ""}`;

  if (row.financial_transaction_id) {
    db.prepare(
      `
      UPDATE financial_transactions
      SET
        type = 'expense',
        category = ?,
        amount = ?,
        artist_id = NULL,
        appointment_id = NULL,
        order_id = NULL,
        description = ?,
        occurred_on = ?
      WHERE id = ?
    `
    ).run(category, roundMoney(row.amount), description, occurredOn, row.financial_transaction_id);
    return;
  }

  const transactionId = db
    .prepare(
      `
      INSERT INTO financial_transactions
        (type, category, amount, artist_id, appointment_id, order_id, description, occurred_on)
      VALUES
        ('expense', ?, ?, NULL, NULL, NULL, ?, ?)
    `
    )
    .run(category, roundMoney(row.amount), description, occurredOn).lastInsertRowid;

  db.prepare(
    `
    UPDATE accounts_payable
    SET financial_transaction_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(transactionId, accountId);
}

function syncReceivableFinancialTransaction(accountId) {
  const row = getReceivableById(accountId);
  if (!row) {
    throw new Error("Conta a receber não encontrada.");
  }

  if (row.status !== "received") {
    if (row.financial_transaction_id) {
      db.prepare("DELETE FROM financial_transactions WHERE id = ?").run(row.financial_transaction_id);
      db.prepare("UPDATE accounts_receivable SET financial_transaction_id = NULL WHERE id = ?").run(accountId);
    }
    return;
  }

  const occurredOn = row.received_on || getTodayDate();
  const description =
    toOptionalText(row.description) ||
    `Conta a receber #${row.id}${row.client_name ? ` - ${row.client_name}` : ""}`;
  const category = "conta a receber";

  if (row.financial_transaction_id) {
    db.prepare(
      `
      UPDATE financial_transactions
      SET
        type = 'income',
        category = ?,
        amount = ?,
        artist_id = NULL,
        appointment_id = NULL,
        order_id = NULL,
        description = ?,
        occurred_on = ?
      WHERE id = ?
    `
    ).run(category, roundMoney(row.amount), description, occurredOn, row.financial_transaction_id);
    return;
  }

  const transactionId = db
    .prepare(
      `
      INSERT INTO financial_transactions
        (type, category, amount, artist_id, appointment_id, order_id, description, occurred_on)
      VALUES
        ('income', ?, ?, NULL, NULL, NULL, ?, ?)
    `
    )
    .run(category, roundMoney(row.amount), description, occurredOn).lastInsertRowid;

  db.prepare(
    `
    UPDATE accounts_receivable
    SET financial_transaction_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(transactionId, accountId);
}

router.get("/summary", (req, res) => {
  const period = ["daily", "weekly", "monthly"].includes(req.query.period) ? req.query.period : "monthly";
  const fromDate = resolvePeriodStart(period).format("YYYY-MM-DD");

  const totals = db
    .prepare(
      `
      SELECT type, COALESCE(SUM(amount), 0) AS total
      FROM financial_transactions
      WHERE occurred_on >= ?
      GROUP BY type
    `
    )
    .all(fromDate);

  const income = totals.find((row) => row.type === "income")?.total || 0;
  const expense = totals.find((row) => row.type === "expense")?.total || 0;

  const byCategory = db
    .prepare(
      `
      SELECT category, type, COALESCE(SUM(amount), 0) AS total
      FROM financial_transactions
      WHERE occurred_on >= ?
      GROUP BY category, type
      ORDER BY total DESC
    `
    )
    .all(fromDate)
    .map((row) => ({
      ...row,
      total: roundMoney(row.total)
    }));

  return res.json({
    period,
    fromDate,
    revenue: roundMoney(income),
    expenses: roundMoney(expense),
    profit: roundMoney(Number(income) - Number(expense)),
    byCategory
  });
});

router.get("/artist-earnings", (req, res) => {
  const fromDate = req.query.from || dayjs().startOf("month").format("YYYY-MM-DD");
  const toDate = req.query.to || dayjs().format("YYYY-MM-DD");

  const earnings = db
    .prepare(
      `
      SELECT
        a.id AS artist_id,
        u.name AS artist_name,
        COALESCE(SUM(ft.amount), 0) AS total
      FROM artists a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN financial_transactions ft
        ON ft.artist_id = a.id
        AND ft.type = 'income'
        AND ft.occurred_on >= ?
        AND ft.occurred_on <= ?
      GROUP BY a.id, u.name
      ORDER BY total DESC
    `
    )
    .all(fromDate, toDate)
    .map((row) => ({
      ...row,
      total: roundMoney(row.total)
    }));

  return res.json({
    fromDate,
    toDate,
    earnings
  });
});

router.get("/timeline", (req, res) => {
  const days = Math.min(Math.max(parseNumber(req.query.days, 30), 1), 180);
  const fromDate = dayjs().subtract(days, "day").format("YYYY-MM-DD");

  const rows = db
    .prepare(
      `
      SELECT occurred_on, type, COALESCE(SUM(amount), 0) AS total
      FROM financial_transactions
      WHERE occurred_on >= ?
      GROUP BY occurred_on, type
      ORDER BY occurred_on ASC
    `
    )
    .all(fromDate)
    .map((row) => ({
      ...row,
      total: roundMoney(row.total)
    }));

  return res.json({
    fromDate,
    days,
    rows
  });
});

router.get("/liquidation-timeline", (req, res) => {
  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a final.");
  }

  const payableConditions = ["status = 'paid'", "paid_on IS NOT NULL"];
  const receivableConditions = ["status = 'received'", "received_on IS NOT NULL"];
  const payableParams = [];
  const receivableParams = [];

  if (dateFrom) {
    payableConditions.push("paid_on >= ?");
    receivableConditions.push("received_on >= ?");
    payableParams.push(dateFrom);
    receivableParams.push(dateFrom);
  }

  if (dateTo) {
    payableConditions.push("paid_on <= ?");
    receivableConditions.push("received_on <= ?");
    payableParams.push(dateTo);
    receivableParams.push(dateTo);
  }

  const rows = db
    .prepare(
      `
      WITH liquidation_entries AS (
        SELECT
          paid_on AS liquidated_on,
          0 AS income,
          amount AS expense
        FROM accounts_payable
        WHERE ${payableConditions.join(" AND ")}

        UNION ALL

        SELECT
          received_on AS liquidated_on,
          amount AS income,
          0 AS expense
        FROM accounts_receivable
        WHERE ${receivableConditions.join(" AND ")}
      )
      SELECT
        liquidated_on AS date,
        COALESCE(SUM(income), 0) AS income,
        COALESCE(SUM(expense), 0) AS expense,
        COALESCE(SUM(income), 0) - COALESCE(SUM(expense), 0) AS net
      FROM liquidation_entries
      GROUP BY liquidated_on
      ORDER BY liquidated_on ASC
    `
    )
    .all(...payableParams, ...receivableParams)
    .map((row) => ({
      ...row,
      income: roundMoney(row.income),
      expense: roundMoney(row.expense),
      net: roundMoney(row.net)
    }));

  return res.json({
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    rows
  });
});

router.get("/accounts-overview", (_req, res) => {
  const today = getTodayDate();

  const payable = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_total,
        COALESCE(SUM(CASE WHEN status = 'pending' AND due_date < ? THEN amount ELSE 0 END), 0) AS overdue_total,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_total
      FROM accounts_payable
    `
    )
    .get(today);

  const receivable = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_total,
        COALESCE(SUM(CASE WHEN status = 'pending' AND due_date < ? THEN amount ELSE 0 END), 0) AS overdue_total,
        COALESCE(SUM(CASE WHEN status = 'received' THEN amount ELSE 0 END), 0) AS received_total
      FROM accounts_receivable
    `
    )
    .get(today);

  return res.json({
    payable: {
      pendingTotal: roundMoney(payable?.pending_total || 0),
      overdueTotal: roundMoney(payable?.overdue_total || 0),
      paidTotal: roundMoney(payable?.paid_total || 0)
    },
    receivable: {
      pendingTotal: roundMoney(receivable?.pending_total || 0),
      overdueTotal: roundMoney(receivable?.overdue_total || 0),
      receivedTotal: roundMoney(receivable?.received_total || 0)
    },
    netPending: roundMoney(Number(receivable?.pending_total || 0) - Number(payable?.pending_total || 0))
  });
});

router.get("/director-target", (req, res) => {
  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (!dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (!dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a final.");
  }

  const target = getDirectorTargetByRange(dateFrom, dateTo);
  return res.json({
    target: toDirectorTargetDto(target)
  });
});

router.put("/director-target", (req, res) => {
  const dateFrom = normalizeDateValue(req.body.dateFrom);
  if (!dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.body.dateTo);
  if (!dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a final.");
  }

  const revenueTarget = roundMoney(parseNonNegativeNumber(req.body.revenueTarget, NaN));
  if (!Number.isFinite(revenueTarget)) {
    return badRequest(res, "Meta de receita invalida.");
  }

  const expenseLimit = roundMoney(parseNonNegativeNumber(req.body.expenseLimit, NaN));
  if (!Number.isFinite(expenseLimit)) {
    return badRequest(res, "Limite de despesa invalido.");
  }

  const projectedMarginTarget = roundMoney(parsePercentageNumber(req.body.projectedMarginTarget, NaN));
  if (!Number.isFinite(projectedMarginTarget)) {
    return badRequest(res, "Meta de margem projetada invalida.");
  }

  const liquidationRateTarget = roundMoney(parsePercentageNumber(req.body.liquidationRateTarget, NaN));
  if (!Number.isFinite(liquidationRateTarget)) {
    return badRequest(res, "Meta de taxa de liquidacao invalida.");
  }

  const receivableDelinquencyLimit = roundMoney(
    parsePercentageNumber(req.body.receivableDelinquencyLimit, NaN)
  );
  if (!Number.isFinite(receivableDelinquencyLimit)) {
    return badRequest(res, "Limite de inadimplencia invalido.");
  }

  const pendingCoverageTarget = roundMoney(parseNonNegativeNumber(req.body.pendingCoverageTarget, NaN));
  if (!Number.isFinite(pendingCoverageTarget)) {
    return badRequest(res, "Meta de cobertura pendente invalida.");
  }

  const notes = toOptionalText(req.body.notes);
  const current = getDirectorTargetByRange(dateFrom, dateTo);

  let targetId = null;
  if (current) {
    db.prepare(
      `
      UPDATE financial_director_targets
      SET
        revenue_target = ?,
        expense_limit = ?,
        projected_margin_target = ?,
        liquidation_rate_target = ?,
        receivable_delinquency_limit = ?,
        pending_coverage_target = ?,
        notes = ?,
        updated_by = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      revenueTarget,
      expenseLimit,
      projectedMarginTarget,
      liquidationRateTarget,
      receivableDelinquencyLimit,
      pendingCoverageTarget,
      notes,
      req.user.id,
      current.id
    );
    targetId = current.id;
  } else {
    targetId = db
      .prepare(
        `
        INSERT INTO financial_director_targets
          (
            date_from,
            date_to,
            revenue_target,
            expense_limit,
            projected_margin_target,
            liquidation_rate_target,
            receivable_delinquency_limit,
            pending_coverage_target,
            notes,
            created_by,
            updated_by
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        dateFrom,
        dateTo,
        revenueTarget,
        expenseLimit,
        projectedMarginTarget,
        liquidationRateTarget,
        receivableDelinquencyLimit,
        pendingCoverageTarget,
        notes,
        req.user.id,
        req.user.id
      ).lastInsertRowid;
  }

  const saved = db
    .prepare(
      `
      SELECT
        id,
        date_from,
        date_to,
        revenue_target,
        expense_limit,
        projected_margin_target,
        liquidation_rate_target,
        receivable_delinquency_limit,
        pending_coverage_target,
        notes,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM financial_director_targets
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(targetId);

  return res.json({
    target: toDirectorTargetDto(saved)
  });
});

router.get("/entries", (req, res) => {
  const entryType = normalizeEntryType(req.query.entryType);
  if (req.query.entryType !== undefined && !entryType) {
    return badRequest(res, "Tipo de lancamento invalido.");
  }

  const periodMode = normalizeEntriesPeriodMode(req.query.periodMode);
  if (req.query.periodMode !== undefined && !periodMode) {
    return badRequest(res, "Modo de periodo invalido. Use issue ou issue_or_liquidated.");
  }

  const settlementStatus = normalizeSettlementStatus(req.query.settlementStatus);
  if (req.query.settlementStatus !== undefined && !settlementStatus) {
    return badRequest(res, "Situacao de liquidacao invalida.");
  }

  const issueDateFrom = normalizeDateValue(req.query.issueDateFrom);
  if (req.query.issueDateFrom !== undefined && !issueDateFrom) {
    return badRequest(res, "Data de emissao inicial invalida. Use YYYY-MM-DD.");
  }
  const issueDateTo = normalizeDateValue(req.query.issueDateTo);
  if (req.query.issueDateTo !== undefined && !issueDateTo) {
    return badRequest(res, "Data de emissao final invalida. Use YYYY-MM-DD.");
  }
  if (issueDateFrom && issueDateTo && issueDateFrom > issueDateTo) {
    return badRequest(res, "Data de emissao inicial nao pode ser maior que a final.");
  }

  const dueDateFrom = normalizeDateValue(req.query.dueDateFrom);
  if (req.query.dueDateFrom !== undefined && !dueDateFrom) {
    return badRequest(res, "Data de vencimento inicial invalida. Use YYYY-MM-DD.");
  }
  const dueDateTo = normalizeDateValue(req.query.dueDateTo);
  if (req.query.dueDateTo !== undefined && !dueDateTo) {
    return badRequest(res, "Data de vencimento final invalida. Use YYYY-MM-DD.");
  }
  if (dueDateFrom && dueDateTo && dueDateFrom > dueDateTo) {
    return badRequest(res, "Data de vencimento inicial nao pode ser maior que a final.");
  }

  const whereConditions = [];
  const queryParams = [];

  if (entryType) {
    whereConditions.push("entry_type = ?");
    queryParams.push(entryType);
  }

  if (settlementStatus) {
    if (settlementStatus === "liquidated") {
      whereConditions.push(
        "((entry_type = 'payable' AND status = 'paid') OR (entry_type = 'receivable' AND status = 'received'))"
      );
    } else if (settlementStatus === "pending") {
      whereConditions.push("status = 'pending'");
    } else if (settlementStatus === "cancelled") {
      whereConditions.push("status = 'cancelled'");
    }
  }

  if (periodMode === "issue_or_liquidated") {
    if (issueDateFrom && issueDateTo) {
      whereConditions.push(
        "((issue_date >= ? AND issue_date <= ?) OR (liquidated_on IS NOT NULL AND liquidated_on >= ? AND liquidated_on <= ?))"
      );
      queryParams.push(issueDateFrom, issueDateTo, issueDateFrom, issueDateTo);
    } else if (issueDateFrom) {
      whereConditions.push("(issue_date >= ? OR (liquidated_on IS NOT NULL AND liquidated_on >= ?))");
      queryParams.push(issueDateFrom, issueDateFrom);
    } else if (issueDateTo) {
      whereConditions.push("(issue_date <= ? OR (liquidated_on IS NOT NULL AND liquidated_on <= ?))");
      queryParams.push(issueDateTo, issueDateTo);
    }
  } else {
    if (issueDateFrom) {
      whereConditions.push("issue_date >= ?");
      queryParams.push(issueDateFrom);
    }
    if (issueDateTo) {
      whereConditions.push("issue_date <= ?");
      queryParams.push(issueDateTo);
    }
  }
  if (dueDateFrom) {
    whereConditions.push("due_date >= ?");
    queryParams.push(dueDateFrom);
  }
  if (dueDateTo) {
    whereConditions.push("due_date <= ?");
    queryParams.push(dueDateTo);
  }

  const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(parseNumber(req.query.limit, 1000), 1), 3000);

  const rows = db
    .prepare(
      `
      WITH unified_entries AS (
        SELECT
          'payable' AS entry_type,
          ap.id AS entry_id,
          ap.description,
          ap.amount,
          ap.due_date,
          ap.issue_date AS issue_date,
          ap.status,
          ap.paid_on AS liquidated_on,
          ap.notes,
          ap.created_at,
          ap.updated_at,
          ap.supplier_id AS counterparty_id,
          s.name AS counterparty_name,
          et.name AS expense_type_name
        FROM accounts_payable ap
        JOIN suppliers s ON s.id = ap.supplier_id
        JOIN expense_types et ON et.id = ap.expense_type_id
        UNION ALL
        SELECT
          'receivable' AS entry_type,
          ar.id AS entry_id,
          ar.description,
          ar.amount,
          ar.due_date,
          ar.issue_date AS issue_date,
          ar.status,
          ar.received_on AS liquidated_on,
          ar.notes,
          ar.created_at,
          ar.updated_at,
          ar.client_id AS counterparty_id,
          u.name AS counterparty_name,
          NULL AS expense_type_name
        FROM accounts_receivable ar
        JOIN users u ON u.id = ar.client_id
      )
      SELECT
        *,
        CASE
          WHEN (entry_type = 'payable' AND status = 'paid')
            OR (entry_type = 'receivable' AND status = 'received')
          THEN 'liquidated'
          WHEN status = 'cancelled' THEN 'cancelled'
          ELSE 'pending'
        END AS settlement_status
      FROM unified_entries
      ${whereClause}
      ORDER BY due_date DESC, created_at DESC, entry_id DESC
      LIMIT ?
    `
    )
    .all(...queryParams, limit)
    .map((row) => ({
      ...row,
      amount: roundMoney(row.amount)
    }));

  return res.json(rows);
});

router.get("/accounts-payable/by-expense-type", (req, res) => {
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

  const joinConditions = ["ap.expense_type_id = et.id"];
  const joinParams = [];
  if (dateFrom) {
    joinConditions.push("ap.due_date >= ?");
    joinParams.push(dateFrom);
  }
  if (dateTo) {
    joinConditions.push("ap.due_date <= ?");
    joinParams.push(dateTo);
  }

  const rows = db
    .prepare(
      `
      SELECT
        et.id AS expense_type_id,
        et.name AS expense_type_name,
        COALESCE(SUM(CASE WHEN ap.status = 'pending' THEN ap.amount ELSE 0 END), 0) AS pending_total,
        COALESCE(SUM(CASE WHEN ap.status = 'paid' THEN ap.amount ELSE 0 END), 0) AS paid_total,
        COALESCE(SUM(CASE WHEN ap.status = 'cancelled' THEN ap.amount ELSE 0 END), 0) AS cancelled_total,
        COALESCE(SUM(ap.amount), 0) AS total
      FROM expense_types et
      LEFT JOIN accounts_payable ap ON ${joinConditions.join(" AND ")}
      WHERE et.active = 1
      GROUP BY et.id, et.name
      ORDER BY total DESC, et.name ASC
    `
    )
    .all(...joinParams)
    .map((row) => ({
      ...row,
      pending_total: roundMoney(row.pending_total),
      paid_total: roundMoney(row.paid_total),
      cancelled_total: roundMoney(row.cancelled_total),
      total: roundMoney(row.total)
    }));

  return res.json({
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    rows
  });
});

router.get("/accounts-receivable/by-client", (req, res) => {
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

  const joinConditions = ["ar.client_id = u.id"];
  const joinParams = [];
  if (dateFrom) {
    joinConditions.push("ar.due_date >= ?");
    joinParams.push(dateFrom);
  }
  if (dateTo) {
    joinConditions.push("ar.due_date <= ?");
    joinParams.push(dateTo);
  }

  const rows = db
    .prepare(
      `
      SELECT
        u.id AS client_id,
        u.name AS client_name,
        COALESCE(SUM(CASE WHEN ar.status = 'pending' THEN ar.amount ELSE 0 END), 0) AS pending_total,
        COALESCE(SUM(CASE WHEN ar.status = 'received' THEN ar.amount ELSE 0 END), 0) AS received_total,
        COALESCE(SUM(CASE WHEN ar.status = 'cancelled' THEN ar.amount ELSE 0 END), 0) AS cancelled_total,
        COALESCE(SUM(ar.amount), 0) AS total
      FROM users u
      LEFT JOIN accounts_receivable ar ON ${joinConditions.join(" AND ")}
      WHERE u.role = 'cliente'
      GROUP BY u.id, u.name
      ORDER BY total DESC, u.name ASC
    `
    )
    .all(...joinParams)
    .map((row) => ({
      ...row,
      pending_total: roundMoney(row.pending_total),
      received_total: roundMoney(row.received_total),
      cancelled_total: roundMoney(row.cancelled_total),
      total: roundMoney(row.total)
    }));

  return res.json({
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    rows
  });
});

router.get("/accounts-payable", (req, res) => {
  const supplierId = parseNullableId(req.query.supplierId);
  if (req.query.supplierId !== undefined && !supplierId) {
    return badRequest(res, "Fornecedor inválido para filtro.");
  }

  const expenseTypeId = parseNullableId(req.query.expenseTypeId);
  if (req.query.expenseTypeId !== undefined && !expenseTypeId) {
    return badRequest(res, "Tipo de despesa inválido para filtro.");
  }

  const statusFilter = normalizePayableFilterStatus(req.query.status);
  if (req.query.status !== undefined && !statusFilter) {
    return badRequest(res, "Status inválido para filtro.");
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
  const today = getTodayDate();

  if (supplierId) {
    whereConditions.push("ap.supplier_id = ?");
    queryParams.push(supplierId);
  }
  if (expenseTypeId) {
    whereConditions.push("ap.expense_type_id = ?");
    queryParams.push(expenseTypeId);
  }
  if (statusFilter) {
    if (statusFilter === "overdue") {
      whereConditions.push("ap.status = 'pending' AND ap.due_date < ?");
      queryParams.push(today);
    } else {
      whereConditions.push("ap.status = ?");
      queryParams.push(statusFilter);
    }
  }
  if (dateFrom) {
    whereConditions.push("ap.due_date >= ?");
    queryParams.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("ap.due_date <= ?");
    queryParams.push(dateTo);
  }
  if (req.query.search) {
    whereConditions.push("lower(ap.description) LIKE ?");
    queryParams.push(`%${String(req.query.search).toLowerCase()}%`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(parseNumber(req.query.limit, 500), 1), 2000);

  const rows = db
    .prepare(
      `
      SELECT
        ap.id,
        ap.supplier_id,
        ap.expense_type_id,
        ap.description,
        ap.amount,
        ap.issue_date,
        ap.due_date,
        ap.status,
        ap.paid_on,
        ap.notes,
        ap.financial_transaction_id,
        ap.created_by,
        ap.created_at,
        ap.updated_at,
        s.name AS supplier_name,
        et.name AS expense_type_name,
        cu.name AS created_by_name
      FROM accounts_payable ap
      JOIN suppliers s ON s.id = ap.supplier_id
      JOIN expense_types et ON et.id = ap.expense_type_id
      LEFT JOIN users cu ON cu.id = ap.created_by
      ${whereClause}
      ORDER BY ap.due_date DESC, ap.id DESC
      LIMIT ?
    `
    )
    .all(...queryParams, limit)
    .map((row) => toPayableDto(row, today));

  return res.json(rows);
});

router.post("/accounts-payable", (req, res) => {
  const supplierId = parseNullableId(req.body.supplierId);
  if (!supplierId) {
    return badRequest(res, "Fornecedor é obrigatório.");
  }

  const supplier = getSupplierById(supplierId);
  if (!supplier) {
    return notFound(res, "Fornecedor não encontrado.");
  }

  const expenseTypeId = parseNullableId(req.body.expenseTypeId);
  if (!expenseTypeId) {
    return badRequest(res, "Tipo de despesa é obrigatório.");
  }

  const expenseType = getExpenseTypeById(expenseTypeId);
  if (!expenseType) {
    return notFound(res, "Tipo de despesa não encontrado.");
  }
  if (!expenseType.active) {
    return badRequest(res, "Tipo de despesa inativo.");
  }

  const description = String(req.body.description || "").trim();
  if (!description) {
    return badRequest(res, "Descrição é obrigatória.");
  }

  const amount = roundMoney(parseNumber(req.body.amount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest(res, "Valor inválido.");
  }

  const dueDate = normalizeDateValue(req.body.dueDate);
  if (!dueDate) {
    return badRequest(res, "Data de vencimento inválida. Use YYYY-MM-DD.");
  }

  const rawPayableIssueDate = req.body.issueDate;
  const payableIssueDate =
    rawPayableIssueDate === undefined || rawPayableIssueDate === null || String(rawPayableIssueDate).trim() === ""
      ? getTodayDate()
      : normalizeDateValue(rawPayableIssueDate);
  if (!payableIssueDate) {
    return badRequest(res, "Data de emissao invalida. Use YYYY-MM-DD.");
  }
  const payableIssueDateError = validateIssueDateNotAfterToday(res, payableIssueDate);
  if (payableIssueDateError) {
    return payableIssueDateError;
  }
  const payableDueDateError = validateDueDateAgainstIssueAndToday(res, dueDate, payableIssueDate);
  if (payableDueDateError) {
    return payableDueDateError;
  }

  const status = req.body.status
    ? normalizeStatus(req.body.status, PAYABLE_STATUS_VALUES)
    : "pending";
  if (!status) {
    return badRequest(res, "Status inválido.");
  }

  const paidOn = status === "paid" ? normalizeDateValue(req.body.paidOn) || getTodayDate() : null;
  const payableLiquidationDateError = validateLiquidationDateAgainstIssueDate(
    res,
    paidOn,
    payableIssueDate
  );
  if (payableLiquidationDateError) {
    return payableLiquidationDateError;
  }

  const createTx = db.transaction(() => {
    const accountId = db
      .prepare(
        `
        INSERT INTO accounts_payable
          (supplier_id, expense_type_id, description, amount, issue_date, due_date, status, paid_on, notes, created_by)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        supplierId,
        expenseTypeId,
        description,
        amount,
        payableIssueDate,
        dueDate,
        status,
        paidOn,
        toOptionalText(req.body.notes),
        req.user.id
      ).lastInsertRowid;

    syncPayableFinancialTransaction(accountId);
    return accountId;
  });

  const accountId = createTx();
  return res.status(201).json(toPayableDto(getPayableById(accountId)));
});

router.patch("/accounts-payable/:id", (req, res) => {
  const accountId = Number(req.params.id);
  if (!accountId) {
    return badRequest(res, "ID de conta a pagar invalido.");
  }

  const current = getPayableById(accountId);
  if (!current) {
    return notFound(res, "Conta a pagar nao encontrada.");
  }

  const nextSupplierId =
    req.body.supplierId !== undefined ? parseNullableId(req.body.supplierId) : current.supplier_id;
  if (!nextSupplierId) {
    return badRequest(res, "Fornecedor invalido.");
  }
  const supplier = getSupplierById(nextSupplierId);
  if (!supplier) {
    return notFound(res, "Fornecedor nao encontrado.");
  }

  const nextExpenseTypeId =
    req.body.expenseTypeId !== undefined
      ? parseNullableId(req.body.expenseTypeId)
      : current.expense_type_id;
  if (!nextExpenseTypeId) {
    return badRequest(res, "Tipo de despesa invalido.");
  }
  const expenseType = getExpenseTypeById(nextExpenseTypeId);
  if (!expenseType) {
    return notFound(res, "Tipo de despesa nao encontrado.");
  }

  const nextDescription =
    req.body.description !== undefined ? String(req.body.description).trim() : current.description;
  if (!nextDescription) {
    return badRequest(res, "Descricao e obrigatoria.");
  }

  const nextAmount =
    req.body.amount !== undefined ? roundMoney(parseNumber(req.body.amount, NaN)) : roundMoney(current.amount);
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    return badRequest(res, "Valor invalido.");
  }

  const nextIssueDate =
    req.body.issueDate !== undefined
      ? normalizeDateValue(req.body.issueDate)
      : current.issue_date || getIssueDateFromCreatedAt(current.created_at) || getTodayDate();
  if (!nextIssueDate) {
    return badRequest(res, "Data de emissao invalida. Use YYYY-MM-DD.");
  }
  const nextPayableIssueDateError = validateIssueDateNotAfterToday(res, nextIssueDate);
  if (nextPayableIssueDateError) {
    return nextPayableIssueDateError;
  }

  const nextDueDate =
    req.body.dueDate !== undefined ? normalizeDateValue(req.body.dueDate) : current.due_date;
  if (!nextDueDate) {
    return badRequest(res, "Data de vencimento invalida. Use YYYY-MM-DD.");
  }

  const payableDueDateError = validateDueDateAgainstIssueAndToday(
    res,
    nextDueDate,
    nextIssueDate
  );
  if (payableDueDateError) {
    return payableDueDateError;
  }

  const nextStatus =
    req.body.status !== undefined
      ? normalizeStatus(req.body.status, PAYABLE_STATUS_VALUES)
      : current.status;
  if (!nextStatus) {
    return badRequest(res, "Status invalido.");
  }

  let nextPaidOn = null;
  if (nextStatus === "paid") {
    nextPaidOn =
      req.body.paidOn !== undefined
        ? normalizeDateValue(req.body.paidOn)
        : current.paid_on || getTodayDate();
    if (!nextPaidOn) {
      return badRequest(res, "Data de pagamento invalida. Use YYYY-MM-DD.");
    }

    const payableLiquidationDateError = validateLiquidationDateAgainstIssueDate(
      res,
      nextPaidOn,
      nextIssueDate
    );
    if (payableLiquidationDateError) {
      return payableLiquidationDateError;
    }
  }

  const updateTx = db.transaction(() => {
    db.prepare(
      `
      UPDATE accounts_payable
      SET
        supplier_id = ?,
        expense_type_id = ?,
        description = ?,
        amount = ?,
        issue_date = ?,
        due_date = ?,
        status = ?,
        paid_on = ?,
        notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      nextSupplierId,
      nextExpenseTypeId,
      nextDescription,
      nextAmount,
      nextIssueDate,
      nextDueDate,
      nextStatus,
      nextStatus === "paid" ? nextPaidOn : null,
      req.body.notes !== undefined ? toOptionalText(req.body.notes) : current.notes,
      accountId
    );

    syncPayableFinancialTransaction(accountId);
  });

  updateTx();
  return res.json(toPayableDto(getPayableById(accountId)));
});

router.patch("/accounts-payable/:id/status", (req, res) => {
  const accountId = Number(req.params.id);
  if (!accountId) {
    return badRequest(res, "ID de conta a pagar invalido.");
  }

  const current = getPayableById(accountId);
  if (!current) {
    return notFound(res, "Conta a pagar nao encontrada.");
  }

  const nextStatus = normalizeStatus(req.body.status, PAYABLE_STATUS_VALUES);
  if (!nextStatus) {
    return badRequest(res, "Status invalido.");
  }

  let paidOn = null;
  if (nextStatus === "paid") {
    paidOn = normalizeDateValue(req.body.paidOn) || current.paid_on || getTodayDate();
    if (!paidOn) {
      return badRequest(res, "Data de pagamento invalida. Use YYYY-MM-DD.");
    }

    const payableIssueDate =
      current.issue_date || getIssueDateFromCreatedAt(current.created_at) || getTodayDate();
    const payableLiquidationDateError = validateLiquidationDateAgainstIssueDate(
      res,
      paidOn,
      payableIssueDate
    );
    if (payableLiquidationDateError) {
      return payableLiquidationDateError;
    }
  }

  const updateTx = db.transaction(() => {
    db.prepare(
      `
      UPDATE accounts_payable
      SET status = ?, paid_on = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nextStatus, nextStatus === "paid" ? paidOn : null, accountId);

    syncPayableFinancialTransaction(accountId);
  });

  updateTx();
  return res.json(toPayableDto(getPayableById(accountId)));
});

router.get("/accounts-receivable", (req, res) => {
  const clientId = parseNullableId(req.query.clientId);
  if (req.query.clientId !== undefined && !clientId) {
    return badRequest(res, "Cliente invalido para filtro.");
  }

  const statusFilter = normalizeReceivableFilterStatus(req.query.status);
  if (req.query.status !== undefined && !statusFilter) {
    return badRequest(res, "Status invalido para filtro.");
  }

  const dateFrom = normalizeDateValue(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial invalida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateValue(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final invalida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial nao pode ser maior que a final.");
  }

  const whereConditions = [];
  const queryParams = [];
  const today = getTodayDate();

  if (clientId) {
    whereConditions.push("ar.client_id = ?");
    queryParams.push(clientId);
  }
  if (statusFilter) {
    if (statusFilter === "overdue") {
      whereConditions.push("ar.status = 'pending' AND ar.due_date < ?");
      queryParams.push(today);
    } else {
      whereConditions.push("ar.status = ?");
      queryParams.push(statusFilter);
    }
  }
  if (dateFrom) {
    whereConditions.push("ar.due_date >= ?");
    queryParams.push(dateFrom);
  }
  if (dateTo) {
    whereConditions.push("ar.due_date <= ?");
    queryParams.push(dateTo);
  }
  if (req.query.search) {
    whereConditions.push("lower(ar.description) LIKE ?");
    queryParams.push(`%${String(req.query.search).toLowerCase()}%`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(parseNumber(req.query.limit, 500), 1), 2000);

  const rows = db
    .prepare(
      `
      SELECT
        ar.id,
        ar.client_id,
        ar.description,
        ar.amount,
        ar.issue_date,
        ar.due_date,
        ar.status,
        ar.received_on,
        ar.notes,
        ar.financial_transaction_id,
        ar.created_by,
        ar.created_at,
        ar.updated_at,
        u.name AS client_name,
        cu.name AS created_by_name
      FROM accounts_receivable ar
      JOIN users u ON u.id = ar.client_id
      LEFT JOIN users cu ON cu.id = ar.created_by
      ${whereClause}
      ORDER BY ar.due_date DESC, ar.id DESC
      LIMIT ?
    `
    )
    .all(...queryParams, limit)
    .map((row) => toReceivableDto(row, today));

  return res.json(rows);
});

router.post("/accounts-receivable", (req, res) => {
  const clientId = parseNullableId(req.body.clientId);
  if (!clientId) {
    return badRequest(res, "Cliente e obrigatorio.");
  }

  const client = getClientById(clientId);
  if (!client || client.role !== "cliente") {
    return notFound(res, "Cliente nao encontrado.");
  }

  const description = String(req.body.description || "").trim();
  if (!description) {
    return badRequest(res, "Descricao e obrigatoria.");
  }

  const amount = roundMoney(parseNumber(req.body.amount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest(res, "Valor invalido.");
  }

  const dueDate = normalizeDateValue(req.body.dueDate);
  if (!dueDate) {
    return badRequest(res, "Data de vencimento invalida. Use YYYY-MM-DD.");
  }

  const rawReceivableIssueDate = req.body.issueDate;
  const receivableIssueDate =
    rawReceivableIssueDate === undefined ||
    rawReceivableIssueDate === null ||
    String(rawReceivableIssueDate).trim() === ""
      ? getTodayDate()
      : normalizeDateValue(rawReceivableIssueDate);
  if (!receivableIssueDate) {
    return badRequest(res, "Data de emissao invalida. Use YYYY-MM-DD.");
  }
  const receivableIssueDateError = validateIssueDateNotAfterToday(res, receivableIssueDate);
  if (receivableIssueDateError) {
    return receivableIssueDateError;
  }
  const receivableDueDateError = validateDueDateAgainstIssueAndToday(
    res,
    dueDate,
    receivableIssueDate
  );
  if (receivableDueDateError) {
    return receivableDueDateError;
  }

  const status = req.body.status
    ? normalizeStatus(req.body.status, RECEIVABLE_STATUS_VALUES)
    : "pending";
  if (!status) {
    return badRequest(res, "Status invalido.");
  }

  const receivedOn =
    status === "received" ? normalizeDateValue(req.body.receivedOn) || getTodayDate() : null;
  const receivableLiquidationDateError = validateLiquidationDateAgainstIssueDate(
    res,
    receivedOn,
    receivableIssueDate
  );
  if (receivableLiquidationDateError) {
    return receivableLiquidationDateError;
  }

  const createTx = db.transaction(() => {
    const accountId = db
      .prepare(
        `
        INSERT INTO accounts_receivable
          (client_id, description, amount, issue_date, due_date, status, received_on, notes, created_by)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        clientId,
        description,
        amount,
        receivableIssueDate,
        dueDate,
        status,
        receivedOn,
        toOptionalText(req.body.notes),
        req.user.id
      ).lastInsertRowid;

    syncReceivableFinancialTransaction(accountId);
    return accountId;
  });

  const accountId = createTx();
  return res.status(201).json(toReceivableDto(getReceivableById(accountId)));
});

router.patch("/accounts-receivable/:id", (req, res) => {
  const accountId = Number(req.params.id);
  if (!accountId) {
    return badRequest(res, "ID de conta a receber invalido.");
  }

  const current = getReceivableById(accountId);
  if (!current) {
    return notFound(res, "Conta a receber nao encontrada.");
  }

  const nextClientId = req.body.clientId !== undefined ? parseNullableId(req.body.clientId) : current.client_id;
  if (!nextClientId) {
    return badRequest(res, "Cliente invalido.");
  }
  const client = getClientById(nextClientId);
  if (!client || client.role !== "cliente") {
    return notFound(res, "Cliente nao encontrado.");
  }

  const nextDescription =
    req.body.description !== undefined ? String(req.body.description).trim() : current.description;
  if (!nextDescription) {
    return badRequest(res, "Descricao e obrigatoria.");
  }

  const nextAmount =
    req.body.amount !== undefined ? roundMoney(parseNumber(req.body.amount, NaN)) : roundMoney(current.amount);
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    return badRequest(res, "Valor invalido.");
  }

  const nextDueDate =
    req.body.dueDate !== undefined ? normalizeDateValue(req.body.dueDate) : current.due_date;
  if (!nextDueDate) {
    return badRequest(res, "Data de vencimento invalida. Use YYYY-MM-DD.");
  }

  const nextIssueDate =
    req.body.issueDate !== undefined
      ? normalizeDateValue(req.body.issueDate)
      : current.issue_date || getIssueDateFromCreatedAt(current.created_at) || getTodayDate();
  if (!nextIssueDate) {
    return badRequest(res, "Data de emissao invalida. Use YYYY-MM-DD.");
  }
  const nextReceivableIssueDateError = validateIssueDateNotAfterToday(res, nextIssueDate);
  if (nextReceivableIssueDateError) {
    return nextReceivableIssueDateError;
  }

  const receivableDueDateError = validateDueDateAgainstIssueAndToday(
    res,
    nextDueDate,
    nextIssueDate
  );
  if (receivableDueDateError) {
    return receivableDueDateError;
  }

  const nextStatus =
    req.body.status !== undefined
      ? normalizeStatus(req.body.status, RECEIVABLE_STATUS_VALUES)
      : current.status;
  if (!nextStatus) {
    return badRequest(res, "Status invalido.");
  }

  let nextReceivedOn = null;
  if (nextStatus === "received") {
    nextReceivedOn =
      req.body.receivedOn !== undefined
        ? normalizeDateValue(req.body.receivedOn)
        : current.received_on || getTodayDate();
    if (!nextReceivedOn) {
      return badRequest(res, "Data de recebimento invalida. Use YYYY-MM-DD.");
    }

    const receivableLiquidationDateError = validateLiquidationDateAgainstIssueDate(
      res,
      nextReceivedOn,
      nextIssueDate
    );
    if (receivableLiquidationDateError) {
      return receivableLiquidationDateError;
    }
  }

  const updateTx = db.transaction(() => {
    db.prepare(
      `
      UPDATE accounts_receivable
      SET
        client_id = ?,
        description = ?,
        amount = ?,
        issue_date = ?,
        due_date = ?,
        status = ?,
        received_on = ?,
        notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      nextClientId,
      nextDescription,
      nextAmount,
      nextIssueDate,
      nextDueDate,
      nextStatus,
      nextStatus === "received" ? nextReceivedOn : null,
      req.body.notes !== undefined ? toOptionalText(req.body.notes) : current.notes,
      accountId
    );

    syncReceivableFinancialTransaction(accountId);
  });

  updateTx();
  return res.json(toReceivableDto(getReceivableById(accountId)));
});

router.patch("/accounts-receivable/:id/status", (req, res) => {
  const accountId = Number(req.params.id);
  if (!accountId) {
    return badRequest(res, "ID de conta a receber invalido.");
  }

  const current = getReceivableById(accountId);
  if (!current) {
    return notFound(res, "Conta a receber nao encontrada.");
  }

  const nextStatus = normalizeStatus(req.body.status, RECEIVABLE_STATUS_VALUES);
  if (!nextStatus) {
    return badRequest(res, "Status invalido.");
  }

  let receivedOn = null;
  if (nextStatus === "received") {
    receivedOn = normalizeDateValue(req.body.receivedOn) || current.received_on || getTodayDate();
    if (!receivedOn) {
      return badRequest(res, "Data de recebimento invalida. Use YYYY-MM-DD.");
    }

    const receivableIssueDate =
      current.issue_date || getIssueDateFromCreatedAt(current.created_at) || getTodayDate();
    const receivableLiquidationDateError = validateLiquidationDateAgainstIssueDate(
      res,
      receivedOn,
      receivableIssueDate
    );
    if (receivableLiquidationDateError) {
      return receivableLiquidationDateError;
    }
  }

  const updateTx = db.transaction(() => {
    db.prepare(
      `
      UPDATE accounts_receivable
      SET status = ?, received_on = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nextStatus, nextStatus === "received" ? receivedOn : null, accountId);

    syncReceivableFinancialTransaction(accountId);
  });

  updateTx();
  return res.json(toReceivableDto(getReceivableById(accountId)));
});

module.exports = router;
