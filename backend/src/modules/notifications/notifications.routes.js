const express = require("express");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { forbidden, notFound } = require("../../utils/http");

const router = express.Router();

router.get("/me", authenticate, (req, res) => {
  const notifications = db
    .prepare(
      `
      SELECT *
      FROM notifications
      WHERE target_user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `
    )
    .all(req.user.id);

  return res.json(notifications);
});

router.get("/", authenticate, requireRoles("gerente"), (_req, res) => {
  const notifications = db
    .prepare(
      `
      SELECT n.*, u.name AS target_user_name
      FROM notifications n
      LEFT JOIN users u ON u.id = n.target_user_id
      ORDER BY n.created_at DESC
      LIMIT 200
    `
    )
    .all();

  return res.json(notifications);
});

router.patch("/:id/status", authenticate, (req, res) => {
  const notificationId = Number(req.params.id);
  const { status } = req.body;
  if (!["pending", "sent", "failed"].includes(status)) {
    return res.status(400).json({ message: "Status inválido." });
  }

  const notification = db
    .prepare("SELECT * FROM notifications WHERE id = ?")
    .get(notificationId);
  if (!notification) {
    return notFound(res, "Notificação não encontrada.");
  }

  if (req.user.role !== "gerente" && notification.target_user_id !== req.user.id) {
    return forbidden(res);
  }

  db.prepare("UPDATE notifications SET status = ? WHERE id = ?").run(status, notificationId);
  const updated = db.prepare("SELECT * FROM notifications WHERE id = ?").get(notificationId);
  return res.json(updated);
});

module.exports = router;
