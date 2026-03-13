const { migrate } = require("./db/migrate");
const { seedDatabase } = require("./db/seed");

migrate();
const result = seedDatabase();

if (result.seeded) {
  console.log("Dados de seed inseridos com sucesso.");
} else {
  console.log("Seed ignorado: base já possui dados.");
}
