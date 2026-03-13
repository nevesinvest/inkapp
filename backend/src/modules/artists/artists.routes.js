const express = require("express");
const db = require("../../db/connection");
const { notFound } = require("../../utils/http");

const router = express.Router();

const listArtistsStmt = db.prepare(`
  SELECT
    a.id,
    a.style,
    a.bio,
    a.avatar_url,
    a.banner_url,
    a.color_code,
    a.google_calendar_sync,
    u.name,
    u.email
  FROM artists a
  JOIN users u ON u.id = a.user_id
  ORDER BY u.name ASC
`);

const getArtistStmt = db.prepare(`
  SELECT
    a.id,
    a.style,
    a.bio,
    a.avatar_url,
    a.banner_url,
    a.color_code,
    a.google_calendar_sync,
    u.name,
    u.email
  FROM artists a
  JOIN users u ON u.id = a.user_id
  WHERE a.id = ?
`);

const getPortfolioStmt = db.prepare(`
  SELECT id, title, image_url, tags, created_at
  FROM portfolio_items
  WHERE artist_id = ?
  ORDER BY created_at DESC
`);

router.get("/", (_req, res) => {
  const artists = listArtistsStmt.all();
  return res.json(artists);
});

router.get("/:id", (req, res) => {
  const artist = getArtistStmt.get(req.params.id);
  if (!artist) {
    return notFound(res, "Artista não encontrado.");
  }

  const portfolio = getPortfolioStmt.all(req.params.id).map((item) => ({
    ...item,
    tags: item.tags ? item.tags.split(",").map((value) => value.trim()) : []
  }));

  return res.json({
    ...artist,
    portfolio
  });
});

module.exports = router;
