const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest } = require("../../utils/http");

const router = express.Router();

const PAYMENT_METHOD_LABELS = {
  cash: "Dinheiro",
  credit_card: "Cartao de credito",
  debit_card: "Cartao de debito",
  pix: "Pix"
};

function normalizePaymentMethod(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_LABELS, normalized)
    ? normalized
    : null;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseMoney(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return NaN;
  }
  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function buildSequentialOrderNumber(orderId) {
  return String(Number(orderId || 0)).padStart(6, "0");
}

function withOrderComputedFields(order) {
  if (!order) return null;
  const paymentMethod = normalizePaymentMethod(order.payment_method) || "pix";
  const paidAmount = Number(order.paid_amount ?? order.total_amount ?? 0);
  const changeAmount = Number(order.change_amount || 0);
  const saleClosed = Number(order.sale_closed || 0) === 1;

  return {
    ...order,
    order_number: order.order_number || buildSequentialOrderNumber(order.id),
    payment_method: paymentMethod,
    payment_method_label: PAYMENT_METHOD_LABELS[paymentMethod],
    paid_amount: roundMoney(paidAmount),
    change_amount: roundMoney(changeAmount),
    sale_closed: saleClosed,
    sale_pending_cashier: order.status === "paid" && !saleClosed
  };
}

const createOrderTx = db.transaction((clientId, actorUserId, items, paymentMethod, paidAmountInput) => {
  const getClientStmt = db.prepare("SELECT id, role FROM users WHERE id = ?");
  const getProductStmt = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1");
  const insertOrderStmt = db.prepare(`
    INSERT INTO orders
      (client_id, total_amount, status, payment_method, paid_amount, change_amount)
    VALUES
      (?, ?, 'paid', ?, ?, ?)
  `);
  const updateOrderNumberStmt = db.prepare("UPDATE orders SET order_number = ? WHERE id = ?");
  const insertOrderItemStmt = db.prepare(
    "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)"
  );
  const updateStockStmt = db.prepare(
    "UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?"
  );
  const getProductByIdStmt = db.prepare("SELECT * FROM products WHERE id = ?");
  const insertStockMovementStmt = db.prepare(`
    INSERT INTO stock_movements
      (
        item_type,
        item_id,
        movement_type,
        quantity,
        previous_stock,
        new_stock,
        reason,
        reference_type,
        reference_id,
        created_by
      )
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const createNotificationStmt = db.prepare(`
    INSERT INTO notifications (type, target_user_id, message, channel, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const client = getClientStmt.get(clientId);
  if (!client || client.role !== "cliente") {
    throw new Error("Cliente nao encontrado para concluir a venda.");
  }

  let totalAmount = 0;
  const orderItems = items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const product = getProductStmt.get(Number(item.productId));
    if (!product) {
      throw new Error(`Produto ${item.productId} nao encontrado.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Quantidade invalida para produto ${product.name}.`);
    }
    if (product.stock < quantity) {
      throw new Error(`Estoque insuficiente para ${product.name}.`);
    }

    const lineTotal = roundMoney(Number(product.price || 0) * quantity);
    totalAmount = roundMoney(totalAmount + lineTotal);

    return {
      product,
      quantity,
      previousStock: Number(product.stock || 0)
    };
  });

  if (orderItems.length === 0 || totalAmount <= 0) {
    throw new Error("Nao foi possivel gerar o pedido.");
  }

  let paidAmount = totalAmount;
  if (paymentMethod === "cash") {
    if (!Number.isFinite(paidAmountInput) || paidAmountInput <= 0) {
      throw new Error("Informe o valor recebido em dinheiro.");
    }
    paidAmount = roundMoney(paidAmountInput);
    if (paidAmount < totalAmount) {
      throw new Error("Valor recebido em dinheiro nao pode ser menor que o total.");
    }
  }

  const changeAmount = paymentMethod === "cash" ? roundMoney(paidAmount - totalAmount) : 0;

  const orderId = insertOrderStmt.run(
    clientId,
    totalAmount,
    paymentMethod,
    paidAmount,
    changeAmount
  ).lastInsertRowid;
  const orderNumber = buildSequentialOrderNumber(orderId);
  updateOrderNumberStmt.run(orderNumber, orderId);

  orderItems.forEach((item) => {
    insertOrderItemStmt.run(orderId, item.product.id, item.quantity, item.product.price);
    const updateResult = updateStockStmt.run(item.quantity, item.product.id, item.quantity);
    if (updateResult.changes === 0) {
      throw new Error(`Estoque insuficiente para ${item.product.name}.`);
    }

    const updatedProduct = getProductByIdStmt.get(item.product.id);
    const updatedStock = Number(updatedProduct?.stock || 0);
    if (!updatedProduct || updatedStock < 0) {
      throw new Error(`Erro ao atualizar estoque de ${item.product.name}.`);
    }

    insertStockMovementStmt.run(
      "product",
      item.product.id,
      "sale",
      item.quantity,
      item.previousStock,
      updatedStock,
      `Venda ${orderNumber}`,
      "order",
      orderId,
      actorUserId
    );

    if (updatedProduct.stock <= updatedProduct.low_stock_threshold) {
      const managers = db.prepare("SELECT id FROM users WHERE role = 'gerente'").all();
      managers.forEach((manager) => {
        createNotificationStmt.run(
          "low_stock",
          manager.id,
          `Produto ${updatedProduct.name} atingiu estoque baixo (${updatedProduct.stock}).`,
          "app",
          "pending"
        );
      });
    }
  });

  return orderId;
});

router.post("/", authenticate, requireRoles("cliente", "gerente"), (req, res) => {
  const { items, clientId, paymentMethod, paidAmount } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return badRequest(res, "Informe ao menos um item para o pedido.");
  }

  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod || "pix");
  if (!normalizedPaymentMethod) {
    return badRequest(
      res,
      "Forma de pagamento invalida. Use: Dinheiro, Cartao de credito, Cartao de debito ou Pix."
    );
  }

  const resolvedClientId = req.user.role === "cliente" ? req.user.id : Number(clientId);
  if (!resolvedClientId) {
    return badRequest(res, "clientId e obrigatorio para o gerente.");
  }

  const parsedPaidAmount = parseMoney(paidAmount);
  if (normalizedPaymentMethod === "cash" && !Number.isFinite(parsedPaidAmount)) {
    return badRequest(res, "Informe o valor recebido em dinheiro.");
  }

  try {
    const orderId = createOrderTx(
      resolvedClientId,
      req.user.id,
      items,
      normalizedPaymentMethod,
      parsedPaidAmount
    );
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    const orderItems = db
      .prepare(
        `
        SELECT oi.*, p.name AS product_name, p.category
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?
      `
      )
      .all(orderId);

    return res.status(201).json({
      ...withOrderComputedFields(order),
      items: orderItems
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

router.get("/me", authenticate, requireRoles("cliente"), (req, res) => {
  const orders = db
    .prepare(
      `
      SELECT
        id,
        order_number,
        total_amount,
        status,
        payment_method,
        paid_amount,
        change_amount,
        sale_closed,
        sale_closed_at,
        created_at
      FROM orders
      WHERE client_id = ?
      ORDER BY created_at DESC
    `
    )
    .all(req.user.id)
    .map((order) => ({
      ...withOrderComputedFields(order),
      items: db
        .prepare(
          `
          SELECT oi.id, oi.quantity, oi.unit_price, p.name AS product_name, p.category
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ?
        `
        )
        .all(order.id)
    }));

  return res.json(orders);
});

router.get("/", authenticate, requireRoles("gerente"), (_req, res) => {
  const orders = db
    .prepare(
      `
      SELECT
        o.id,
        o.order_number,
        o.total_amount,
        o.status,
        o.payment_method,
        o.paid_amount,
        o.change_amount,
        o.sale_closed,
        o.sale_closed_at,
        o.created_at,
        u.name AS client_name
      FROM orders o
      JOIN users u ON u.id = o.client_id
      ORDER BY o.created_at DESC
    `
    )
    .all()
    .map((order) => withOrderComputedFields(order));

  return res.json(orders);
});

module.exports = router;
