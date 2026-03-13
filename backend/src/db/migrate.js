const db = require("./connection");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('cliente','tatuador','gerente')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      style TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar_url TEXT,
      banner_url TEXT,
      color_code TEXT DEFAULT '#111111',
      commission_percentage REAL NOT NULL DEFAULT 0 CHECK(commission_percentage >= 0 AND commission_percentage <= 100),
      google_calendar_sync INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
      price REAL NOT NULL CHECK(price >= 0),
      deposit_amount REAL NOT NULL DEFAULT 0 CHECK(deposit_amount >= 0),
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS portfolio_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      image_url TEXT NOT NULL,
      tags TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','completed')),
      total_value REAL NOT NULL DEFAULT 0 CHECK(total_value >= 0),
      notes TEXT DEFAULT '',
      guardian_name TEXT,
      deposit_paid REAL NOT NULL DEFAULT 0 CHECK(deposit_paid >= 0),
      deposit_payment_status TEXT NOT NULL DEFAULT 'none' CHECK(deposit_payment_status IN ('none','paid','refunded')),
      cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      client_contact TEXT NOT NULL,
      client_email TEXT,
      client_whatsapp TEXT,
      description TEXT NOT NULL,
      style TEXT NOT NULL,
      body_part TEXT NOT NULL,
      size_estimate TEXT NOT NULL,
      preferred_artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
      reference_images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewing','replied','accepted','rejected')),
      response TEXT,
      response_amount REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      image_url TEXT,
      price REAL NOT NULL CHECK(price >= 0),
      cost_price REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
      sku TEXT,
      supplier TEXT,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 3 CHECK(low_stock_threshold >= 0),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      document TEXT,
      birth_date TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      address TEXT,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consumable_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'un',
      description TEXT DEFAULT '',
      current_stock REAL NOT NULL DEFAULT 0 CHECK(current_stock >= 0),
      min_stock REAL NOT NULL DEFAULT 0 CHECK(min_stock >= 0),
      cost_per_unit REAL NOT NULL DEFAULT 0 CHECK(cost_per_unit >= 0),
      supplier TEXT,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      last_purchase_on TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'corrente',
      branch TEXT,
      account_number TEXT,
      pix_key TEXT,
      initial_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
      opened_on TEXT NOT NULL,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      opening_balance REAL NOT NULL DEFAULT 0 CHECK(opening_balance >= 0),
      total_entries REAL NOT NULL DEFAULT 0 CHECK(total_entries >= 0),
      total_exits REAL NOT NULL DEFAULT 0 CHECK(total_exits >= 0),
      closed_at TEXT,
      closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      closing_balance REAL CHECK(closing_balance >= 0),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      closing_reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
      bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('entry','exit')),
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK(payment_method IN ('cash','credit_card','debit_card','pix')),
      movement_origin TEXT NOT NULL DEFAULT 'manual' CHECK(movement_origin IN ('manual','sale_close','transfer_out','transfer_in')),
      destination_bank_id INTEGER REFERENCES banks(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      description TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_type TEXT NOT NULL CHECK(person_type IN ('pf','pj')),
      document TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      mobile TEXT,
      address TEXT,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expense_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts_payable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      expense_type_id INTEGER NOT NULL REFERENCES expense_types(id) ON DELETE RESTRICT,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
      paid_on TEXT,
      notes TEXT,
      financial_transaction_id INTEGER REFERENCES financial_transactions(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts_receivable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','received','cancelled')),
      received_on TEXT,
      notes TEXT,
      financial_transaction_id INTEGER REFERENCES financial_transactions(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_number TEXT UNIQUE,
      total_amount REAL NOT NULL CHECK(total_amount >= 0),
      status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('paid','cancelled','refunded')),
      payment_method TEXT NOT NULL DEFAULT 'pix' CHECK(payment_method IN ('cash','credit_card','debit_card','pix')),
      paid_amount REAL,
      change_amount REAL NOT NULL DEFAULT 0 CHECK(change_amount >= 0),
      sale_closed INTEGER NOT NULL DEFAULT 0 CHECK(sale_closed IN (0, 1)),
      sale_closed_at TEXT,
      sale_closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sale_closed_session_id INTEGER REFERENCES cash_sessions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0)
    );

    CREATE TABLE IF NOT EXISTS artist_commission_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('entry','payment')),
      amount REAL NOT NULL CHECK(amount > 0),
      description TEXT,
      occurred_on TEXT NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 0),
      artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      description TEXT DEFAULT '',
      occurred_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_director_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      revenue_target REAL NOT NULL DEFAULT 0 CHECK(revenue_target >= 0),
      expense_limit REAL NOT NULL DEFAULT 0 CHECK(expense_limit >= 0),
      projected_margin_target REAL NOT NULL DEFAULT 0 CHECK(projected_margin_target >= 0 AND projected_margin_target <= 100),
      liquidation_rate_target REAL NOT NULL DEFAULT 0 CHECK(liquidation_rate_target >= 0 AND liquidation_rate_target <= 100),
      receivable_delinquency_limit REAL NOT NULL DEFAULT 100 CHECK(receivable_delinquency_limit >= 0 AND receivable_delinquency_limit <= 100),
      pending_coverage_target REAL NOT NULL DEFAULT 0 CHECK(pending_coverage_target >= 0),
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      message TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'app' CHECK(channel IN ('app','email','sms')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('product','consumable')),
      item_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('entry','exit','sale')),
      quantity REAL NOT NULL CHECK(quantity > 0),
      previous_stock REAL NOT NULL,
      new_stock REAL NOT NULL CHECK(new_stock >= 0),
      reason TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_artist_start ON appointments(artist_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_client_start ON appointments(client_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_blocks_artist_start ON calendar_blocks(artist_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
    CREATE INDEX IF NOT EXISTS idx_financial_type_date ON financial_transactions(type, occurred_on);
    CREATE INDEX IF NOT EXISTS idx_financial_director_targets_period ON financial_director_targets(date_from, date_to);
    CREATE INDEX IF NOT EXISTS idx_client_profiles_user ON client_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_consumables_active ON consumable_materials(active);
    CREATE INDEX IF NOT EXISTS idx_banks_active ON banks(active);
    CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);
    CREATE INDEX IF NOT EXISTS idx_expense_types_active ON expense_types(active);
    CREATE INDEX IF NOT EXISTS idx_accounts_payable_due_status ON accounts_payable(due_date, status);
    CREATE INDEX IF NOT EXISTS idx_accounts_payable_supplier ON accounts_payable(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_receivable_due_status ON accounts_receivable(due_date, status);
    CREATE INDEX IF NOT EXISTS idx_accounts_receivable_client ON accounts_receivable(client_id);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_bank_status ON cash_sessions(bank_id, status, opened_on DESC);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_status_opened_on ON cash_sessions(status, opened_on);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_bank_created_at ON cash_movements(bank_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_commission_movements_artist_date ON artist_commission_movements(artist_id, occurred_on DESC);
    CREATE INDEX IF NOT EXISTS idx_commission_movements_type ON artist_commission_movements(movement_type);
    CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON app_settings(updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_director_targets_period_unique
    ON financial_director_targets(date_from, date_to);
  `);

  const existingArtistColumns = new Set(
    db.prepare("PRAGMA table_info(artists)").all().map((column) => column.name)
  );
  if (!existingArtistColumns.has("commission_percentage")) {
    db.exec(
      "ALTER TABLE artists ADD COLUMN commission_percentage REAL NOT NULL DEFAULT 0 CHECK(commission_percentage >= 0 AND commission_percentage <= 100)"
    );
  }
  db.exec(`
    UPDATE artists
    SET commission_percentage =
      CASE
        WHEN commission_percentage < 0 THEN 0
        WHEN commission_percentage > 100 THEN 100
        ELSE commission_percentage
      END
    WHERE commission_percentage IS NOT NULL
  `);

  const existingProductColumns = new Set(
    db.prepare("PRAGMA table_info(products)").all().map((column) => column.name)
  );
  if (!existingProductColumns.has("cost_price")) {
    db.exec("ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0)");
  }
  if (!existingProductColumns.has("sku")) {
    db.exec("ALTER TABLE products ADD COLUMN sku TEXT");
  }
  if (!existingProductColumns.has("supplier")) {
    db.exec("ALTER TABLE products ADD COLUMN supplier TEXT");
  }
  if (!existingProductColumns.has("supplier_id")) {
    db.exec("ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL");
  }

  const existingQuoteColumns = new Set(
    db.prepare("PRAGMA table_info(quotes)").all().map((column) => column.name)
  );
  if (!existingQuoteColumns.has("client_email")) {
    db.exec("ALTER TABLE quotes ADD COLUMN client_email TEXT");
  }
  if (!existingQuoteColumns.has("client_whatsapp")) {
    db.exec("ALTER TABLE quotes ADD COLUMN client_whatsapp TEXT");
  }
  if (!existingQuoteColumns.has("response_amount")) {
    db.exec("ALTER TABLE quotes ADD COLUMN response_amount REAL");
  }

  const existingClientProfileColumns = new Set(
    db.prepare("PRAGMA table_info(client_profiles)").all().map((column) => column.name)
  );
  if (!existingClientProfileColumns.has("neighborhood")) {
    db.exec("ALTER TABLE client_profiles ADD COLUMN neighborhood TEXT");
  }
  if (!existingClientProfileColumns.has("city")) {
    db.exec("ALTER TABLE client_profiles ADD COLUMN city TEXT");
  }
  if (!existingClientProfileColumns.has("state")) {
    db.exec("ALTER TABLE client_profiles ADD COLUMN state TEXT");
  }
  if (!existingClientProfileColumns.has("postal_code")) {
    db.exec("ALTER TABLE client_profiles ADD COLUMN postal_code TEXT");
  }

  const existingConsumableColumns = new Set(
    db.prepare("PRAGMA table_info(consumable_materials)").all().map((column) => column.name)
  );
  if (!existingConsumableColumns.has("supplier_id")) {
    db.exec(
      "ALTER TABLE consumable_materials ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL"
    );
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_consumables_supplier_id ON consumable_materials(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_type, item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
  `);

  const existingSupplierColumns = new Set(
    db.prepare("PRAGMA table_info(suppliers)").all().map((column) => column.name)
  );
  if (!existingSupplierColumns.has("person_type")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN person_type TEXT NOT NULL DEFAULT 'pf'");
  }
  if (!existingSupplierColumns.has("document")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN document TEXT NOT NULL DEFAULT ''");
  }
  if (!existingSupplierColumns.has("name")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!existingSupplierColumns.has("email")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN email TEXT");
  }
  if (!existingSupplierColumns.has("phone")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN phone TEXT");
  }
  if (!existingSupplierColumns.has("mobile")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN mobile TEXT");
  }
  if (!existingSupplierColumns.has("address")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN address TEXT");
  }
  if (!existingSupplierColumns.has("neighborhood")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN neighborhood TEXT");
  }
  if (!existingSupplierColumns.has("city")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN city TEXT");
  }
  if (!existingSupplierColumns.has("state")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN state TEXT");
  }
  if (!existingSupplierColumns.has("postal_code")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN postal_code TEXT");
  }
  if (!existingSupplierColumns.has("notes")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN notes TEXT");
  }
  if (!existingSupplierColumns.has("active")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  if (!existingSupplierColumns.has("created_at")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  }
  if (!existingSupplierColumns.has("updated_at")) {
    db.exec("ALTER TABLE suppliers ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  }

  // Normalize persisted CPF values (remove punctuation) before uniqueness checks.
  db.exec(`
    UPDATE client_profiles
    SET document = replace(replace(replace(document, '.', ''), '-', ''), ' ', '')
    WHERE document IS NOT NULL;
  `);

  const duplicateCpfRows = db
    .prepare(
      `
      SELECT document, COUNT(*) AS total
      FROM client_profiles
      WHERE document IS NOT NULL AND trim(document) <> ''
      GROUP BY document
      HAVING COUNT(*) > 1
    `
    )
    .all();

  if (duplicateCpfRows.length === 0) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_client_profiles_document_unique
      ON client_profiles(document)
      WHERE document IS NOT NULL AND trim(document) <> ''
    `);
  } else {
    console.warn(
      "Índice único de CPF não foi criado: existem CPFs duplicados em client_profiles."
    );
  }

  // Normalize persisted SKU values before uniqueness checks.
  db.exec(`
    UPDATE products
    SET sku = upper(trim(sku))
    WHERE sku IS NOT NULL;
  `);

  const duplicateSkuRows = db
    .prepare(
      `
      SELECT sku, COUNT(*) AS total
      FROM products
      WHERE sku IS NOT NULL AND trim(sku) <> ''
      GROUP BY sku
      HAVING COUNT(*) > 1
    `
    )
    .all();

  if (duplicateSkuRows.length === 0) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique
      ON products(sku)
      WHERE sku IS NOT NULL AND trim(sku) <> ''
    `);
  } else {
    console.warn(
      "Índice único de SKU não foi criado: existem SKUs duplicados em products."
    );
  }

  // Normalize persisted supplier documents (remove punctuation) before uniqueness checks.
  db.exec(`
    UPDATE suppliers
    SET document = replace(replace(replace(replace(document, '.', ''), '-', ''), '/', ''), ' ', '')
    WHERE document IS NOT NULL;
  `);

  const duplicateSupplierDocumentRows = db
    .prepare(
      `
      SELECT document, COUNT(*) AS total
      FROM suppliers
      WHERE document IS NOT NULL AND trim(document) <> ''
      GROUP BY document
      HAVING COUNT(*) > 1
    `
    )
    .all();

  if (duplicateSupplierDocumentRows.length === 0) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_document_unique
      ON suppliers(document)
      WHERE document IS NOT NULL AND trim(document) <> ''
    `);
  } else {
    console.warn(
      "Índice único de CPF/CNPJ não foi criado: existem documentos duplicados em suppliers."
    );
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_types_name_unique
    ON expense_types(name)
    WHERE name IS NOT NULL AND trim(name) <> ''
  `);

  const existingAppointmentColumns = new Set(
    db.prepare("PRAGMA table_info(appointments)").all().map((column) => column.name)
  );
  if (!existingAppointmentColumns.has("guardian_name")) {
    db.exec("ALTER TABLE appointments ADD COLUMN guardian_name TEXT");
  }
  if (!existingAppointmentColumns.has("total_value")) {
    db.exec("ALTER TABLE appointments ADD COLUMN total_value REAL NOT NULL DEFAULT 0 CHECK(total_value >= 0)");
  }

  db.exec(`
    UPDATE appointments
    SET total_value = COALESCE(
      (SELECT s.price FROM services s WHERE s.id = appointments.service_id),
      0
    )
    WHERE total_value IS NULL OR total_value <= 0;
  `);

  const existingOrderColumns = new Set(
    db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name)
  );
  if (!existingOrderColumns.has("order_number")) {
    db.exec("ALTER TABLE orders ADD COLUMN order_number TEXT");
  }
  if (!existingOrderColumns.has("payment_method")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'pix'");
  }
  if (!existingOrderColumns.has("paid_amount")) {
    db.exec("ALTER TABLE orders ADD COLUMN paid_amount REAL");
  }
  if (!existingOrderColumns.has("change_amount")) {
    db.exec("ALTER TABLE orders ADD COLUMN change_amount REAL NOT NULL DEFAULT 0");
  }
  if (!existingOrderColumns.has("sale_closed")) {
    db.exec("ALTER TABLE orders ADD COLUMN sale_closed INTEGER NOT NULL DEFAULT 0");
  }
  if (!existingOrderColumns.has("sale_closed_at")) {
    db.exec("ALTER TABLE orders ADD COLUMN sale_closed_at TEXT");
  }
  if (!existingOrderColumns.has("sale_closed_by")) {
    db.exec("ALTER TABLE orders ADD COLUMN sale_closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  }
  if (!existingOrderColumns.has("sale_closed_session_id")) {
    db.exec(
      "ALTER TABLE orders ADD COLUMN sale_closed_session_id INTEGER REFERENCES cash_sessions(id) ON DELETE SET NULL"
    );
  }

  db.exec(`
    UPDATE orders
    SET
      order_number = printf('%06d', id),
      payment_method =
        CASE
          WHEN lower(trim(COALESCE(payment_method, ''))) IN ('cash', 'credit_card', 'debit_card', 'pix')
            THEN lower(trim(payment_method))
          ELSE 'pix'
        END,
      paid_amount =
        CASE
          WHEN paid_amount IS NULL OR paid_amount <= 0 THEN total_amount
          ELSE paid_amount
        END,
      change_amount =
        CASE
          WHEN change_amount IS NULL OR change_amount < 0 THEN 0
          ELSE change_amount
        END,
      sale_closed =
        CASE
          WHEN sale_closed IS NULL OR sale_closed NOT IN (0, 1) THEN 0
          ELSE sale_closed
        END
  `);

  db.exec(`
    UPDATE orders
    SET
      sale_closed = 1,
      sale_closed_at = COALESCE(sale_closed_at, created_at)
    WHERE status <> 'paid';
  `);

  db.exec(`
    UPDATE orders
    SET
      sale_closed = 1,
      sale_closed_at = COALESCE(sale_closed_at, created_at)
    WHERE id IN (
      SELECT DISTINCT ft.order_id
      FROM financial_transactions ft
      WHERE ft.order_id IS NOT NULL
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number_unique
    ON orders(order_number)
    WHERE order_number IS NOT NULL AND trim(order_number) <> ''
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_sale_closed
    ON orders(sale_closed, created_at DESC);
  `);

  db.exec(`
    UPDATE banks
    SET account_type = lower(trim(COALESCE(account_type, 'corrente')))
    WHERE account_type IS NOT NULL;
  `);

  db.exec(`
    UPDATE cash_sessions
    SET
      opened_on = COALESCE(NULLIF(trim(opened_on), ''), substr(opened_at, 1, 10)),
      total_entries = COALESCE(total_entries, 0),
      total_exits = COALESCE(total_exits, 0),
      opening_balance = COALESCE(opening_balance, 0)
    WHERE opened_on IS NULL
       OR trim(opened_on) = ''
       OR total_entries IS NULL
       OR total_exits IS NULL
       OR opening_balance IS NULL;
  `);

  db.exec(`
    UPDATE cash_sessions
    SET
      closing_balance = COALESCE(closing_balance, opening_balance + total_entries - total_exits),
      status = 'closed',
      closed_at = COALESCE(closed_at, datetime('now')),
      closing_reason = COALESCE(closing_reason, 'auto_migration_close'),
      updated_at = datetime('now')
    WHERE status = 'open'
      AND opened_on < date('now', 'localtime');
  `);

  const existingCashMovementColumns = new Set(
    db.prepare("PRAGMA table_info(cash_movements)").all().map((column) => column.name)
  );
  if (!existingCashMovementColumns.has("payment_method")) {
    db.exec("ALTER TABLE cash_movements ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
  }
  if (!existingCashMovementColumns.has("movement_origin")) {
    db.exec("ALTER TABLE cash_movements ADD COLUMN movement_origin TEXT NOT NULL DEFAULT 'manual'");
  }
  if (!existingCashMovementColumns.has("destination_bank_id")) {
    db.exec("ALTER TABLE cash_movements ADD COLUMN destination_bank_id INTEGER REFERENCES banks(id) ON DELETE SET NULL");
  }
  if (!existingCashMovementColumns.has("order_id")) {
    db.exec("ALTER TABLE cash_movements ADD COLUMN order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL");
  }

  db.exec(`
    UPDATE cash_movements
    SET payment_method =
      CASE
        WHEN lower(trim(COALESCE(payment_method, ''))) IN ('cash', 'credit_card', 'debit_card', 'pix')
          THEN lower(trim(payment_method))
        ELSE 'cash'
      END;
  `);

  db.exec(`
    UPDATE cash_movements
    SET movement_origin =
      CASE
        WHEN lower(trim(COALESCE(movement_origin, ''))) IN ('manual', 'sale_close', 'transfer_out', 'transfer_in')
          THEN lower(trim(movement_origin))
        ELSE 'manual'
      END;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cash_movements_order_id
    ON cash_movements(order_id, created_at DESC);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cash_movements_session_payment
    ON cash_movements(session_id, payment_method, created_at DESC);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cash_movements_destination_bank
    ON cash_movements(destination_bank_id, created_at DESC);
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_order_sale_close_unique
    ON cash_movements(order_id)
    WHERE movement_origin = 'sale_close'
      AND order_id IS NOT NULL;
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_open_unique
    ON cash_sessions(bank_id)
    WHERE status = 'open';
  `);

  const existingPayableColumns = new Set(
    db.prepare("PRAGMA table_info(accounts_payable)").all().map((column) => column.name)
  );
  if (!existingPayableColumns.has("issue_date")) {
    db.exec("ALTER TABLE accounts_payable ADD COLUMN issue_date TEXT");
    db.exec("UPDATE accounts_payable SET issue_date = substr(created_at, 1, 10) WHERE issue_date IS NULL");
  }
  if (!existingPayableColumns.has("financial_transaction_id")) {
    db.exec(
      "ALTER TABLE accounts_payable ADD COLUMN financial_transaction_id INTEGER REFERENCES financial_transactions(id) ON DELETE SET NULL"
    );
  }

  const existingReceivableColumns = new Set(
    db.prepare("PRAGMA table_info(accounts_receivable)").all().map((column) => column.name)
  );
  if (!existingReceivableColumns.has("issue_date")) {
    db.exec("ALTER TABLE accounts_receivable ADD COLUMN issue_date TEXT");
    db.exec("UPDATE accounts_receivable SET issue_date = substr(created_at, 1, 10) WHERE issue_date IS NULL");
  }
  if (!existingReceivableColumns.has("financial_transaction_id")) {
    db.exec(
      "ALTER TABLE accounts_receivable ADD COLUMN financial_transaction_id INTEGER REFERENCES financial_transactions(id) ON DELETE SET NULL"
    );
  }
}

module.exports = { migrate };
