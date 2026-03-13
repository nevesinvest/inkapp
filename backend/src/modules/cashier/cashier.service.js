const db = require("../../db/connection");
const { dayjs } = require("../../utils/date");

const PAYMENT_METHODS = ["cash", "credit_card", "debit_card", "pix"];
const PAYMENT_METHOD_LABELS = {
  cash: "Dinheiro",
  credit_card: "Cartao de credito",
  debit_card: "Cartao de debito",
  pix: "Pix"
};

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getTodayDate() {
  return dayjs().format("YYYY-MM-DD");
}

function normalizeDateFilter(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function normalizeMovementType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "entry" || normalized === "exit") return normalized;
  return null;
}

function normalizePaymentMethod(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PAYMENT_METHODS.includes(normalized) ? normalized : null;
}

function buildEmptyPaymentBalances(openingCash = 0) {
  return {
    cash: {
      opening: roundMoney(openingCash),
      entries: 0,
      exits: 0,
      balance: roundMoney(openingCash)
    },
    credit_card: {
      opening: 0,
      entries: 0,
      exits: 0,
      balance: 0
    },
    debit_card: {
      opening: 0,
      entries: 0,
      exits: 0,
      balance: 0
    },
    pix: {
      opening: 0,
      entries: 0,
      exits: 0,
      balance: 0
    }
  };
}

function getSessionCurrentBalance(session) {
  return roundMoney(
    Number(session?.opening_balance || 0) +
      Number(session?.total_entries || 0) -
      Number(session?.total_exits || 0)
  );
}

function getSessionPaymentBalances(session) {
  if (!session?.id) {
    return buildEmptyPaymentBalances(0);
  }

  const balances = buildEmptyPaymentBalances(Number(session.opening_balance || 0));
  const rows = db
    .prepare(
      `
      SELECT
        payment_method,
        COALESCE(SUM(CASE WHEN movement_type = 'entry' THEN amount ELSE 0 END), 0) AS entries_total,
        COALESCE(SUM(CASE WHEN movement_type = 'exit' THEN amount ELSE 0 END), 0) AS exits_total
      FROM cash_movements
      WHERE session_id = ?
      GROUP BY payment_method
    `
    )
    .all(session.id);

  rows.forEach((row) => {
    const paymentMethod = normalizePaymentMethod(row.payment_method) || "cash";
    balances[paymentMethod].entries = roundMoney(row.entries_total);
    balances[paymentMethod].exits = roundMoney(row.exits_total);
  });

  PAYMENT_METHODS.forEach((paymentMethod) => {
    const current = balances[paymentMethod];
    current.balance = roundMoney(current.opening + current.entries - current.exits);
  });

  return balances;
}

function getSessionPaymentMethodBalance(session, paymentMethod) {
  const normalized = normalizePaymentMethod(paymentMethod);
  if (!normalized) return null;
  const paymentBalances = getSessionPaymentBalances(session);
  return roundMoney(paymentBalances[normalized].balance);
}

function getCashBankById(bankId, includeInactive = false) {
  return db
    .prepare(
      `
      SELECT *
      FROM banks
      WHERE id = ?
        AND lower(trim(COALESCE(account_type, ''))) = 'caixa'
        ${includeInactive ? "" : "AND active = 1"}
      LIMIT 1
    `
    )
    .get(bankId);
}

function getBankById(bankId, includeInactive = false) {
  return db
    .prepare(
      `
      SELECT *
      FROM banks
      WHERE id = ?
      ${includeInactive ? "" : "AND active = 1"}
      LIMIT 1
    `
    )
    .get(bankId);
}

function getOpenSessionByBankId(bankId) {
  return db
    .prepare(
      `
      SELECT *
      FROM cash_sessions
      WHERE bank_id = ?
        AND status = 'open'
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(bankId);
}

function getCashSessionById(sessionId) {
  return db
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
      WHERE cs.id = ?
      LIMIT 1
    `
    )
    .get(sessionId);
}

function buildSessionDto(session) {
  if (!session) return null;
  const paymentBalances = getSessionPaymentBalances(session);
  const currentBalance = roundMoney(
    PAYMENT_METHODS.reduce((sum, paymentMethod) => sum + Number(paymentBalances[paymentMethod].balance || 0), 0)
  );
  return {
    ...session,
    opening_balance: roundMoney(session.opening_balance),
    total_entries: roundMoney(session.total_entries),
    total_exits: roundMoney(session.total_exits),
    closing_balance:
      session.closing_balance === null || session.closing_balance === undefined
        ? null
        : roundMoney(session.closing_balance),
    payment_balances: paymentBalances,
    current_balance: session.status === "open"
      ? currentBalance
      : roundMoney(session.closing_balance ?? currentBalance)
  };
}

function autoCloseExpiredCashSessions() {
  const today = getTodayDate();
  const openSessions = db
    .prepare(
      `
      SELECT id, bank_id, opening_balance, total_entries, total_exits
      FROM cash_sessions
      WHERE status = 'open'
        AND opened_on < ?
      ORDER BY opened_on ASC, id ASC
    `
    )
    .all(today);

  if (openSessions.length === 0) {
    return { closedCount: 0 };
  }

  const closeExpiredTx = db.transaction((sessions) => {
    const closeStmt = db.prepare(
      `
      UPDATE cash_sessions
      SET
        status = 'closed',
        closed_at = datetime('now'),
        closed_by = NULL,
        closing_balance = ?,
        closing_reason = 'auto_date_rollover',
        updated_at = datetime('now')
      WHERE id = ?
        AND status = 'open'
    `
    );
    const updateBankStmt = db.prepare(
      `
      UPDATE banks
      SET current_balance = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    );

    sessions.forEach((session) => {
      const closingBalance = getSessionCurrentBalance(session);
      closeStmt.run(closingBalance, session.id);
      updateBankStmt.run(closingBalance, session.bank_id);
    });
  });

  closeExpiredTx(openSessions);
  return { closedCount: openSessions.length };
}

module.exports = {
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
  getCashBankById,
  getBankById,
  getOpenSessionByBankId,
  getCashSessionById,
  buildSessionDto,
  autoCloseExpiredCashSessions
};
