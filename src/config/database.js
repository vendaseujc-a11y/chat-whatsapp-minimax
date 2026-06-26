const crypto = require('crypto');
const axios = require('axios');

// ── Supabase config ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yfqefcpbawhpqnplqiio.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supaHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// In-memory session cache (for chat context – does not need persistence)
const sessions = new Map();

// ── Helpers ──────────────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function supaFetch(method, path, data, extra) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  try {
    const res = await axios({ method, url, data, headers: { ...supaHeaders, ...extra } });
    return res.data;
  } catch (e) {
    console.error(`Supabase ${method.toUpperCase()} ${path} error:`, e.response ? JSON.stringify(e.response.data) : e.message);
    return null;
  }
}

// ── Init (verify connection) ─────────────────────────────────────────
async function initDatabase() {
  console.log('Inicializando banco de dados Supabase...');

  if (!SUPABASE_KEY) {
    console.error('⚠️  SUPABASE_SERVICE_KEY ou SUPABASE_ANON_KEY não configurada!');
    console.log('Usando fallback em memória.');
    return;
  }

  // Verify connection
  try {
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`, { headers: supaHeaders });
    console.log('✅ Conexão com Supabase OK');
  } catch (e) {
    console.error('❌ Falha na conexão com Supabase:', e.response ? e.response.status : e.message);
    return;
  }

  // Ensure default tenants exist
  const tenants = await supaFetch('get', 'tenants?select=id,email');
  if (tenants && tenants.length === 0) {
    console.log('Semeando tenants padrão...');
    await supaFetch('post', 'tenants', [
      {
        email: 'loja1@teste.com',
        password_hash: hashPassword('VOUPRO9988'),
        store_name: 'VouComprarFácil',
        whatsapp_phone: '5517996705407',
        welcome_message: 'Olá! Seja muito bem-vindo à **VouComprarFácil**! 🛍️✨\n\nSou seu consultor virtual inteligente. O que você procura hoje?\n\nPor favor, escolha uma das opções abaixo ou me diga com suas palavras! 😊'
      },
      {
        email: 'jonatasc2009@gmail.com',
        password_hash: hashPassword('VOUPRO9988'),
        store_name: 'VouComprarFácil Jonatas',
        whatsapp_phone: '5517996705407',
        welcome_message: 'Olá! Seja muito bem-vindo! 🛍️✨\n\nSou seu consultor virtual inteligente. O que você procura hoje?\n\nPor favor, escolha uma das opções abaixo ou me diga com suas palavras! 😊'
      }
    ]);
  }

  // Ensure products exist
  const products = await supaFetch('get', 'products?select=id&limit=1');
  if (products && products.length === 0) {
    console.log('Semeando produtos padrão...');
    try {
      const fs = require('fs');
      const path = require('path');
      const productsJsonPath = path.join(__dirname, 'products.json');
      if (fs.existsSync(productsJsonPath)) {
        const list = JSON.parse(fs.readFileSync(productsJsonPath, 'utf8'));
        const firstTenant = tenants && tenants.length > 0 ? tenants[0].id : 1;
        const rows = list.map(p => ({
          tenant_id: firstTenant,
          name: p.name,
          category: p.category,
          image: p.image,
          price: p.price,
          promo: p.promo || false,
          description: p.description,
          stock: p.name.toLowerCase().includes('bcaa') ? 0 : 10
        }));
        await supaFetch('post', 'products', rows);
      }
    } catch (e) {
      console.error('Erro ao semear produtos:', e.message);
    }
  }

  console.log('Banco de dados Supabase pronto!');
}

// ── Tenant operations ────────────────────────────────────────────────
async function getTenantByEmail(email) {
  const rows = await supaFetch('get', `tenants?email=eq.${encodeURIComponent(email)}&select=*&limit=1`);
  return rows && rows.length > 0 ? rows[0] : null;
}

async function getTenantById(id) {
  const rows = await supaFetch('get', `tenants?id=eq.${id}&select=*&limit=1`);
  return rows && rows.length > 0 ? rows[0] : null;
}

async function createTenant(data) {
  const result = await supaFetch('post', 'tenants', data);
  return result && result.length > 0 ? result[0] : null;
}

async function updateTenant(id, data) {
  const result = await supaFetch('patch', `tenants?id=eq.${id}`, data);
  return result && result.length > 0 ? result[0] : null;
}

async function getAllTenants() {
  return (await supaFetch('get', 'tenants?select=*&order=id.asc')) || [];
}

// ── Product operations ───────────────────────────────────────────────
async function getAllProductsByTenant(tenantId) {
  return (await supaFetch('get', `products?tenant_id=eq.${tenantId}&select=*&order=id.asc`)) || [];
}

async function searchProductsByTenant(tenantId, query) {
  // Use ilike for case-insensitive search across name, category, description
  const encoded = encodeURIComponent(`%${query}%`);
  return (await supaFetch('get',
    `products?tenant_id=eq.${tenantId}&or=(name.ilike.${encoded},category.ilike.${encoded},description.ilike.${encoded})&select=*`
  )) || [];
}

async function getPromosByTenant(tenantId) {
  return (await supaFetch('get', `products?tenant_id=eq.${tenantId}&promo=eq.true&select=*`)) || [];
}

async function upsertProduct(product) {
  if (product.id) {
    const { id, ...data } = product;
    const result = await supaFetch('patch', `products?id=eq.${id}`, data);
    return result && result.length > 0 ? result[0] : null;
  }
  const result = await supaFetch('post', 'products', product);
  return result && result.length > 0 ? result[0] : null;
}

async function deleteProductById(id) {
  await supaFetch('delete', `products?id=eq.${id}`);
}

// ── Conversation / Message operations ────────────────────────────────
function getOrCreateConversation(sessionId, tenantId = 1) {
  // Use in-memory sessions for chat context (fast, no DB round-trip needed)
  const sessionKey = `${tenantId}:${sessionId}`;
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, []);
  }
  return sessionKey;
}

function getContextMessages(sessionId, tenantId = 1, limit = 15) {
  const sessionKey = `${tenantId}:${sessionId}`;
  const msgs = sessions.get(sessionKey) || [];
  return msgs.slice(-limit);
}

function saveMessage(sessionId, tenantId = 1, role, content) {
  const limit = parseInt(process.env.MAX_CONTEXT_MESSAGES) || 15;
  const sessionKey = `${tenantId}:${sessionId}`;
  const msgs = sessions.get(sessionKey) || [];
  msgs.push({ role, content, created_at: new Date() });
  if (msgs.length > limit) {
    msgs.splice(0, msgs.length - limit);
  }
  sessions.set(sessionKey, msgs);
}

// ── Exports ──────────────────────────────────────────────────────────
module.exports = {
  initDatabase,
  // Tenant
  getTenantByEmail,
  getTenantById,
  createTenant,
  updateTenant,
  getAllTenants,
  // Product
  getAllProductsByTenant,
  searchProductsByTenant,
  getPromosByTenant,
  upsertProduct,
  deleteProductById,
  // Chat context
  getOrCreateConversation,
  getContextMessages,
  saveMessage,
  // Utils
  hashPassword,
  isReady: () => true
};