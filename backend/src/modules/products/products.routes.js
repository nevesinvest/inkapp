const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, notFound } = require("../../utils/http");

const router = express.Router();

router.get("/", (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const sql = includeInactive
    ? `
      SELECT *
      FROM products
      ORDER BY created_at DESC
    `
    : `
      SELECT *
      FROM products
      WHERE active = 1
      ORDER BY created_at DESC
    `;

  const products = db.prepare(sql).all();
  return res.json(products);
});

router.get("/alerts/low-stock", authenticate, requireRoles("gerente"), (_req, res) => {
  const alerts = db
    .prepare(
      `
      SELECT id, name, category, stock, low_stock_threshold
      FROM products
      WHERE active = 1 AND stock <= low_stock_threshold
      ORDER BY stock ASC
    `
    )
    .all();

  return res.json(alerts);
});

router.post("/", authenticate, requireRoles("gerente"), (req, res) => {
  const { name, category, description, imageUrl, price, stock, lowStockThreshold } = req.body;
  if (!name || !category || price === undefined) {
    return badRequest(res, "Campos obrigatórios: name, category e price.");
  }

  const parsedStock = Number(stock || 0);
  const parsedLowStockThreshold = Number(lowStockThreshold || 3);
  if (parsedStock < 0 || parsedLowStockThreshold < 0) {
    return badRequest(res, "Estoque e estoque mínimo não podem ser negativos.");
  }

  const result = db
    .prepare(
      `
      INSERT INTO products (name, category, description, image_url, price, stock, low_stock_threshold, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `
    )
    .run(
      String(name).trim(),
      String(category).trim(),
      description || "",
      imageUrl || null,
      Number(price),
      parsedStock,
      parsedLowStockThreshold
    );

  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json(product);
});

router.patch("/:id", authenticate, requireRoles("gerente"), (req, res) => {
  const productId = Number(req.params.id);
  const current = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
  if (!current) {
    return notFound(res, "Produto não encontrado.");
  }

  const payload = {
    name: req.body.name ?? current.name,
    category: req.body.category ?? current.category,
    description: req.body.description ?? current.description,
    image_url: req.body.imageUrl ?? current.image_url,
    price: req.body.price ?? current.price,
    stock: req.body.stock ?? current.stock,
    low_stock_threshold: req.body.lowStockThreshold ?? current.low_stock_threshold,
    active: req.body.active ?? current.active
  };

  const nextStock = Number(payload.stock);
  const nextLowStockThreshold = Number(payload.low_stock_threshold);
  if (nextStock < 0 || nextLowStockThreshold < 0) {
    return badRequest(res, "Estoque e estoque mínimo não podem ser negativos.");
  }

  db.prepare(
    `
      UPDATE products
      SET
        name = ?,
        category = ?,
        description = ?,
        image_url = ?,
        price = ?,
        stock = ?,
        low_stock_threshold = ?,
        active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    payload.name,
    payload.category,
    payload.description,
    payload.image_url,
    Number(payload.price),
    nextStock,
    nextLowStockThreshold,
    Number(payload.active ? 1 : 0),
    productId
  );

  const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
  return res.json(updated);
});

module.exports = router;
