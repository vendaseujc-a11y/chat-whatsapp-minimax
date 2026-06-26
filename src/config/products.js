const fs = require('fs');
const path = require('path');

const fallbackProducts = [];

function getAllProducts(tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  
  if (process.env.VERCEL || !global.db) {
    if (global.productsMemory && global.productsMemory.length > 0) {
      const filtered = tenantId === 1 
        ? global.productsMemory 
        : global.productsMemory.filter(p => p.tenant_id === tenantId);
      
      return filtered.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        image: p.image,
        price: p.price,
        promo: p.promo,
        description: p.description,
        stock: p.stock !== undefined ? p.stock : 10,
        tenantId: p.tenant_id
      }));
    }
    return fallbackProducts;
  }
  
  const db = global.db;
  let stmt;
  if (tenantId === 1) {
    stmt = db.prepare('SELECT id, name, category, image, price, promo, description, stock, tenant_id FROM products');
  } else {
    stmt = db.prepare('SELECT id, name, category, image, price, promo, description, stock, tenant_id FROM products WHERE tenant_id = ?');
    stmt.bind([tenantId]);
  }
  const products = [];
  while (stmt.step()) {
    const row = stmt.get();
    products.push({
      id: row[0],
      name: row[1],
      category: row[2],
      image: row[3],
      price: row[4],
      promo: row[5] === 1,
      description: row[6],
      stock: row[7],
      tenantId: row[8]
    });
  }
  stmt.free();
  return products;
}

function getProductById(id, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  id = parseInt(id);
  
  if (process.env.VERCEL || !global.db) {
    const item = (global.productsMemory && global.productsMemory.length > 0)
      ? global.productsMemory.find(p => p.id === id && p.tenant_id === tenantId)
      : fallbackProducts.find(p => p.id === id && p.tenant_id === tenantId);
    
    if (item) {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        image: item.image,
        price: item.price,
        promo: item.promo,
        description: item.description,
        stock: item.stock !== undefined ? item.stock : 10,
        tenantId: tenantId
      };
    }
    return null;
  }
  
  const db = global.db;
  const stmt = db.prepare('SELECT id, name, category, image, price, promo, description, stock FROM products WHERE id = ? AND tenant_id = ?');
  stmt.bind([id, tenantId]);
  let product = null;
  if (stmt.step()) {
    const row = stmt.get();
    product = {
      id: row[0],
      name: row[1],
      category: row[2],
      image: row[3],
      price: row[4],
      promo: row[5] === 1,
      description: row[6],
      stock: row[7],
      tenantId: tenantId
    };
  }
  stmt.free();
  return product;
}

function getProductsByCategory(category, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  return getAllProducts(tenantId).filter(p => p.category.toLowerCase() === category.toLowerCase());
}

function getPromos(tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  return getAllProducts(tenantId).filter(p => p.promo);
}

function searchProducts(query, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const lowerQuery = query.toLowerCase();
  return getAllProducts(tenantId).filter(p => 
    p.name.toLowerCase().includes(lowerQuery) ||
    p.description.toLowerCase().includes(lowerQuery) ||
    p.category.toLowerCase().includes(lowerQuery)
  );
}

function saveDbState() {
  if (global.db && !process.env.VERCEL) {
    try {
      const dataExport = global.db.export();
      const buffer = Buffer.from(dataExport);
      const dbPath = path.join(__dirname, '..', '..', 'database.sqlite');
      fs.writeFileSync(dbPath, buffer);
    } catch (e) {
      console.error('Falha ao salvar estado do SQLite:', e.message);
    }
  }
}

function addOrUpdateProduct(productData, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const stockVal = productData.stock !== undefined ? parseInt(productData.stock) : 10;
  
  if (process.env.VERCEL || !global.db) {
    const targetArray = (global.productsMemory && global.productsMemory.length > 0) ? global.productsMemory : fallbackProducts;
    const existingId = parseInt(productData.id);
    const index = targetArray.findIndex(p => p.id === existingId && p.tenant_id === tenantId);
    
    if (index !== -1) {
      targetArray[index] = {
        ...targetArray[index],
        name: productData.name,
        category: productData.category || 'Suplemento',
        image: productData.image || '💪',
        price: parseFloat(productData.price) || 0.0,
        promo: typeof productData.promo === 'boolean' ? productData.promo : !!productData.promo,
        description: productData.description || '',
        stock: stockVal
      };
    } else {
      const nextId = targetArray.length > 0 ? Math.max(...targetArray.map(p => p.id)) + 1 : 1;
      targetArray.push({
        id: nextId,
        tenant_id: tenantId,
        name: productData.name,
        category: productData.category || 'Suplemento',
        image: productData.image || '💪',
        price: parseFloat(productData.price) || 0.0,
        promo: !!productData.promo,
        description: productData.description || '',
        stock: stockVal
      });
    }
    
    try {
      const { saveToKv, PRODUCTS_KEY } = require('./kvPersistence');
      saveToKv(PRODUCTS_KEY, global.productsMemory);
    } catch (e) {
      console.error('Erro ao salvar no KV:', e.message);
    }
    
    return true;
  }

  const db = global.db;
  const existingId = parseInt(productData.id);
  
  let exists = false;
  if (existingId) {
    const stmt = db.prepare('SELECT id FROM products WHERE id = ? AND tenant_id = ?');
    stmt.bind([existingId, tenantId]);
    exists = stmt.step();
    stmt.free();
  }

  if (exists) {
    db.run(`
      UPDATE products 
      SET name = ?, category = ?, image = ?, price = ?, promo = ?, description = ?, stock = ? 
      WHERE id = ? AND tenant_id = ?
    `, [
      productData.name,
      productData.category,
      productData.image,
      parseFloat(productData.price) || 0.0,
      productData.promo ? 1 : 0,
      productData.description || '',
      stockVal,
      existingId,
      tenantId
    ]);
  } else {
    db.run(`
      INSERT INTO products (tenant_id, name, category, image, price, promo, description, stock) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tenantId,
      productData.name,
      productData.category || 'Suplemento',
      productData.image || '💪',
      parseFloat(productData.price) || 0.0,
      productData.promo ? 1 : 0,
      productData.description || '',
      stockVal
    ]);
  }

  saveDbState();
  return true;
}

function deleteProduct(id, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  id = parseInt(id);
  
  if (process.env.VERCEL || !global.db) {
    const targetArray = (global.productsMemory && global.productsMemory.length > 0) ? global.productsMemory : fallbackProducts;
    const index = targetArray.findIndex(p => p.id === id && p.tenant_id === tenantId);
    if (index !== -1) {
      targetArray.splice(index, 1);
      
      try {
        const { saveToKv, PRODUCTS_KEY } = require('./kvPersistence');
        saveToKv(PRODUCTS_KEY, global.productsMemory);
      } catch (e) {
        console.error('Erro ao salvar no KV:', e.message);
      }
      
      return true;
    }
    return false;
  }

  const db = global.db;
  db.run('DELETE FROM products WHERE id = ? AND tenant_id = ?', [id, tenantId]);
  saveDbState();
  return true;
}

module.exports = {
  getAllProducts,
  getProductById,
  getProductsByCategory,
  getPromos,
  searchProducts,
  addOrUpdateProduct,
  deleteProduct
};