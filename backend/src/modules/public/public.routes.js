const express = require("express");
const db = require("../../db/connection");

const router = express.Router();

router.get("/home", (_req, res) => {
  const artists = db
    .prepare(
      `
      SELECT a.id, a.style, a.avatar_url, u.name
      FROM artists a
      JOIN users u ON u.id = a.user_id
      ORDER BY u.name ASC
      LIMIT 6
    `
    )
    .all();

  const products = db
    .prepare(
      `
      SELECT id, name, category, image_url, price
      FROM products
      WHERE active = 1
      ORDER BY created_at DESC
      LIMIT 6
    `
    )
    .all();

  const testimonials = db
    .prepare(
      `
      SELECT id, client_name, message, rating, created_at
      FROM testimonials
      ORDER BY created_at DESC
      LIMIT 6
    `
    )
    .all();

  return res.json({
    hero: {
      title: "InkApp Studio",
      subtitle: "Gestão profissional para estúdios de tatuagem e piercing",
      ctaPrimary: "Agendar Sessão",
      ctaSecondary: "Ver Loja"
    },
    artists,
    products,
    testimonials
  });
});

module.exports = router;
