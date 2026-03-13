const db = require("../../db/connection");

const STOCK_ITEM_TYPES = Object.freeze({
  PRODUCT: "product",
  CONSUMABLE: "consumable"
});

const STOCK_MOVEMENT_TYPES = Object.freeze({
  ENTRY: "entry",
  EXIT: "exit",
  SALE: "sale"
});

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function parseOptionalId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function getItemConfig(itemType) {
  if (itemType === STOCK_ITEM_TYPES.PRODUCT) {
    return {
      tableName: "products",
      stockColumn: "stock",
      extraColumns: "sku"
    };
  }

  if (itemType === STOCK_ITEM_TYPES.CONSUMABLE) {
    return {
      tableName: "consumable_materials",
      stockColumn: "current_stock",
      extraColumns: "unit"
    };
  }

  return null;
}

function isOutboundMovementType(movementType) {
  return movementType === STOCK_MOVEMENT_TYPES.EXIT || movementType === STOCK_MOVEMENT_TYPES.SALE;
}

function getStockItemById(itemType, itemId) {
  const config = getItemConfig(itemType);
  if (!config) return null;
  const numericId = Number(itemId);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  return db
    .prepare(
      `
      SELECT id, name, ${config.stockColumn} AS current_stock, ${config.extraColumns} AS extra_value, active
      FROM ${config.tableName}
      WHERE id = ?
    `
    )
    .get(numericId);
}

const applyStockMovementTx = db.transaction((movement) => {
  const itemType = String(movement.itemType || "");
  const movementType = String(movement.movementType || "");
  const config = getItemConfig(itemType);

  if (!config) {
    throw new Error("Tipo de item inválido.");
  }

  if (!Object.values(STOCK_MOVEMENT_TYPES).includes(movementType)) {
    throw new Error("Tipo de movimentação inválido.");
  }

  const itemId = Number(movement.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error("Item inválido para movimentação.");
  }

  const quantity = parseNumber(movement.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantidade inválida para movimentação.");
  }

  const currentItem = getStockItemById(itemType, itemId);
  if (!currentItem) {
    throw new Error("Item não encontrado para movimentação.");
  }

  const previousStock = Number(currentItem.current_stock || 0);
  const outbound = isOutboundMovementType(movementType);

  if (outbound && previousStock < quantity) {
    throw new Error(`Saída maior do que estoque disponível para ${currentItem.name}.`);
  }

  if (outbound) {
    const updateResult = db
      .prepare(
        `
        UPDATE ${config.tableName}
        SET ${config.stockColumn} = ${config.stockColumn} - ?, updated_at = datetime('now')
        WHERE id = ? AND ${config.stockColumn} >= ?
      `
      )
      .run(quantity, itemId, quantity);

    if (updateResult.changes === 0) {
      throw new Error(`Saída maior do que estoque disponível para ${currentItem.name}.`);
    }
  } else {
    db.prepare(
      `
      UPDATE ${config.tableName}
      SET ${config.stockColumn} = ${config.stockColumn} + ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(quantity, itemId);
  }

  const updatedItem = getStockItemById(itemType, itemId);
  if (!updatedItem) {
    throw new Error("Não foi possível atualizar o estoque do item.");
  }

  const newStock = Number(updatedItem.current_stock || 0);
  if (newStock < 0) {
    throw new Error("Operação inválida: estoque negativo não é permitido.");
  }

  const createdBy = parseOptionalId(movement.createdBy);
  const movementId = db
    .prepare(
      `
      INSERT INTO stock_movements
        (
          item_type,
          item_id,
          movement_type,
          quantity,
          previous_stock,
          new_stock,
          reason,
          reference_type,
          reference_id,
          created_by
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      itemType,
      itemId,
      movementType,
      quantity,
      previousStock,
      newStock,
      toOptionalText(movement.reason),
      toOptionalText(movement.referenceType),
      parseOptionalId(movement.referenceId),
      createdBy
    ).lastInsertRowid;

  return {
    movementId,
    itemType,
    itemId,
    movementType,
    quantity,
    previousStock,
    newStock
  };
});

function applyStockMovement(movement) {
  return applyStockMovementTx(movement);
}

module.exports = {
  STOCK_ITEM_TYPES,
  STOCK_MOVEMENT_TYPES,
  getStockItemById,
  applyStockMovement
};
