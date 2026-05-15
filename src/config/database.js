const sessions = new Map();
let useMemory = true;

async function initDatabase() {
  console.log('Inicializando banco de dados...');
  
  try {
    if (typeof require === 'undefined') {
      useMemory = true;
      return;
    }
    
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, '..', '..', 'database.sqlite');
    
    if (!fs.existsSync(dbPath)) {
      useMemory = true;
      return;
    }
    
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const data = fs.readFileSync(dbPath);
    const db = new SQL.Database(data);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    useMemory = false;
  } catch (e) {
    console.log('Usando armazenamento em memória');
    useMemory = true;
  }
}

function getOrCreateConversation(sessionId) {
  if (useMemory || !global.db) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
    }
    return sessionId;
  }
  
  const db = global.db;
  const stmt = db.prepare('SELECT id FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 1');
  stmt.bind([sessionId]);
  
  if (stmt.step()) {
    const id = stmt.get()[0];
    stmt.free();
    return id;
  }
  stmt.free();
  
  db.run('INSERT INTO conversations (session_id) VALUES (?)', [sessionId]);
  
  const result = db.exec('SELECT last_insert_rowid()');
  return result[0].values[0][0];
}

function getContextMessages(sessionId, limit = 15) {
  if (useMemory || !global.db) {
    const sessionMessages = sessions.get(sessionId) || [];
    return sessionMessages.slice(-limit);
  }
  
  const convId = getOrCreateConversation(sessionId);
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
    messages.push({ role: stmt.get()[0], content: stmt.get()[1] });
  }
  stmt.free();
  
  return messages.reverse();
}

function saveMessage(sessionId, role, content) {
  const limit = parseInt(process.env.MAX_CONTEXT_MESSAGES) || 15;
  
  if (useMemory || !global.db) {
    const sessionMessages = sessions.get(sessionId) || [];
    sessionMessages.push({ role, content, created_at: new Date() });
    
    if (sessionMessages.length > limit) {
      sessionMessages.splice(0, sessionMessages.length - limit);
    }
    
    sessions.set(sessionId, sessionMessages);
    return;
  }
  
  const convId = getOrCreateConversation(sessionId);
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