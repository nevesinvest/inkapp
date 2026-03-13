const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");

const router = express.Router();

const getUserStmt = db.prepare(`
  SELECT
    u.id,
    u.name,
    u.email,
    u.phone,
    u.role,
    u.created_at,
    cp.birth_date,
    cp.document,
    COALESCE(cp.active, 1) AS client_active
  FROM users u
  LEFT JOIN client_profiles cp ON cp.user_id = u.id
  WHERE u.id = ?
`);
const getArtistByUserStmt = db.prepare(`
  SELECT id, style, bio, avatar_url, banner_url, color_code, commission_percentage, google_calendar_sync
  FROM artists
  WHERE user_id = ?
`);

router.get("/", authenticate, requireRoles("gerente"), (req, res) => {
  const role = req.query.role;
  const allowedRoles = ["cliente", "tatuador", "gerente"];
  if (role && !allowedRoles.includes(role)) {
    return res.status(400).json({ message: "Role inválida." });
  }

  const hasRoleFilter = Boolean(role);
  const users = db
    .prepare(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        cp.birth_date,
        COALESCE(cp.active, 1) AS client_active
      FROM users u
      LEFT JOIN client_profiles cp ON cp.user_id = u.id
      ${hasRoleFilter ? "WHERE u.role = ?" : ""}
      ORDER BY u.name ASC
    `
    )
    .all(...(role ? [role] : []));

  return res.json(users);
});

router.get("/me", authenticate, (req, res) => {
  const user = getUserStmt.get(req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Usuário não encontrado." });
  }

  const artist = getArtistByUserStmt.get(req.user.id);
  return res.json({
    ...user,
    clientProfile: user.role === "cliente"
      ? {
          birthDate: user.birth_date || null,
          document: user.document || null,
          active: Number(user.client_active) === 1
        }
      : null,
    artistId: artist ? artist.id : null,
    artistProfile: artist || null
  });
});

module.exports = router;
