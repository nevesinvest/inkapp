const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../db/connection");
const { authenticate, requireRoles } = require("../../middleware/auth");
const { badRequest, forbidden, notFound } = require("../../utils/http");
const {
  STOCK_ITEM_TYPES,
  STOCK_MOVEMENT_TYPES,
  applyStockMovement
} = require("../stock/stock.utils");
const {
  BRAZIL_BANK_CATALOG_METADATA,
  BRAZIL_BANK_OPTIONS,
  resolveBank
} = require("../../data/brazilBanks");

const router = express.Router();
router.use(
  authenticate,
  requireRoles("gerente", "tatuador"),
  (req, res, next) => {
    // Tatuador pode acessar apenas os endpoints de clientes
    if (req.user?.role === "tatuador" && !req.path.startsWith("/clients")) {
      return forbidden(res);
    }
    return next();
  }
);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  if (typeof value === "number") return value === 1;
  return fallback;
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCpf(value) {
  return onlyDigits(value).slice(0, 11);
}

function normalizeCnpj(value) {
  return onlyDigits(value).slice(0, 14);
}

function normalizePhone(value) {
  const digits = onlyDigits(value);
  return digits ? digits.slice(0, 11) : null;
}

function normalizeLandlinePhone(value) {
  const digits = onlyDigits(value);
  return digits ? digits.slice(0, 10) : null;
}

function normalizeCep(value) {
  const digits = onlyDigits(value);
  return digits ? digits.slice(0, 8) : null;
}

function normalizeSku(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function serializeBankRow(row) {
  if (!row) return row;
  const selectedBank = resolveBank({ bankName: row.bank_name });
  return {
    ...row,
    bank_name: selectedBank?.label || row.bank_name,
    bank_code: selectedBank?.code || null
  };
}

function isValidCpf(cpf) {
  const value = normalizeCpf(cpf);
  if (!value || value.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(value)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(value[i]) * (10 - i);
  }
  let firstDigit = (sum * 10) % 11;
  if (firstDigit === 10) firstDigit = 0;
  if (firstDigit !== Number(value[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(value[i]) * (11 - i);
  }
  let secondDigit = (sum * 10) % 11;
  if (secondDigit === 10) secondDigit = 0;
  return secondDigit === Number(value[10]);
}

function isValidCnpj(cnpj) {
  const value = normalizeCnpj(cnpj);
  if (!value || value.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(value)) return false;

  const calculateDigit = (base, weights) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += Number(base[i]) * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstDigit !== Number(value[12])) return false;

  const secondDigit = calculateDigit(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondDigit === Number(value[13]);
}

function normalizeSupplierDocument(personType, value) {
  return personType === "pj" ? normalizeCnpj(value) : normalizeCpf(value);
}

function isValidSupplierDocument(personType, value) {
  return personType === "pj" ? isValidCnpj(value) : isValidCpf(value);
}

function getClientByCpf(cpf, excludeUserId = null) {
  const normalizedCpf = normalizeCpf(cpf);
  if (!normalizedCpf) return null;

  if (excludeUserId) {
    return db
      .prepare(
        `
        SELECT u.id, u.name, cp.document AS cpf
        FROM client_profiles cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.document = ? AND u.role = 'cliente' AND u.id <> ?
      `
      )
      .get(normalizedCpf, excludeUserId);
  }

  return db
    .prepare(
      `
      SELECT u.id, u.name, cp.document AS cpf
      FROM client_profiles cp
      JOIN users u ON u.id = cp.user_id
      WHERE cp.document = ? AND u.role = 'cliente'
    `
    )
    .get(normalizedCpf);
}

function getClientById(clientId) {
  return db
    .prepare(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        cp.document AS cpf,
        cp.birth_date,
        cp.emergency_contact,
        cp.emergency_phone,
        cp.address,
        cp.neighborhood,
        cp.city,
        cp.state,
        cp.postal_code,
        cp.notes,
        COALESCE(cp.active, 1) AS active
      FROM users u
      LEFT JOIN client_profiles cp ON cp.user_id = u.id
      WHERE u.id = ? AND u.role = 'cliente'
    `
    )
    .get(clientId);
}

function getClientAppointmentsCount(clientId) {
  return (
    db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM appointments
        WHERE client_id = ?
      `
      )
      .get(clientId)?.total || 0
  );
}

function getClientHistory(clientId) {
  return db
    .prepare(
      `
      SELECT
        ap.id,
        ap.start_at,
        ap.end_at,
        ap.status,
        ap.total_value,
        s.name AS service_name,
        au.name AS artist_name
      FROM appointments ap
      JOIN services s ON s.id = ap.service_id
      JOIN artists a ON a.id = ap.artist_id
      JOIN users au ON au.id = a.user_id
      WHERE ap.client_id = ?
      ORDER BY datetime(ap.start_at) DESC, ap.id DESC
    `
    )
    .all(clientId);
}

function getSupplierByDocument(document, excludeSupplierId = null) {
  if (!document) return null;

  if (excludeSupplierId) {
    return db
      .prepare(
        `
        SELECT id, name, person_type, document
        FROM suppliers
        WHERE document = ? AND id <> ?
      `
      )
      .get(document, excludeSupplierId);
  }

  return db
    .prepare(
      `
      SELECT id, name, person_type, document
      FROM suppliers
      WHERE document = ?
    `
    )
    .get(document);
}

function getSupplierById(supplierId) {
  return db
    .prepare(
      `
      SELECT
        id,
        person_type,
        document,
        name,
        email,
        phone,
        mobile,
        address,
        neighborhood,
        city,
        state,
        postal_code,
        notes,
        active,
        created_at,
        updated_at
      FROM suppliers
      WHERE id = ?
    `
    )
    .get(supplierId);
}

function getExpenseTypeById(expenseTypeId) {
  return db
    .prepare(
      `
      SELECT
        id,
        name,
        description,
        active,
        created_at,
        updated_at
      FROM expense_types
      WHERE id = ?
    `
    )
    .get(expenseTypeId);
}

function getExpenseTypeByName(name, excludeExpenseTypeId = null) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;

  if (excludeExpenseTypeId) {
    return db
      .prepare(
        `
        SELECT id, name
        FROM expense_types
        WHERE lower(trim(name)) = lower(trim(?))
          AND id <> ?
      `
      )
      .get(normalizedName, excludeExpenseTypeId);
  }

  return db
    .prepare(
      `
      SELECT id, name
      FROM expense_types
      WHERE lower(trim(name)) = lower(trim(?))
    `
    )
    .get(normalizedName);
}

function getSaleProductBySku(sku, excludeProductId = null) {
  const normalizedSku = normalizeSku(sku);
  if (!normalizedSku) return null;

  if (excludeProductId) {
    return db
      .prepare(
        `
        SELECT id, name, sku
        FROM products
        WHERE sku = ? AND id <> ?
      `
      )
      .get(normalizedSku, excludeProductId);
  }

  return db
    .prepare(
      `
      SELECT id, name, sku
      FROM products
      WHERE sku = ?
    `
    )
    .get(normalizedSku);
}

function getSaleProductById(productId) {
  return db
    .prepare(
      `
      SELECT
        p.*,
        p.supplier_id,
        COALESCE(s.name, p.supplier) AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?
    `
    )
    .get(productId);
}

function getConsumableById(itemId) {
  return db
    .prepare(
      `
      SELECT
        c.*,
        c.supplier_id,
        COALESCE(s.name, c.supplier) AS supplier_name
      FROM consumable_materials c
      LEFT JOIN suppliers s ON s.id = c.supplier_id
      WHERE c.id = ?
    `
    )
    .get(itemId);
}

function buildGeneratedProductSku(productId) {
  return `PRD-${String(productId).padStart(6, "0")}`;
}

function normalizeStockItemType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === STOCK_ITEM_TYPES.PRODUCT || normalized === STOCK_ITEM_TYPES.CONSUMABLE) {
    return normalized;
  }
  return null;
}

function normalizeStockMovementType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (Object.values(STOCK_MOVEMENT_TYPES).includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeDateFilter(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function getStockMovementById(movementId) {
  return db
    .prepare(
      `
      SELECT
        sm.id,
        sm.item_type,
        sm.item_id,
        sm.movement_type,
        sm.quantity,
        sm.previous_stock,
        sm.new_stock,
        sm.reason,
        sm.reference_type,
        sm.reference_id,
        sm.created_at,
        u.name AS created_by_name,
        COALESCE(p.name, c.name) AS item_name,
        p.sku AS item_sku,
        c.unit AS item_unit
      FROM stock_movements sm
      LEFT JOIN users u ON u.id = sm.created_by
      LEFT JOIN products p ON sm.item_type = 'product' AND p.id = sm.item_id
      LEFT JOIN consumable_materials c ON sm.item_type = 'consumable' AND c.id = sm.item_id
      WHERE sm.id = ?
    `
    )
    .get(movementId);
}

router.get("/clients", (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const whereActive = includeInactive ? "" : " AND COALESCE(cp.active, 1) = 1";

  const clients = db
    .prepare(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        cp.document AS cpf,
        cp.birth_date,
        cp.emergency_contact,
        cp.emergency_phone,
        cp.address,
        cp.neighborhood,
        cp.city,
        cp.state,
        cp.postal_code,
        cp.notes,
        COALESCE(cp.active, 1) AS active
      FROM users u
      LEFT JOIN client_profiles cp ON cp.user_id = u.id
      WHERE u.role = 'cliente'
      ${whereActive}
      ORDER BY u.name ASC
    `
    )
    .all();

  return res.json(clients);
});

router.get("/clients/check-cpf", (req, res) => {
  const normalizedCpf = normalizeCpf(req.query.cpf);
  const excludeId = Number(req.query.excludeId || 0);

  if (!normalizedCpf || normalizedCpf.length !== 11) {
    return badRequest(res, "Informe CPF válido para consulta.");
  }

  const existing = getClientByCpf(normalizedCpf, excludeId || null);
  return res.json({
    exists: Boolean(existing),
    client: existing || null
  });
});

router.post("/clients", (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    cpf,
    birthDate,
    emergencyContact,
    emergencyPhone,
    address,
    neighborhood,
    city,
    state,
    postalCode,
    notes,
    active
  } = req.body;

  if (!name || !email || !cpf) {
    return badRequest(res, "Campos obrigatórios: cpf, name e email.");
  }

  const normalizedCpf = normalizeCpf(cpf);
  if (!isValidCpf(normalizedCpf)) {
    return badRequest(res, "CPF inválido.");
  }

  const cpfAlreadyExists = getClientByCpf(normalizedCpf);
  if (cpfAlreadyExists) {
    return badRequest(res, `CPF já cadastrado para ${cpfAlreadyExists.name}.`);
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const alreadyExists = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalizedEmail);
  if (alreadyExists) {
    return badRequest(res, "Já existe cliente com este e-mail.");
  }

  const userId = db
    .prepare(
      `
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES (?, ?, ?, ?, 'cliente')
    `
    )
    .run(
      String(name).trim(),
      normalizedEmail,
      normalizePhone(phone),
      bcrypt.hashSync(password || "123456", 10)
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
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    userId,
    normalizedCpf,
    birthDate || null,
    emergencyContact || null,
    emergencyPhone || null,
    address || null,
    neighborhood || null,
    city || null,
    state || null,
    normalizeCep(postalCode),
    notes || null,
    parseBoolean(active, true) ? 1 : 0
  );

  return res.status(201).json(getClientById(userId));
});

router.patch("/clients/:id", (req, res) => {
  const clientId = Number(req.params.id);
  if (!clientId) {
    return badRequest(res, "ID de cliente inválido.");
  }

  const currentClient = getClientById(clientId);
  if (!currentClient) {
    return notFound(res, "Cliente não encontrado.");
  }

  const nextEmail = req.body.email
    ? String(req.body.email).trim().toLowerCase()
    : currentClient.email;

  if (req.body.cpf !== undefined) {
    const incomingCpf = normalizeCpf(req.body.cpf);
    if (incomingCpf !== currentClient.cpf) {
      return badRequest(res, "CPF não pode ser alterado.");
    }
  }

  const nextCpf = currentClient.cpf;

  if (nextEmail !== currentClient.email) {
    const alreadyExists = db.prepare("SELECT id FROM users WHERE email = ?").get(nextEmail);
    if (alreadyExists && alreadyExists.id !== clientId) {
      return badRequest(res, "Já existe cliente com este e-mail.");
    }
  }

  if (!nextCpf || !isValidCpf(nextCpf)) {
    return badRequest(res, "CPF inválido.");
  }
  const cpfAlreadyExists = getClientByCpf(nextCpf, clientId);
  if (cpfAlreadyExists) {
    return badRequest(res, `CPF já cadastrado para ${cpfAlreadyExists.name}.`);
  }

  db.prepare(
    `
      UPDATE users
      SET name = ?, email = ?, phone = ?
      WHERE id = ? AND role = 'cliente'
    `
  ).run(
    req.body.name ? String(req.body.name).trim() : currentClient.name,
    nextEmail,
    req.body.phone !== undefined ? normalizePhone(req.body.phone) : currentClient.phone,
    clientId
  );

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
          active,
          updated_at
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        document = excluded.document,
        birth_date = excluded.birth_date,
        emergency_contact = excluded.emergency_contact,
        emergency_phone = excluded.emergency_phone,
        address = excluded.address,
        neighborhood = excluded.neighborhood,
        city = excluded.city,
        state = excluded.state,
        postal_code = excluded.postal_code,
        notes = excluded.notes,
        active = excluded.active,
        updated_at = datetime('now')
    `
  ).run(
    clientId,
    nextCpf,
    req.body.birthDate !== undefined ? req.body.birthDate : currentClient.birth_date,
    req.body.emergencyContact !== undefined
      ? req.body.emergencyContact
      : currentClient.emergency_contact,
    req.body.emergencyPhone !== undefined
      ? req.body.emergencyPhone
      : currentClient.emergency_phone,
    req.body.address !== undefined ? req.body.address : currentClient.address,
    req.body.neighborhood !== undefined ? req.body.neighborhood : currentClient.neighborhood,
    req.body.city !== undefined ? req.body.city : currentClient.city,
    req.body.state !== undefined ? req.body.state : currentClient.state,
    req.body.postalCode !== undefined ? normalizeCep(req.body.postalCode) : currentClient.postal_code,
    req.body.notes !== undefined ? req.body.notes : currentClient.notes,
    req.body.active !== undefined ? (parseBoolean(req.body.active, true) ? 1 : 0) : currentClient.active
  );

  return res.json(getClientById(clientId));
});

router.get("/clients/:id/history", (req, res) => {
  const clientId = Number(req.params.id);
  if (!clientId) {
    return badRequest(res, "ID de cliente invalido.");
  }

  const client = getClientById(clientId);
  if (!client) {
    return notFound(res, "Cliente nao encontrado.");
  }

  return res.json({
    client: {
      id: client.id,
      name: client.name
    },
    history: getClientHistory(clientId)
  });
});

router.delete("/clients/:id", (req, res) => {
  const clientId = Number(req.params.id);
  if (!clientId) {
    return badRequest(res, "ID de cliente invalido.");
  }

  const currentClient = getClientById(clientId);
  if (!currentClient) {
    return notFound(res, "Cliente nao encontrado.");
  }

  const appointmentsCount = getClientAppointmentsCount(clientId);
  if (appointmentsCount > 0) {
    return res.status(409).json({
      code: "client_has_appointments",
      message: "Cliente nao pode ser excluido pois possui agendamentos.",
      appointmentsCount
    });
  }

  try {
    const result = db
      .prepare("DELETE FROM users WHERE id = ? AND role = 'cliente'")
      .run(clientId);

    if (!result.changes) {
      return notFound(res, "Cliente nao encontrado.");
    }

    return res.json({
      deleted: true,
      id: clientId
    });
  } catch (error) {
    if (String(error.message || "").includes("FOREIGN KEY constraint failed")) {
      return res.status(409).json({
        code: "client_has_related_records",
        message: "Cliente nao pode ser excluido pois possui registros vinculados."
      });
    }

    return res.status(500).json({
      message: "Nao foi possivel excluir o cliente."
    });
  }
});

router.get("/suppliers", (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const whereClause = includeInactive ? "" : "WHERE active = 1";

  const suppliers = db
    .prepare(
      `
      SELECT
        id,
        person_type,
        document,
        name,
        email,
        phone,
        mobile,
        address,
        neighborhood,
        city,
        state,
        postal_code,
        notes,
        active,
        created_at,
        updated_at
      FROM suppliers
      ${whereClause}
      ORDER BY name ASC
    `
    )
    .all();

  return res.json(suppliers);
});

router.get("/suppliers/check-document", (req, res) => {
  const personType = String(req.query.personType || "").toLowerCase();
  if (!["pf", "pj"].includes(personType)) {
    return badRequest(res, "Tipo de pessoa inválido. Use pf ou pj.");
  }

  const normalizedDocument = normalizeSupplierDocument(personType, req.query.document);
  const expectedLabel = personType === "pj" ? "CNPJ" : "CPF";
  if (!isValidSupplierDocument(personType, normalizedDocument)) {
    return badRequest(res, `Informe ${expectedLabel} válido para consulta.`);
  }

  const excludeId = Number(req.query.excludeId || 0);
  const existing = getSupplierByDocument(normalizedDocument, excludeId || null);

  return res.json({
    exists: Boolean(existing),
    supplier: existing || null
  });
});

router.post("/suppliers", (req, res) => {
  const {
    personType,
    document,
    name,
    email,
    phone,
    mobile,
    address,
    neighborhood,
    city,
    state,
    postalCode,
    notes,
    active
  } = req.body;

  const normalizedPersonType = String(personType || "").toLowerCase();
  if (!["pf", "pj"].includes(normalizedPersonType)) {
    return badRequest(res, "Campos obrigatórios: personType, document e name.");
  }
  if (!name || !document) {
    return badRequest(res, "Campos obrigatórios: personType, document e name.");
  }

  const normalizedDocument = normalizeSupplierDocument(normalizedPersonType, document);
  const expectedLabel = normalizedPersonType === "pj" ? "CNPJ" : "CPF";
  if (!isValidSupplierDocument(normalizedPersonType, normalizedDocument)) {
    return badRequest(res, `${expectedLabel} inválido.`);
  }

  const supplierAlreadyExists = getSupplierByDocument(normalizedDocument);
  if (supplierAlreadyExists) {
    return badRequest(res, `${expectedLabel} já cadastrado para ${supplierAlreadyExists.name}.`);
  }

  const supplierId = db
    .prepare(
      `
      INSERT INTO suppliers
        (
          person_type,
          document,
          name,
          email,
          phone,
          mobile,
          address,
          neighborhood,
          city,
          state,
          postal_code,
          notes,
          active
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      normalizedPersonType,
      normalizedDocument,
      String(name).trim(),
      toOptionalText(email),
      normalizeLandlinePhone(phone),
      normalizePhone(mobile),
      toOptionalText(address),
      toOptionalText(neighborhood),
      toOptionalText(city),
      toOptionalText(state),
      normalizeCep(postalCode),
      toOptionalText(notes),
      parseBoolean(active, true) ? 1 : 0
    ).lastInsertRowid;

  return res.status(201).json(getSupplierById(supplierId));
});

router.patch("/suppliers/:id", (req, res) => {
  const supplierId = Number(req.params.id);
  if (!supplierId) {
    return badRequest(res, "ID de fornecedor inválido.");
  }

  const currentSupplier = getSupplierById(supplierId);
  if (!currentSupplier) {
    return notFound(res, "Fornecedor não encontrado.");
  }

  if (req.body.personType !== undefined) {
    const incomingPersonType = String(req.body.personType || "").toLowerCase();
    if (incomingPersonType !== currentSupplier.person_type) {
      return badRequest(res, "Tipo de pessoa não pode ser alterado.");
    }
  }

  if (req.body.document !== undefined) {
    const incomingDocument = normalizeSupplierDocument(currentSupplier.person_type, req.body.document);
    if (incomingDocument !== currentSupplier.document) {
      return badRequest(res, "CPF/CNPJ não pode ser alterado.");
    }
  }

  const duplicateSupplier = getSupplierByDocument(currentSupplier.document, supplierId);
  if (duplicateSupplier) {
    const expectedLabel = currentSupplier.person_type === "pj" ? "CNPJ" : "CPF";
    return badRequest(res, `${expectedLabel} já cadastrado para ${duplicateSupplier.name}.`);
  }

  const nextName = req.body.name !== undefined
    ? String(req.body.name).trim()
    : currentSupplier.name;
  if (!nextName) {
    return badRequest(res, "Nome do fornecedor é obrigatório.");
  }

  db.prepare(
    `
      UPDATE suppliers
      SET
        name = ?,
        email = ?,
        phone = ?,
        mobile = ?,
        address = ?,
        neighborhood = ?,
        city = ?,
        state = ?,
        postal_code = ?,
        notes = ?,
        active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    nextName,
    req.body.email !== undefined ? toOptionalText(req.body.email) : currentSupplier.email,
    req.body.phone !== undefined ? normalizeLandlinePhone(req.body.phone) : currentSupplier.phone,
    req.body.mobile !== undefined ? normalizePhone(req.body.mobile) : currentSupplier.mobile,
    req.body.address !== undefined ? toOptionalText(req.body.address) : currentSupplier.address,
    req.body.neighborhood !== undefined
      ? toOptionalText(req.body.neighborhood)
      : currentSupplier.neighborhood,
    req.body.city !== undefined ? toOptionalText(req.body.city) : currentSupplier.city,
    req.body.state !== undefined ? toOptionalText(req.body.state) : currentSupplier.state,
    req.body.postalCode !== undefined ? normalizeCep(req.body.postalCode) : currentSupplier.postal_code,
    req.body.notes !== undefined ? toOptionalText(req.body.notes) : currentSupplier.notes,
    req.body.active !== undefined
      ? (parseBoolean(req.body.active, true) ? 1 : 0)
      : currentSupplier.active,
    supplierId
  );

  return res.json(getSupplierById(supplierId));
});

router.delete("/suppliers/:id", (req, res) => {
  const supplierId = Number(req.params.id);
  const currentSupplier = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(supplierId);
  if (!currentSupplier) {
    return notFound(res, "Fornecedor não encontrado.");
  }

  db.prepare("UPDATE suppliers SET active = 0, updated_at = datetime('now') WHERE id = ?").run(supplierId);
  return res.json({ message: "Fornecedor desativado com sucesso." });
});

router.get("/expense-types", (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const whereClause = includeInactive ? "" : "WHERE active = 1";

  const rows = db
    .prepare(
      `
      SELECT
        id,
        name,
        description,
        active,
        created_at,
        updated_at
      FROM expense_types
      ${whereClause}
      ORDER BY name ASC
    `
    )
    .all();

  return res.json(rows);
});

router.post("/expense-types", (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = toOptionalText(req.body.description);
  const active = parseBoolean(req.body.active, true) ? 1 : 0;

  if (!name) {
    return badRequest(res, "Campo obrigatório: name.");
  }

  const duplicate = getExpenseTypeByName(name);
  if (duplicate) {
    return badRequest(res, `Tipo de despesa já cadastrado: ${duplicate.name}.`);
  }

  const expenseTypeId = db
    .prepare(
      `
      INSERT INTO expense_types (name, description, active)
      VALUES (?, ?, ?)
    `
    )
    .run(name, description, active).lastInsertRowid;

  return res.status(201).json(getExpenseTypeById(expenseTypeId));
});

router.patch("/expense-types/:id", (req, res) => {
  const expenseTypeId = Number(req.params.id);
  if (!expenseTypeId) {
    return badRequest(res, "ID de tipo de despesa inválido.");
  }

  const current = getExpenseTypeById(expenseTypeId);
  if (!current) {
    return notFound(res, "Tipo de despesa não encontrado.");
  }

  const nextName = req.body.name !== undefined ? String(req.body.name).trim() : current.name;
  if (!nextName) {
    return badRequest(res, "Campo obrigatório: name.");
  }

  const duplicate = getExpenseTypeByName(nextName, expenseTypeId);
  if (duplicate) {
    return badRequest(res, `Tipo de despesa já cadastrado: ${duplicate.name}.`);
  }

  db.prepare(
    `
      UPDATE expense_types
      SET
        name = ?,
        description = ?,
        active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    nextName,
    req.body.description !== undefined ? toOptionalText(req.body.description) : current.description,
    req.body.active !== undefined ? (parseBoolean(req.body.active, true) ? 1 : 0) : current.active,
    expenseTypeId
  );

  return res.json(getExpenseTypeById(expenseTypeId));
});

router.delete("/expense-types/:id", (req, res) => {
  const expenseTypeId = Number(req.params.id);
  if (!expenseTypeId) {
    return badRequest(res, "ID de tipo de despesa inválido.");
  }

  const current = getExpenseTypeById(expenseTypeId);
  if (!current) {
    return notFound(res, "Tipo de despesa não encontrado.");
  }

  db.prepare("UPDATE expense_types SET active = 0, updated_at = datetime('now') WHERE id = ?").run(
    expenseTypeId
  );
  return res.json({ message: "Tipo de despesa desativado com sucesso." });
});

router.get("/sale-products", (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const whereClause = includeInactive ? "" : "WHERE p.active = 1";

  const products = db
    .prepare(
      `
      SELECT
        p.*,
        p.supplier_id,
        COALESCE(s.name, p.supplier) AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      ${whereClause}
      ORDER BY p.name ASC
    `
    )
    .all();

  return res.json(products);
});

router.get("/sale-products/check-sku", (req, res) => {
  const normalizedSku = normalizeSku(req.query.sku);
  if (!normalizedSku) {
    return badRequest(res, "Informe SKU válido para consulta.");
  }

  const excludeId = Number(req.query.excludeId || 0);
  const existing = getSaleProductBySku(normalizedSku, excludeId || null);
  return res.json({
    exists: Boolean(existing),
    product: existing || null
  });
});

router.post("/sale-products", (req, res) => {
  const {
    name,
    category,
    description,
    imageUrl,
    price,
    costPrice,
    sku,
    supplierId,
    supplier,
    stock,
    lowStockThreshold
  } = req.body;

  if (!name || !category || price === undefined) {
    return badRequest(res, "Campos obrigatórios: name, category e price.");
  }

  const parsedStock = parseNumber(stock, 0);
  const parsedLowStockThreshold = parseNumber(lowStockThreshold, 3);
  if (parsedStock < 0 || parsedLowStockThreshold < 0) {
    return badRequest(res, "Estoque e estoque mínimo não podem ser negativos.");
  }

  const normalizedSku = normalizeSku(sku);
  if (normalizedSku) {
    const duplicateSku = getSaleProductBySku(normalizedSku);
    if (duplicateSku) {
      return badRequest(res, `SKU já existe e está vinculado ao produto: ${duplicateSku.name}.`);
    }
  }

  let resolvedSupplierId = null;
  let resolvedSupplierName = toOptionalText(supplier);
  if (supplierId !== undefined) {
    const rawSupplierId = String(supplierId ?? "").trim();
    if (rawSupplierId !== "") {
      resolvedSupplierId = parseNullableId(supplierId);
      if (!resolvedSupplierId) {
        return badRequest(res, "Fornecedor inválido.");
      }
      const supplierRecord = getSupplierById(resolvedSupplierId);
      if (!supplierRecord) {
        return notFound(res, "Fornecedor não encontrado.");
      }
      resolvedSupplierName = supplierRecord.name;
    } else {
      resolvedSupplierId = null;
      resolvedSupplierName = null;
    }
  }

  const productId = db
    .prepare(
      `
      INSERT INTO products
        (
          name,
          category,
          description,
          image_url,
          price,
          cost_price,
          sku,
          supplier,
          supplier_id,
          stock,
          low_stock_threshold,
          active
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `
    )
    .run(
      String(name).trim(),
      String(category).trim(),
      description || "",
      imageUrl || null,
      parseNumber(price, 0),
      parseNumber(costPrice, 0),
      normalizedSku,
      resolvedSupplierName,
      resolvedSupplierId,
      parsedStock,
      parsedLowStockThreshold
    ).lastInsertRowid;

  if (!normalizedSku) {
    const skuBase = buildGeneratedProductSku(productId);
    let generatedSku = skuBase;
    let suffix = 1;
    while (getSaleProductBySku(generatedSku, productId)) {
      generatedSku = `${skuBase}-${suffix}`;
      suffix += 1;
    }
    db.prepare("UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ?").run(
      generatedSku,
      productId
    );
  }

  return res.status(201).json(getSaleProductById(productId));
});

router.patch("/sale-products/:id", (req, res) => {
  const productId = Number(req.params.id);
  const current = getSaleProductById(productId);
  if (!current) {
    return notFound(res, "Produto não encontrado.");
  }

  const nextSku = req.body.sku !== undefined ? normalizeSku(req.body.sku) : current.sku;
  if (nextSku) {
    const duplicateSku = getSaleProductBySku(nextSku, productId);
    if (duplicateSku) {
      return badRequest(res, `SKU já existe e está vinculado ao produto: ${duplicateSku.name}.`);
    }
  }

  const nextStock = parseNumber(req.body.stock ?? current.stock, 0);
  const nextLowStockThreshold = parseNumber(
    req.body.lowStockThreshold ?? current.low_stock_threshold,
    0
  );
  if (nextStock < 0 || nextLowStockThreshold < 0) {
    return badRequest(res, "Estoque e estoque mínimo não podem ser negativos.");
  }

  let nextSupplierId = current.supplier_id;
  let nextSupplierText = current.supplier;
  if (req.body.supplierId !== undefined) {
    const rawSupplierId = String(req.body.supplierId ?? "").trim();
    if (!rawSupplierId) {
      nextSupplierId = null;
      nextSupplierText = null;
    } else {
      const parsedSupplierId = parseNullableId(req.body.supplierId);
      if (!parsedSupplierId) {
        return badRequest(res, "Fornecedor inválido.");
      }
      const supplierRecord = getSupplierById(parsedSupplierId);
      if (!supplierRecord) {
        return notFound(res, "Fornecedor não encontrado.");
      }
      nextSupplierId = parsedSupplierId;
      nextSupplierText = supplierRecord.name;
    }
  } else if (req.body.supplier !== undefined) {
    nextSupplierText = toOptionalText(req.body.supplier);
  }

  const payload = {
    name: req.body.name ?? current.name,
    category: req.body.category ?? current.category,
    description: req.body.description ?? current.description,
    image_url: req.body.imageUrl ?? current.image_url,
    price: req.body.price ?? current.price,
    cost_price: req.body.costPrice ?? current.cost_price,
    sku: nextSku,
    supplier: nextSupplierText,
    supplier_id: nextSupplierId,
    stock: nextStock,
    low_stock_threshold: nextLowStockThreshold,
    active: req.body.active ?? current.active
  };

  db.prepare(
    `
      UPDATE products
      SET
        name = ?,
        category = ?,
        description = ?,
        image_url = ?,
        price = ?,
        cost_price = ?,
        sku = ?,
        supplier = ?,
        supplier_id = ?,
        stock = ?,
        low_stock_threshold = ?,
        active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    payload.name,
    payload.category,
    payload.description,
    payload.image_url,
    parseNumber(payload.price, 0),
    parseNumber(payload.cost_price, 0),
    payload.sku,
    payload.supplier,
    payload.supplier_id,
    payload.stock,
    payload.low_stock_threshold,
    parseBoolean(payload.active, true) ? 1 : 0,
    productId
  );

  return res.json(getSaleProductById(productId));
});

router.delete("/sale-products/:id", (req, res) => {
  const productId = Number(req.params.id);
  const current = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
  if (!current) {
    return notFound(res, "Produto não encontrado.");
  }

  db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").run(productId);
  return res.json({ message: "Produto desativado com sucesso." });
});

router.get("/consumables", (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const whereClause = includeInactive ? "" : "WHERE c.active = 1";

  const items = db
    .prepare(
      `
      SELECT
        c.*,
        c.supplier_id,
        COALESCE(s.name, c.supplier) AS supplier_name
      FROM consumable_materials c
      LEFT JOIN suppliers s ON s.id = c.supplier_id
      ${whereClause}
      ORDER BY c.name ASC
    `
    )
    .all();

  return res.json(items);
});

router.post("/consumables", (req, res) => {
  const {
    name,
    category,
    unit,
    description,
    currentStock,
    minStock,
    costPerUnit,
    supplierId,
    supplier,
    lastPurchaseOn
  } = req.body;

  if (!name || !category || !unit) {
    return badRequest(res, "Campos obrigatórios: name, category e unit.");
  }

  const parsedCurrentStock = parseNumber(currentStock, 0);
  const parsedMinStock = parseNumber(minStock, 0);
  if (parsedCurrentStock < 0 || parsedMinStock < 0) {
    return badRequest(res, "Estoque atual e estoque mínimo não podem ser negativos.");
  }

  let resolvedSupplierId = null;
  let resolvedSupplierName = toOptionalText(supplier);
  if (supplierId !== undefined) {
    const rawSupplierId = String(supplierId ?? "").trim();
    if (rawSupplierId !== "") {
      resolvedSupplierId = parseNullableId(supplierId);
      if (!resolvedSupplierId) {
        return badRequest(res, "Fornecedor inválido.");
      }
      const supplierRecord = getSupplierById(resolvedSupplierId);
      if (!supplierRecord) {
        return notFound(res, "Fornecedor não encontrado.");
      }
      resolvedSupplierName = supplierRecord.name;
    } else {
      resolvedSupplierId = null;
      resolvedSupplierName = null;
    }
  }

  const itemId = db
    .prepare(
      `
      INSERT INTO consumable_materials
        (
          name,
          category,
          unit,
          description,
          current_stock,
          min_stock,
          cost_per_unit,
          supplier,
          supplier_id,
          last_purchase_on,
          active
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `
    )
    .run(
      String(name).trim(),
      String(category).trim(),
      String(unit).trim(),
      description || "",
      parsedCurrentStock,
      parsedMinStock,
      parseNumber(costPerUnit, 0),
      resolvedSupplierName,
      resolvedSupplierId,
      lastPurchaseOn || null
    ).lastInsertRowid;

  return res.status(201).json(getConsumableById(itemId));
});

router.patch("/consumables/:id", (req, res) => {
  const itemId = Number(req.params.id);
  const current = getConsumableById(itemId);
  if (!current) {
    return notFound(res, "Material de consumo não encontrado.");
  }

  let nextSupplierId = current.supplier_id;
  let nextSupplierText = current.supplier;
  if (req.body.supplierId !== undefined) {
    const rawSupplierId = String(req.body.supplierId ?? "").trim();
    if (!rawSupplierId) {
      nextSupplierId = null;
      nextSupplierText = null;
    } else {
      const parsedSupplierId = parseNullableId(req.body.supplierId);
      if (!parsedSupplierId) {
        return badRequest(res, "Fornecedor inválido.");
      }
      const supplierRecord = getSupplierById(parsedSupplierId);
      if (!supplierRecord) {
        return notFound(res, "Fornecedor não encontrado.");
      }
      nextSupplierId = parsedSupplierId;
      nextSupplierText = supplierRecord.name;
    }
  } else if (req.body.supplier !== undefined) {
    nextSupplierText = toOptionalText(req.body.supplier);
  }

  const nextCurrentStock = parseNumber(req.body.currentStock ?? current.current_stock, 0);
  const nextMinStock = parseNumber(req.body.minStock ?? current.min_stock, 0);
  if (nextCurrentStock < 0 || nextMinStock < 0) {
    return badRequest(res, "Estoque atual e estoque mínimo não podem ser negativos.");
  }

  const payload = {
    name: req.body.name ?? current.name,
    category: req.body.category ?? current.category,
    unit: req.body.unit ?? current.unit,
    description: req.body.description ?? current.description,
    current_stock: nextCurrentStock,
    min_stock: nextMinStock,
    cost_per_unit: req.body.costPerUnit ?? current.cost_per_unit,
    supplier: nextSupplierText,
    supplier_id: nextSupplierId,
    last_purchase_on: req.body.lastPurchaseOn ?? current.last_purchase_on,
    active: req.body.active ?? current.active
  };

  db.prepare(
    `
      UPDATE consumable_materials
      SET
        name = ?,
        category = ?,
        unit = ?,
        description = ?,
        current_stock = ?,
        min_stock = ?,
        cost_per_unit = ?,
        supplier = ?,
        supplier_id = ?,
        last_purchase_on = ?,
        active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    payload.name,
    payload.category,
    payload.unit,
    payload.description,
    payload.current_stock,
    payload.min_stock,
    parseNumber(payload.cost_per_unit, 0),
    payload.supplier,
    payload.supplier_id,
    payload.last_purchase_on,
    parseBoolean(payload.active, true) ? 1 : 0,
    itemId
  );

  return res.json(getConsumableById(itemId));
});

router.delete("/consumables/:id", (req, res) => {
  const itemId = Number(req.params.id);
  const current = db.prepare("SELECT id FROM consumable_materials WHERE id = ?").get(itemId);
  if (!current) {
    return notFound(res, "Material de consumo não encontrado.");
  }

  db.prepare(
    "UPDATE consumable_materials SET active = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(itemId);
  return res.json({ message: "Material de consumo desativado com sucesso." });
});

router.get("/stock/movements", (req, res) => {
  const itemType = normalizeStockItemType(req.query.itemType);
  if (req.query.itemType !== undefined && !itemType) {
    return badRequest(res, "Tipo de item inválido. Use product ou consumable.");
  }

  const movementType = normalizeStockMovementType(req.query.movementType);
  if (req.query.movementType !== undefined && !movementType) {
    return badRequest(res, "Tipo de movimentação inválido.");
  }

  const itemId = parseNullableId(req.query.itemId);
  if (req.query.itemId !== undefined && !itemId) {
    return badRequest(res, "Item inválido para filtro.");
  }

  const dateFrom = normalizeDateFilter(req.query.dateFrom);
  if (req.query.dateFrom !== undefined && !dateFrom) {
    return badRequest(res, "Data inicial inválida. Use YYYY-MM-DD.");
  }

  const dateTo = normalizeDateFilter(req.query.dateTo);
  if (req.query.dateTo !== undefined && !dateTo) {
    return badRequest(res, "Data final inválida. Use YYYY-MM-DD.");
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return badRequest(res, "Data inicial não pode ser maior que a data final.");
  }

  const limit = Math.min(Math.max(parseNumber(req.query.limit, 300), 1), 1000);
  const whereConditions = [];
  const queryParams = [];

  if (itemType) {
    whereConditions.push("sm.item_type = ?");
    queryParams.push(itemType);
  }

  if (itemId) {
    whereConditions.push("sm.item_id = ?");
    queryParams.push(itemId);
  }

  if (movementType) {
    whereConditions.push("sm.movement_type = ?");
    queryParams.push(movementType);
  }

  if (dateFrom) {
    whereConditions.push("date(sm.created_at) >= date(?)");
    queryParams.push(dateFrom);
  }

  if (dateTo) {
    whereConditions.push("date(sm.created_at) <= date(?)");
    queryParams.push(dateTo);
  }

  const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const movements = db
    .prepare(
      `
      SELECT
        sm.id,
        sm.item_type,
        sm.item_id,
        sm.movement_type,
        sm.quantity,
        sm.previous_stock,
        sm.new_stock,
        sm.reason,
        sm.reference_type,
        sm.reference_id,
        sm.created_at,
        u.name AS created_by_name,
        COALESCE(p.name, c.name) AS item_name,
        p.sku AS item_sku,
        c.unit AS item_unit
      FROM stock_movements sm
      LEFT JOIN users u ON u.id = sm.created_by
      LEFT JOIN products p ON sm.item_type = 'product' AND p.id = sm.item_id
      LEFT JOIN consumable_materials c ON sm.item_type = 'consumable' AND c.id = sm.item_id
      ${whereClause}
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT ?
    `
    )
    .all(...queryParams, limit);

  return res.json(movements);
});

router.post("/stock/movements", (req, res) => {
  const itemType = normalizeStockItemType(req.body.itemType);
  if (!itemType) {
    return badRequest(res, "Tipo de item inválido. Use product ou consumable.");
  }

  const movementType = normalizeStockMovementType(req.body.movementType);
  if (!movementType) {
    return badRequest(res, "Tipo de movimentação inválido.");
  }
  if (movementType === STOCK_MOVEMENT_TYPES.SALE) {
    return badRequest(res, "Movimentação de venda é exclusiva do processo de venda.");
  }

  const itemId = parseNullableId(req.body.itemId);
  if (!itemId) {
    return badRequest(res, "Informe um item válido para movimentação.");
  }

  const quantity = parseNumber(req.body.quantity, 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return badRequest(res, "Informe quantidade válida para movimentação.");
  }

  try {
    const movementResult = applyStockMovement({
      itemType,
      itemId,
      movementType,
      quantity,
      reason: req.body.reason,
      referenceType: "manual",
      createdBy: req.user.id
    });
    const movement = getStockMovementById(movementResult.movementId);
    return res.status(201).json(movement || movementResult);
  } catch (error) {
    return badRequest(res, error.message);
  }
});

router.get("/banks", (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const whereClause = includeInactive ? "" : "WHERE active = 1";

  const banks = db
    .prepare(
      `
      SELECT *
      FROM banks
      ${whereClause}
      ORDER BY bank_name ASC, account_name ASC
    `
    )
    .all();

  return res.json(banks.map((row) => serializeBankRow(row)));
});

router.get("/banks/catalog", (req, res) => {
  return res.json({
    metadata: BRAZIL_BANK_CATALOG_METADATA,
    options: BRAZIL_BANK_OPTIONS
  });
});

router.post("/banks", (req, res) => {
  const {
    bankCode,
    bankName,
    accountName,
    accountType,
    branch,
    accountNumber,
    pixKey,
    initialBalance,
    currentBalance,
    notes
  } = req.body;

  if (!accountName) {
    return badRequest(res, "Campos obrigatórios: bankCode e accountName.");
  }

  const selectedBank = resolveBank({
    bankCode,
    bankName
  });
  if (!selectedBank) {
    return badRequest(res, "Selecione um banco válido na tabela fixa.");
  }

  const initial = parseNumber(initialBalance, 0);
  const current = req.body.currentBalance !== undefined
    ? parseNumber(currentBalance, initial)
    : initial;

  const bankId = db
    .prepare(
      `
      INSERT INTO banks
        (bank_name, account_name, account_type, branch, account_number, pix_key, initial_balance, current_balance, notes, active)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `
    )
    .run(
      selectedBank.label,
      String(accountName).trim(),
      accountType || "corrente",
      branch || null,
      accountNumber || null,
      pixKey || null,
      initial,
      current,
      notes || null
    ).lastInsertRowid;

  return res.status(201).json(serializeBankRow(db.prepare("SELECT * FROM banks WHERE id = ?").get(bankId)));
});

router.patch("/banks/:id", (req, res) => {
  const bankId = Number(req.params.id);
  const current = db.prepare("SELECT * FROM banks WHERE id = ?").get(bankId);
  if (!current) {
    return notFound(res, "Banco nao encontrado.");
  }

  let selectedBank = null;
  if (req.body.bankCode !== undefined || req.body.bankName !== undefined) {
    selectedBank = resolveBank({
      bankCode: req.body.bankCode,
      bankName: req.body.bankName
    });
    if (!selectedBank) {
      return badRequest(res, "Selecione um banco válido na tabela fixa.");
    }
  }

  const payload = {
    bank_name: selectedBank ? selectedBank.label : current.bank_name,
    account_name: req.body.accountName ?? current.account_name,
    account_type: req.body.accountType ?? current.account_type,
    branch: req.body.branch ?? current.branch,
    account_number: req.body.accountNumber ?? current.account_number,
    pix_key: req.body.pixKey ?? current.pix_key,
    initial_balance: req.body.initialBalance ?? current.initial_balance,
    current_balance: req.body.currentBalance ?? current.current_balance,
    notes: req.body.notes ?? current.notes,
    active: req.body.active ?? current.active
  };

  db.prepare(
    `
      UPDATE banks
      SET
        bank_name = ?,
        account_name = ?,
        account_type = ?,
        branch = ?,
        account_number = ?,
        pix_key = ?,
        initial_balance = ?,
        current_balance = ?,
        notes = ?,
        active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    payload.bank_name,
    payload.account_name,
    payload.account_type,
    payload.branch,
    payload.account_number,
    payload.pix_key,
    parseNumber(payload.initial_balance, 0),
    parseNumber(payload.current_balance, 0),
    payload.notes,
    parseBoolean(payload.active, true) ? 1 : 0,
    bankId
  );

  return res.json(serializeBankRow(db.prepare("SELECT * FROM banks WHERE id = ?").get(bankId)));
});

router.delete("/banks/:id", (req, res) => {
  const bankId = Number(req.params.id);
  const current = db.prepare("SELECT id FROM banks WHERE id = ?").get(bankId);
  if (!current) {
    return notFound(res, "Banco não encontrado.");
  }

  db.prepare("UPDATE banks SET active = 0, updated_at = datetime('now') WHERE id = ?").run(bankId);
  return res.json({ message: "Banco desativado com sucesso." });
});

module.exports = router;
