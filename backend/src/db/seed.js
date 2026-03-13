const bcrypt = require("bcryptjs");
const dayjs = require("dayjs");
const db = require("./connection");

function seedDatabase() {
  const totalUsers = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (totalUsers > 0) {
    return { seeded: false };
  }

  const hash = bcrypt.hashSync("123456", 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `);

  const managerId = insertUser.run(
    "Gerente InkApp",
    "gerente@inkapp.local",
    "11999990001",
    hash,
    "gerente"
  ).lastInsertRowid;

  const tattooer1UserId = insertUser.run(
    "Luna Black",
    "luna@inkapp.local",
    "11999990002",
    hash,
    "tatuador"
  ).lastInsertRowid;
  const tattooer2UserId = insertUser.run(
    "Rafa Dotwork",
    "rafa@inkapp.local",
    "11999990003",
    hash,
    "tatuador"
  ).lastInsertRowid;
  const clientId = insertUser.run(
    "Cliente Demo",
    "cliente@inkapp.local",
    "11999990004",
    hash,
    "cliente"
  ).lastInsertRowid;

  db.prepare(
    `
      INSERT INTO client_profiles
        (
          user_id,
          document,
          birth_date,
          emergency_contact,
          emergency_phone,
          address,
          neighborhood,
          city,
          state,
          postal_code,
          notes,
          active
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `
  ).run(
    clientId,
    "12345678909",
    "1994-04-12",
    "Ana Demo",
    "11988887777",
    "Rua Exemplo, 100 - Sao Paulo/SP",
    "Centro",
    "Sao Paulo",
    "SP",
    "01001000",
    "Cliente com preferencia por sessoes aos sabados."
  );

  const insertArtist = db.prepare(`
    INSERT INTO artists (user_id, style, bio, avatar_url, banner_url, color_code, google_calendar_sync)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const artist1Id = insertArtist.run(
    tattooer1UserId,
    "Blackwork / Fine Line",
    "Especialista em composicoes em preto e cinza com alto contraste.",
    "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1565058379802-bbe93b2f703a?auto=format&fit=crop&w=1400&q=80",
    "#1a1a1a",
    1
  ).lastInsertRowid;

  const artist2Id = insertArtist.run(
    tattooer2UserId,
    "Pontilhismo / Geometrico",
    "Trabalhos autorais em pontilhismo, geometria e simetria.",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1510915228340-29c85a43dcfe?auto=format&fit=crop&w=1400&q=80",
    "#2d2d2d",
    0
  ).lastInsertRowid;

  const insertService = db.prepare(`
    INSERT INTO services (name, description, duration_minutes, price, deposit_amount, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const serviceSmall = insertService.run(
    "Tatuagem Pequena",
    "Peca pequena com execucao em ate 1h30.",
    90,
    350,
    100
  ).lastInsertRowid;
  const serviceSession = insertService.run(
    "Sessao de 4 horas",
    "Sessao extensa para projetos autorais ou continuidade.",
    240,
    1200,
    300
  ).lastInsertRowid;
  insertService.run(
    "Piercing + Joia Basica",
    "Aplicação de piercing com joia de titânio básica.",
    45,
    220,
    70
  );

  const insertPortfolio = db.prepare(`
    INSERT INTO portfolio_items (artist_id, title, image_url, tags)
    VALUES (?, ?, ?, ?)
  `);

  insertPortfolio.run(
    artist1Id,
    "Rosa Blackwork",
    "https://images.unsplash.com/photo-1542728928-1413d1894ed1?auto=format&fit=crop&w=900&q=80",
    "blackwork,rosa"
  );
  insertPortfolio.run(
    artist1Id,
    "Serpente Ornamental",
    "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    "ornamental,black"
  );
  insertPortfolio.run(
    artist2Id,
    "Mandala Dotwork",
    "https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=900&q=80",
    "dotwork,mandala"
  );
  insertPortfolio.run(
    artist2Id,
    "Geometria Sagrada",
    "https://images.unsplash.com/photo-1514329926535-7f6db2f6b9d9?auto=format&fit=crop&w=900&q=80",
    "geometrico,dotwork"
  );

  const insertProduct = db.prepare(`
    INSERT INTO products
      (name, category, description, image_url, price, cost_price, sku, supplier, stock, low_stock_threshold, active)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  insertProduct.run(
    "Pomada Cicatrizante InkCare",
    "Pomadas Cicatrizantes",
    "Pomada pós-tatuagem para hidratação e recuperação da pele.",
    "https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=900&q=80",
    39.9,
    14.9,
    "POM-INK-001",
    "InkCare Labs",
    20,
    5
  );
  insertProduct.run(
    "Camiseta InkApp Preto",
    "Roupas e Acessorios",
    "Camiseta oversized com estampa exclusiva do estudio.",
    "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    89.9,
    38,
    "CAM-INK-001",
    "Textil Studio Supply",
    12,
    3
  );
  insertProduct.run(
    "Print A3 - Corvo",
    "Prints e Arte dos Tatuadores",
    "Print em papel algodao assinado por Luna Black.",
    "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=80",
    120,
    42,
    "PRT-LUNA-001",
    "Atelie Luna Black",
    4,
    2
  );

  const insertConsumable = db.prepare(`
    INSERT INTO consumable_materials
      (name, category, unit, description, current_stock, min_stock, cost_per_unit, supplier, last_purchase_on, active)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  insertConsumable.run(
    "Luva Nitrilica Preta",
    "EPI",
    "caixa",
    "Caixa com 100 unidades tamanho M.",
    18,
    6,
    32.5,
    "Medical Tattoo Supply",
    dayjs().subtract(10, "day").format("YYYY-MM-DD")
  );
  insertConsumable.run(
    "Filme Protetor Derm",
    "Pos-procedimento",
    "rolo",
    "Filme para protecao inicial de tatuagem.",
    9,
    3,
    44,
    "InkSafe",
    dayjs().subtract(6, "day").format("YYYY-MM-DD")
  );
  insertConsumable.run(
    "Vaselina Solida",
    "Procedimento",
    "pote",
    "Auxilio de deslize durante sessao.",
    5,
    2,
    18.9,
    "CarePro",
    dayjs().subtract(13, "day").format("YYYY-MM-DD")
  );

  const insertBank = db.prepare(`
    INSERT INTO banks
      (bank_name, account_name, account_type, branch, account_number, pix_key, initial_balance, current_balance, notes, active)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  insertBank.run(
    "Banco do Brasil",
    "InkApp Studio LTDA",
    "corrente",
    "1234-5",
    "98765-4",
    "financeiro@inkapp.local",
    15000,
    15000,
    "Conta principal para recebimento de sessoes."
  );
  insertBank.run(
    "Nubank",
    "InkApp Studio LTDA",
    "pagamento",
    "",
    "00011122-3",
    "11.111.111/0001-99",
    6000,
    6000,
    "Conta para despesas operacionais."
  );
  insertBank.run(
    "Caixa Interno",
    "Caixa Loja",
    "caixa",
    "",
    "",
    "",
    1500,
    1500,
    "Caixa fisico para movimentacao diaria."
  );

  const insertExpenseType = db.prepare(`
    INSERT INTO expense_types (name, description, active)
    VALUES (?, ?, 1)
  `);

  insertExpenseType.run("Aluguel", "Despesas de locacao do estúdio.");
  insertExpenseType.run("Insumos", "Compra de materiais de consumo e reposicao.");
  insertExpenseType.run("Marketing", "Investimento em divulgacao e campanhas.");
  insertExpenseType.run("Servicos", "Servicos administrativos e operacionais.");

  const insertTestimonial = db.prepare(`
    INSERT INTO testimonials (client_name, message, rating)
    VALUES (?, ?, ?)
  `);

  insertTestimonial.run(
    "Marina S.",
    "Atendimento impecavel e resultado acima do esperado. Voltarei para fechar o braco.",
    5
  );
  insertTestimonial.run(
    "Joao C.",
    "Processo de agendamento pratico e artista muito atencioso.",
    5
  );
  insertTestimonial.run(
    "Leticia R.",
    "Ambiente profissional e pos-atendimento excelente.",
    4
  );

  const tomorrowStart = dayjs().add(1, "day").hour(10).minute(0).second(0).millisecond(0);
  const tomorrowEnd = tomorrowStart.add(90, "minute");
  const nextWeekStart = dayjs().add(7, "day").hour(14).minute(0).second(0).millisecond(0);
  const nextWeekEnd = nextWeekStart.add(240, "minute");

  const insertAppointment = db.prepare(`
    INSERT INTO appointments
      (client_id, artist_id, service_id, start_at, end_at, status, notes, deposit_paid, deposit_payment_status, cancel_reason)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const appt1Id = insertAppointment.run(
    clientId,
    artist1Id,
    serviceSmall,
    tomorrowStart.toISOString(),
    tomorrowEnd.toISOString(),
    "confirmed",
    "Primeira tatuagem no antebraco.",
    100,
    "paid",
    null
  ).lastInsertRowid;

  const appt2Id = insertAppointment.run(
    clientId,
    artist2Id,
    serviceSession,
    nextWeekStart.toISOString(),
    nextWeekEnd.toISOString(),
    "pending",
    "Projeto geometrico para panturrilha.",
    0,
    "none",
    null
  ).lastInsertRowid;

  const insertFinancial = db.prepare(`
    INSERT INTO financial_transactions
      (type, category, amount, artist_id, appointment_id, order_id, description, occurred_on)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const today = dayjs().format("YYYY-MM-DD");
  insertFinancial.run(
    "income",
    "sinal agendamento",
    100,
    artist1Id,
    appt1Id,
    null,
    "Sinal recebido no agendamento inicial",
    today
  );
  insertFinancial.run(
    "expense",
    "material",
    280,
    null,
    null,
    null,
    "Compra de insumos estereis",
    today
  );
  insertFinancial.run(
    "income",
    "sessao concluida",
    1200,
    artist2Id,
    appt2Id,
    null,
    "Receita de sessao avancada",
    dayjs().subtract(2, "day").format("YYYY-MM-DD")
  );

  const insertNotification = db.prepare(`
    INSERT INTO notifications (type, target_user_id, message, channel, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertNotification.run(
    "appointment_confirmation",
    clientId,
    "Seu agendamento com Luna Black foi confirmado para amanhã às 10:00.",
    "email",
    "sent"
  );
  insertNotification.run(
    "quote_new",
    managerId,
    "Novo pedido de orcamento aguardando analise.",
    "app",
    "pending"
  );

  return { seeded: true };
}

module.exports = { seedDatabase };
