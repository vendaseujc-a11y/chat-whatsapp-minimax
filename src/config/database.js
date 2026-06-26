const sessions = new Map();
let useMemory = false;

// Global memory stores for Vercel / serverless environment fallbacks
global.tenantsMemory = global.tenantsMemory || [];
global.productsMemory = global.productsMemory || [];

const crypto = require('crypto');
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function initDatabase() {
  console.log('Inicializando banco de dados...');
  
  // Seed memory stores immediately so they are always ready
  if (global.tenantsMemory.length === 0) {
    global.tenantsMemory.push({
      id: 1,
      email: 'loja1@teste.com',
      password_hash: hashPassword('VOUPRO9988'),
      store_name: 'VouComprarFácil',
      whatsapp_phone: '5517996705407',
      welcome_message: 'Olá! Seja muito bem-vindo à **VouComprarFácil**! ⚡💪\n\nSou seu consultor virtual inteligente especializado em suplementação esportiva de alto rendimento. Estou aqui para te ajudar a encontrar os melhores produtos para alcançar o shape dos seus sonhos!\n\nPor favor, escolha uma das opções abaixo para começarmos:'
    });
    
    // Seed products
    try {
      const fs = require('fs');
      const path = require('path');
      const productsJsonPath = path.join(__dirname, 'products.json');
      if (false && fs.existsSync(productsJsonPath)) {
        const productsList = JSON.parse(fs.readFileSync(productsJsonPath, 'utf8'));
        productsList.forEach(p => {
          const isBcaa = p.name.toLowerCase().includes('bcaa');
          global.productsMemory.push({
            id: p.id,
            tenant_id: 1,
            name: p.name,
            category: p.category,
            image: p.image,
            price: p.price,
            promo: p.promo,
            description: p.description,
            stock: isBcaa ? 0 : 10
          });
        });
      }
    } catch(e) {
      console.error('Falha ao ler products.json para memória:', e.message);
    }
  }

  if (process.env.VERCEL) {
    console.log('Ambiente Vercel detectado: utilizando persistência puramente em memória (JS nativo)');
    useMemory = true;
    return;
  }

  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, '..', '..', 'database.sqlite');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    let db;
    
    useMemory = false;
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath);
      db = new SQL.Database(data);
    } else {
      db = new SQL.Database();
    }
    
    db.run(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        store_name TEXT NOT NULL,
        whatsapp_phone TEXT NOT NULL,
        welcome_message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        image TEXT NOT NULL,
        price REAL NOT NULL,
        promo INTEGER NOT NULL,
        description TEXT NOT NULL,
        stock INTEGER NOT NULL DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      )
    `);
    
    global.db = db;
    
    // Seed local SQLite file if empty
    const stmt = db.prepare('SELECT COUNT(*) FROM tenants');
    if (stmt.step()) {
      const count = stmt.get()[0];
      stmt.free();
      if (count === 0) {
        console.log('Semeando banco SQLite local...');
        db.run(`
          INSERT INTO tenants (id, email, password_hash, store_name, whatsapp_phone, welcome_message)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          1,
          'loja1@teste.com',
          hashPassword('VOUPRO9988'),
          'VouComprarFácil',
          '5517996705407',
          'Olá! Seja muito bem-vindo à **VouComprarFácil**! ⚡💪\n\nSou seu consultor virtual inteligente especializado em suplementação esportiva de alto rendimento. Estou aqui para te ajudar a encontrar os melhores produtos para alcançar o shape dos seus sonhos!\n\nPor favor, escolha uma das opções abaixo para começarmos:'
        ]);
        
        global.productsMemory.forEach(p => {
          db.run(`
            INSERT INTO products (tenant_id, name, category, image, price, promo, description, stock)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            1,
            p.name,
            p.category,
            p.image,
            p.price,
            p.promo ? 1 : 0,
            p.description,
            p.stock
          ]);
        });
        
        const dataExport = db.export();
        fs.writeFileSync(dbPath, Buffer.from(dataExport));
      }
    } else {
      stmt.free();
    }
  } catch (e) {
    console.error('Falha ao carregar SQLite local:', e.message);
    useMemory = true;
  }
}

function getOrCreateConversation(sessionId, tenantId = 1) {
  if (process.env.VERCEL || !global.db) {
    const sessionKey = `${tenantId}:${sessionId}`;
    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, []);
    }
    return sessionKey;
  }
  
  const db = global.db;
  const stmt = db.prepare('SELECT id FROM conversations WHERE session_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1');
  stmt.bind([sessionId, tenantId]);
  
  if (stmt.step()) {
    const id = stmt.get()[0];
    stmt.free();
    return id;
  }
  stmt.free();
  
  db.run('INSERT INTO conversations (session_id, tenant_id) VALUES (?, ?)', [sessionId, tenantId]);
  
  const result = db.exec('SELECT last_insert_rowid()');
  const insertedId = result[0].values[0][0];
  
  // Save DB
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', '..', 'database.sqlite');
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  
  return insertedId;
}

function getContextMessages(sessionId, tenantId = 1, limit = 15) {
  if (process.env.VERCEL || !global.db) {
    const sessionKey = `${tenantId}:${sessionId}`;
    const sessionMessages = sessions.get(sessionKey) || [];
    return sessionMessages.slice(-limit);
  }
  
  const convId = getOrCreateConversation(sessionId, tenantId);
  const db = global.db;
  
  const stmt = db.prepare(`
    SELECT role, content FROM messages 
    WHERE conversation_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  stmt.bind([convId, limit]);
  
  const messages = [];
  while (stmt.step()) {
    const row = stmt.get();
    messages.push({ role: row[0], content: row[1] });
  }
  stmt.free();
  
  return messages.reverse();
}

function saveMessage(sessionId, tenantId = 1, role, content) {
  const limit = parseInt(process.env.MAX_CONTEXT_MESSAGES) || 15;
  
  if (process.env.VERCEL || !global.db) {
    const sessionKey = `${tenantId}:${sessionId}`;
    const sessionMessages = sessions.get(sessionKey) || [];
    sessionMessages.push({ role, content, created_at: new Date() });
    
    if (sessionMessages.length > limit) {
      sessionMessages.splice(0, sessionMessages.length - limit);
    }
    
    sessions.set(sessionKey, sessionMessages);
    return;
  }
  
  const convId = getOrCreateConversation(sessionId, tenantId);
  const db = global.db;
  
  db.run('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [convId, role, content]);
  
  const countResult = db.exec(`SELECT COUNT(*) as count FROM messages WHERE conversation_id = ${convId}`);
  const count = countResult[0].values[0][0];
  
  if (count > limit) {
    const deleteCount = count - limit;
    db.run(`
      DELETE FROM messages WHERE id IN (
        SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
      )
    `, [convId, deleteCount]);
  }
  
  const dataExport = db.export();
  const buffer = Buffer.from(dataExport);
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', '..', 'database.sqlite');
  fs.writeFileSync(dbPath, buffer);
}

module.exports = {
  initDatabase,
  getOrCreateConversation,
  getContextMessages,
  saveMessage,
  isReady: () => true
};