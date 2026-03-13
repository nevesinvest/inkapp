process.env.TZ = process.env.TZ || "America/Sao_Paulo";

const { PORT } = require("./config/env");
const { migrate } = require("./db/migrate");
const { seedDatabase } = require("./db/seed");
const { autoCloseExpiredCashSessions } = require("./modules/cashier/cashier.service");

migrate();
const seedResult = seedDatabase();
if (seedResult.seeded) {
  console.log("Banco inicializado com dados de exemplo.");
}

const app = require("./app");

try {
  const result = autoCloseExpiredCashSessions();
  if (result.closedCount > 0) {
    console.log(`Caixas fechados automaticamente na inicializacao: ${result.closedCount}`);
  }
} catch (error) {
  console.error("Erro ao executar fechamento automatico de caixas:", error.message);
}

const autoCloseInterval = setInterval(() => {
  try {
    const result = autoCloseExpiredCashSessions();
    if (result.closedCount > 0) {
      console.log(`Caixas fechados automaticamente por virada de data: ${result.closedCount}`);
    }
  } catch (error) {
    console.error("Erro no fechamento automatico de caixas:", error.message);
  }
}, 60 * 1000);
autoCloseInterval.unref();

app.listen(PORT, () => {
  console.log(`InkApp backend rodando em http://localhost:${PORT}`);
});
