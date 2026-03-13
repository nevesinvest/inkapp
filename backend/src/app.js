const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { CORS_ORIGIN } = require("./config/env");

const authRoutes = require("./modules/auth/auth.routes");
const usersRoutes = require("./modules/users/users.routes");
const artistsRoutes = require("./modules/artists/artists.routes");
const appointmentsRoutes = require("./modules/appointments/appointments.routes");
const quotesRoutes = require("./modules/quotes/quotes.routes");
const productsRoutes = require("./modules/products/products.routes");
const ordersRoutes = require("./modules/orders/orders.routes");
const cashierRoutes = require("./modules/cashier/cashier.routes");
const financeRoutes = require("./modules/finance/finance.routes");
const notificationsRoutes = require("./modules/notifications/notifications.routes");
const publicRoutes = require("./modules/public/public.routes");
const registryRoutes = require("./modules/registry/registry.routes");
const commissionsRoutes = require("./modules/commissions/commissions.routes");
const settingsRoutes = require("./modules/settings/settings.routes");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN
  })
);
app.use(express.json({ limit: "12mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "inkapp-backend"
  });
});

app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/artists", artistsRoutes);
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/quotes", quotesRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/cashier", cashierRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/registry", registryRoutes);
app.use("/api/commissions", commissionsRoutes);
app.use("/api/settings", settingsRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: "Rota não encontrada." });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    message: "Erro interno do servidor."
  });
});

module.exports = app;
