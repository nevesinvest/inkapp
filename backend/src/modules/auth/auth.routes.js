const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../db/connection");
const { signAccessToken } = require("../../middleware/auth");
const { badRequest } = require("../../utils/http");

const router = express.Router();

const createUserStmt = db.prepare(`
  INSERT INTO users (name, email, phone, password_hash, role)
  VALUES (?, ?, ?, ?, ?)
`);
const findUserByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
const findArtistByUserIdStmt = db.prepare("SELECT * FROM artists WHERE user_id = ?");
const createArtistStmt = db.prepare(`
  INSERT INTO artists (
    user_id,
    style,
    bio,
    avatar_url,
    banner_url,
    color_code,
    commission_percentage,
    google_calendar_sync
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, 0)
`);
const getUserByIdStmt = db.prepare(`
  SELECT id, name, email, phone, role, created_at
  FROM users
  WHERE id = ?
`);

function buildAuthPayload(user) {
  const token = signAccessToken(user);
  const artist = findArtistByUserIdStmt.get(user.id);

  return {
    token,
    user: {
      ...user,
      artistId: artist ? artist.id : null
    }
  };
}

function parseCommissionPercentage(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 0;
  }

  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null;
  }
  return parsed;
}

router.post("/register", (req, res) => {
  const { name, email, password, phone, role, style, bio, commissionPercentage } = req.body;

  if (!name || !email || !password) {
    return badRequest(res, "Campos obrigatórios: name, email e password.");
  }
  if (password.length < 6) {
    return badRequest(res, "A senha precisa ter no mínimo 6 caracteres.");
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const roleValue = role || "cliente";
  if (!["cliente", "tatuador"].includes(roleValue)) {
    return badRequest(res, "Role inválida para cadastro público.");
  }
  if (findUserByEmailStmt.get(normalizedEmail)) {
    return badRequest(res, "E-mail já cadastrado.");
  }

  const parsedCommission = parseCommissionPercentage(commissionPercentage);
  if (parsedCommission === null) {
    return badRequest(res, "Percentual de comissão deve estar entre 0 e 100.");
  }

  const userId = createUserStmt.run(
    String(name).trim(),
    normalizedEmail,
    phone || null,
    bcrypt.hashSync(password, 10),
    roleValue
  ).lastInsertRowid;

  if (roleValue === "tatuador") {
    createArtistStmt.run(
      userId,
      style || "Estilo autoral",
      bio || "",
      null,
      null,
      "#222222",
      parsedCommission
    );
  }

  const user = getUserByIdStmt.get(userId);
  return res.status(201).json(buildAuthPayload(user));
});

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return badRequest(res, "Informe e-mail e senha.");
  }

  const userRecord = findUserByEmailStmt.get(String(email).toLowerCase().trim());
  if (!userRecord) {
    return res.status(401).json({ message: "Credenciais inválidas." });
  }

  const validPassword = bcrypt.compareSync(password, userRecord.password_hash);
  if (!validPassword) {
    return res.status(401).json({ message: "Credenciais inválidas." });
  }

  const user = getUserByIdStmt.get(userRecord.id);
  return res.json(buildAuthPayload(user));
});

module.exports = router;
