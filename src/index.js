require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getContextMessages, saveMessage } = require('./config/database');
const { getAllProducts, getPromos, searchProducts, addOrUpdateProduct, deleteProduct } = require('./config/products');
const { hashPassword, verifyPassword, generateToken, verifyToken } = require('./services/auth');
const { chat: chatAI } = require('./services/openrouter');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('.'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  req.tenantId = decoded.tenantId;
  next();
}

// Sync Offline/Local Storage data to memory (SaaS stateless fallback)
app.post('/api/sync', (req, res) => {
  const { stores, products } = req.body;
  
  if (process.env.VERCEL || !global.db) {
    let modified = false;
    if (Array.isArray(stores)) {
      stores.forEach(s => {
        const exists = global.tenantsMemory.some(t => t.id === s.id || t.email === s.email);
        if (!exists) {
          global.tenantsMemory.push(s);
          modified = true;
        } else {
          const idx = global.tenantsMemory.findIndex(t => t.id === s.id);
          if (idx !== -1 && JSON.stringify(global.tenantsMemory[idx]) !== JSON.stringify(s)) {
            global.tenantsMemory[idx] = s;
            modified = true;
          }
        }
      });
    }
    if (Array.isArray(products)) {
      products.forEach(p => {
        const exists = global.productsMemory.some(item => item.id === p.id && item.tenant_id === p.tenant_id);
        if (!exists) {
          global.productsMemory.push({
            id: p.id,
            tenant_id: p.tenant_id,
            name: p.name,
            category: p.category,
            image: p.image,
            price: p.price,
            promo: p.promo,
            description: p.description,
            stock: p.stock
          });
          modified = true;
        } else {
          const idx = global.productsMemory.findIndex(item => item.id === p.id && item.tenant_id === p.tenant_id);
          if (idx !== -1) {
            const currentItem = global.productsMemory[idx];
            if (
              currentItem.name !== p.name ||
              currentItem.category !== p.category ||
              currentItem.image !== p.image ||
              currentItem.price !== p.price ||
              currentItem.promo !== p.promo ||
              currentItem.description !== p.description ||
              currentItem.stock !== p.stock
            ) {
              global.productsMemory[idx] = {
                id: p.id,
                tenant_id: p.tenant_id,
                name: p.name,
                category: p.category,
                image: p.image,
                price: p.price,
                promo: p.promo,
                description: p.description,
                stock: p.stock
              };
              modified = true;
            }
          }
        }
      });
    }

    if (modified) {
      try {
        const { saveToKv, TENANTS_KEY, PRODUCTS_KEY } = require('./config/kvPersistence');
        saveToKv(TENANTS_KEY, global.tenantsMemory);
        saveToKv(PRODUCTS_KEY, global.productsMemory);
      } catch (e) {
        console.error('Erro ao salvar no KV durante sync:', e.message);
      }
    }
  }
  res.json({ success: true });
});

// Auth Routes
app.post('/api/auth/register', (req, res) => {
  const { email, password, store_name, whatsapp_phone } = req.body;
  if (!email || !password || !store_name || !whatsapp_phone) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    if (process.env.VERCEL || !global.db) {
      const emailExists = global.tenantsMemory.some(t => t.email === email);
      if (emailExists) {
        return res.status(400).json({ error: 'Este e-mail já está cadastrado' });
      }

      const newId = global.tenantsMemory.length + 1;
      const welcomeMessage = `Olá! Seja muito bem-vindo à **${store_name}**! ⚡💪\n\nSou seu consultor virtual inteligente especializado em suplementação esportiva de alto rendimento. Estou aqui para te ajudar a encontrar os melhores produtos para alcançar o shape dos seus sonhos!\n\nPor favor, escolha uma das opções abaixo para começarmos:`;
      
      const tenantObj = {
        id: newId,
        email,
        password_hash: hashPassword(password),
        store_name,
        whatsapp_phone,
        welcome_message: welcomeMessage
      };
      global.tenantsMemory.push(tenantObj);

      try {
        const { saveToKv, TENANTS_KEY } = require('./config/kvPersistence');
        saveToKv(TENANTS_KEY, global.tenantsMemory);
      } catch (e) {
        console.error('Erro ao salvar no KV durante register:', e.message);
      }

      const token = generateToken(newId);
      return res.json({ success: true, token, tenantId: newId, tenant: tenantObj });
    }

    const db = global.db;
    
    // Check if email exists
    const stmtCheck = db.prepare('SELECT id FROM tenants WHERE email = ?');
    stmtCheck.bind([email]);
    if (stmtCheck.step()) {
      stmtCheck.free();
      return res.status(400).json({ error: 'Este e-mail já está cadastrado' });
    }
    stmtCheck.free();

    const passwordHash = hashPassword(password);
    const welcomeMessage = `Olá! Seja muito bem-vindo à **${store_name}**! ⚡💪\n\nSou seu consultor virtual inteligente especializado em suplementação esportiva de alto rendimento. Estou aqui para te ajudar a encontrar os melhores produtos para alcançar o shape dos seus sonhos!\n\nPor favor, escolha uma das opções abaixo para começarmos:`;

    db.run(`
      INSERT INTO tenants (email, password_hash, store_name, whatsapp_phone, welcome_message)
      VALUES (?, ?, ?, ?, ?)
    `, [email, passwordHash, store_name, whatsapp_phone, welcomeMessage]);

    // Save DB
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'database.sqlite');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));

    // Get newly created tenant details
    const stmtId = db.prepare('SELECT id, email, password_hash, store_name, whatsapp_phone, welcome_message FROM tenants WHERE email = ?');
    stmtId.bind([email]);
    stmtId.step();
    const row = stmtId.get();
    const tenantObj = {
      id: row[0],
      email: row[1],
      password_hash: row[2],
      store_name: row[3],
      whatsapp_phone: row[4],
      welcome_message: row[5]
    };
    stmtId.free();

    const token = generateToken(tenantObj.id);
    res.json({ success: true, token, tenantId: tenantObj.id, tenant: tenantObj });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }

  try {
    if (process.env.VERCEL || !global.db) {
      const tenant = global.tenantsMemory.find(t => t.email === email);
      if (tenant && verifyPassword(password, tenant.password_hash)) {
        const token = generateToken(tenant.id);
        return res.json({ success: true, token, tenantId: tenant.id, tenant });
      }
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const db = global.db;
    const stmt = db.prepare('SELECT id, email, password_hash, store_name, whatsapp_phone, welcome_message FROM tenants WHERE email = ?');
    stmt.bind([email]);

    if (stmt.step()) {
      const row = stmt.get();
      stmt.free();
      const tenantObj = {
        id: row[0],
        email: row[1],
        password_hash: row[2],
        store_name: row[3],
        whatsapp_phone: row[4],
        welcome_message: row[5]
      };

      if (verifyPassword(password, tenantObj.password_hash)) {
        const token = generateToken(tenantObj.id);
        return res.json({ success: true, token, tenantId: tenantObj.id, tenant: tenantObj });
      }
    } else {
      stmt.free();
    }
    return res.status(401).json({ error: 'Credenciais inválidas' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Store settings API
app.get('/api/store/settings/:tenantId', (req, res) => {
  const tenantId = parseInt(req.params.tenantId) || 1;
  
  try {
    if (process.env.VERCEL || !global.db) {
      const tenant = global.tenantsMemory.find(t => t.id === tenantId);
      if (tenant) {
        return res.json({
          id: tenant.id,
          store_name: tenant.store_name,
          whatsapp_phone: tenant.whatsapp_phone,
          welcome_message: tenant.welcome_message
        });
      }
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    const db = global.db;
    const stmt = db.prepare('SELECT id, store_name, whatsapp_phone, welcome_message FROM tenants WHERE id = ?');
    stmt.bind([tenantId]);
    
    if (stmt.step()) {
      const row = stmt.get();
      stmt.free();
      return res.json({
        id: row[0],
        store_name: row[1],
        whatsapp_phone: row[2],
        welcome_message: row[3]
      });
    }
    stmt.free();
    return res.status(404).json({ error: 'Loja não encontrada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/store/settings', authMiddleware, (req, res) => {
  const { store_name, whatsapp_phone, welcome_message } = req.body;
  const tenantId = req.tenantId;

  if (!store_name || !whatsapp_phone) {
    return res.status(400).json({ error: 'Nome da loja e WhatsApp são obrigatórios' });
  }

  try {
    if (process.env.VERCEL || !global.db) {
      const tenant = global.tenantsMemory.find(t => t.id === tenantId);
      if (tenant) {
        tenant.store_name = store_name;
        tenant.whatsapp_phone = whatsapp_phone;
        tenant.welcome_message = welcome_message || '';
        
        try {
          const { saveToKv, TENANTS_KEY } = require('./config/kvPersistence');
          saveToKv(TENANTS_KEY, global.tenantsMemory);
        } catch (e) {
          console.error('Erro ao salvar no KV durante update settings:', e.message);
        }
        
        return res.json({ success: true, message: 'Configurações atualizadas com sucesso' });
      }
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    const db = global.db;
    db.run(`
      UPDATE tenants 
      SET store_name = ?, whatsapp_phone = ?, welcome_message = ?
      WHERE id = ?
    `, [store_name, whatsapp_phone, welcome_message || '', tenantId]);

    // Save DB
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'database.sqlite');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));

    res.json({ success: true, message: 'Configurações atualizadas com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const userStates = new Map();

function getFlowState(stateId, tenantId = 1) {
  let welcomeMsg = `Olá! Seja muito bem-vindo! ⚡💪\n\nSou seu consultor virtual inteligente especializado em suplementação esportiva de alto rendimento. Estou aqui para te ajudar a encontrar os melhores produtos para alcançar o shape dos seus sonhos!\n\nPor favor, escolha uma das opções abaixo para começarmos:`;
  let whatsappPhone = '5517996705407';
  
  if (global.db && !process.env.VERCEL) {
    const db = global.db;
    const stmt = db.prepare('SELECT welcome_message, whatsapp_phone FROM tenants WHERE id = ?');
    stmt.bind([tenantId]);
    if (stmt.step()) {
      const row = stmt.get();
      if (row[0]) welcomeMsg = row[0];
      if (row[1]) whatsappPhone = row[1];
    }
    stmt.free();
  } else if (global.tenantsMemory) {
    const tenant = global.tenantsMemory.find(t => t.id === tenantId);
    if (tenant) {
      welcomeMsg = tenant.welcome_message;
      whatsappPhone = tenant.whatsapp_phone;
    }
  }

  const generateWhatsAppLink = (text) => `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}`;

  const flowTree = {
    inicio: {
      message: welcomeMsg,
      options: [
        { text: "Ver Categorias de Suplementos 💪", nextState: "categorias" },
        { text: "Ver Promoções Ativas 🔥", nextState: "promocoes" },
        { text: "Falar com Consultor / Comprar 🛒", nextState: "falar_vendedor" },
        { text: "Informações de Entrega 📦", nextState: "entrega" }
      ]
    },
    categorias: {
      message: `Escolha qual categoria de produtos você gostaria de explorar hoje:`,
      options: [
        { text: "Proteínas 🥩", nextState: "cat_Proteínas" },
        { text: "Força 💪", nextState: "cat_Força" },
        { text: "Energia ⚡", nextState: "cat_Energia" },
        { text: "Recuperação 💊", nextState: "cat_Recuperação" },
        { text: "Emagrecimento 🔥", nextState: "cat_Emagrecimento" },
        { text: "Produtos gerais 📦", nextState: "cat_Produtos gerais" },
        { text: "Mercado 🛒", nextState: "cat_mercado" },
        { text: "Lojas do comércio 🏪", nextState: "cat_lojas do comercio" },
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    },
    entrega: {
      message: `📦 **Informações de Entrega:**\n\n- **Prazo de Envio:** Todos os pedidos são despachados em até 24 horas úteis!\n- **Frete:** Temos condições de frete grátis dependendo da sua região e do valor do pedido (consulte o vendedor).\n- **Embalagem:** Enviamos tudo em caixas discretas e super seguras.\n\nComo gostaria de prosseguir?`,
      options: [
        { text: "Ver Categorias de Suplementos 💪", nextState: "categorias" },
        { text: "Falar com Consultor 🛒", nextState: "falar_vendedor" },
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    },
    falar_vendedor: {
      message: `Perfeito! ✨ Nossos consultores especializados estão prontos para te atender, tirar dúvidas técnicas e garantir as melhores condições e kits com descontos progressivos!\n\nClique no botão verde abaixo para falar direto com o nosso consultor no WhatsApp:\n\n👉 [Falar com Consultor](${generateWhatsAppLink('Olá! Estava tirando dúvidas no chat e gostaria de falar com um consultor para finalizar meu pedido.')})`,
      options: [
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    }
  };

  if (stateId.startsWith('cat_')) {
    const categoryName = stateId.replace('cat_', '');
    const products = getAllProducts(tenantId).filter(p => p.category.toLowerCase() === categoryName.toLowerCase());
    let messageText = `🥩 **Suplementos de ${categoryName} disponíveis:**\n\n`;
    if (products.length === 0) {
      messageText += `Nenhum produto cadastrado nesta categoria no momento.`;
    } else {
      products.forEach(p => {
        messageText += `${p.image} **${p.name}**\n${p.description}\n\n`;
      });
      messageText += `⚠️ *Nota: Por regras da loja, os valores atualizados e promoções de kits são passados pelo consultor.*`;
    }
    return {
      message: messageText,
      options: [
        { text: "Falar com Consultor / Comprar 🛒", nextState: "falar_vendedor" },
        { text: "Ver Outras Categorias 🔄", nextState: "categorias" },
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    };
  }

  if (stateId === 'promocoes') {
    const promos = getPromos(tenantId);
    let messageText = `🔥 **Suplementos em Promoção no momento:**\n\n`;
    if (promos.length === 0) {
      messageText += `Nenhum produto com promoção ativa no momento. Consulte o vendedor para descontos manuais!`;
    } else {
      promos.forEach(p => {
        messageText += `${p.image} **${p.name}** (Em Promoção!)\n${p.description}\n\n`;
      });
      messageText += `👉 Garanta seu desconto especial nos kits com o nosso consultor!`;
    }
    return {
      message: messageText,
      options: [
        { text: "Falar com Consultor / Comprar 🛒", nextState: "falar_vendedor" },
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    };
  }

  return flowTree[stateId] || flowTree['inicio'];
}

app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, tenantId } = req.body;
    const activeTenantId = parseInt(tenantId) || 1;

    if (!message) {
      return res.status(400).json({ error: 'Message é obrigatório' });
    }

    const session = sessionId || 'default';
    
    // Fetch products and store settings
    const products = getAllProducts(activeTenantId);
    let storeName = 'VouComprarFácil';
    let welcomeMessage = '';
    let whatsappPhone = '5517996705407';

    if (global.db && !process.env.VERCEL) {
      const db = global.db;
      const stmt = db.prepare('SELECT store_name, welcome_message, whatsapp_phone FROM tenants WHERE id = ?');
      stmt.bind([activeTenantId]);
      if (stmt.step()) {
        const row = stmt.get();
        if (row[0]) storeName = row[0];
        if (row[1]) welcomeMessage = row[1];
        if (row[2]) whatsappPhone = row[2];
      }
      stmt.free();
    } else if (global.tenantsMemory) {
      const tenant = global.tenantsMemory.find(t => t.id === activeTenantId);
      if (tenant) {
        storeName = tenant.store_name;
        welcomeMessage = tenant.welcome_message;
        whatsappPhone = tenant.whatsapp_phone;
      }
    }

    let responseText = '';
    let recommendation = null;

    if (process.env.OPENROUTER_API_KEY) {
      // 1. OpenRouter AI recommendation flow
      const contextMessages = getContextMessages(session, activeTenantId, 10);
      const productCatalog = products.map(p => 
        `- ID: ${p.id}, Nome: ${p.name}, Categoria: ${p.category}, Preço: R$ ${p.price.toFixed(2)}, Estoque: ${p.stock}, Descrição: ${p.description}`
      ).join('\n');

      const systemPrompt = `Você é o consultor inteligente da loja de suplementos esportivos "${storeName}".
Seu objetivo principal é vender e direcionar toda a conversa para os produtos cadastrados no nosso catálogo abaixo.

Abaixo está o catálogo atualizado em tempo real da loja com os produtos disponíveis:
${productCatalog}

DIRETRIZES DE CONVERSA E ABORDAGEM:
1. Toda conversa com o cliente deve ser direcionada para os produtos que estão cadastrados no catálogo acima. Quando o cliente descrever seu objetivo (por exemplo, ganhar massa, emagrecer, ter mais energia ou recuperação), associe imediatamente a sua resposta a um produto específico do catálogo, detalhando seus benefícios.
2. Tenha um tom de voz entusiasta e enérgico, utilizando emojis (ex: ✨🛍️💪⚡).
3. Nunca cite ou ofereça produtos que não estejam no catálogo acima. Se o produto não estiver cadastrado, responda que no momento temos outras opções fantásticas em nosso cardápio e direcione para um produto similar cadastrado.
4. Se o produto solicitado estiver com estoque (Estoque > 0), recomende-o diretamente. Se o produto estiver esgotado (Estoque == 0), avise de forma simpática que esgotou devido à alta procura e sugira um similar que esteja disponível no catálogo.
5. Sempre direcione o cliente para finalizar a compra clicando no botão do WhatsApp ou adicionando o produto ao carrinho do site.
6. Sempre que você indicar ou recomendar um produto cadastrado, adicione obrigatoriamente a tag JSON no final da resposta:
   [RECOMMEND: {"id": ID_DO_PRODUTO, "action": "highlight" | "add_to_cart"}]
   - Use "add_to_cart" se o cliente demonstrar intenção direta de compra ("adiciona no carrinho", "quero levar", "vou comprar").
   - Use "highlight" se ele estiver pesquisando, tirando dúvidas ou pedindo recomendação.`;

      const messagesForAI = [
        { role: 'system', content: systemPrompt },
        ...contextMessages.map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: message }
      ];

      try {
        responseText = await chatAI(messagesForAI);
        
        // Parse recommendation token if present
        const recommendRegex = /\[RECOMMEND:\s*(\{.*?\})\]/;
        const match = responseText.match(recommendRegex);
        if (match) {
          try {
            recommendation = JSON.parse(match[1]);
            responseText = responseText.replace(recommendRegex, '').trim();
          } catch (e) {
            console.error('Falha ao parsear JSON de recomendação:', e);
          }
        }
      } catch (aiErr) {
        console.error('Erro na chamada da API OpenRouter:', aiErr.message);
        // Fallback to local heuristic if API fails during request
        processFallbackHeuristics();
      }
    } else {
      processFallbackHeuristics();
    }

    function processFallbackHeuristics() {
      // 2. Rule-based local heuristic search fallback
      const lowerMsg = message.toLowerCase();
      let matchedProd = null;
      let action = 'highlight';

      if (lowerMsg.includes('comprar') || lowerMsg.includes('levar') || lowerMsg.includes('adicionar') || lowerMsg.includes('carrinho') || lowerMsg.includes('quero um') || lowerMsg.includes('pegar') || lowerMsg.includes('checkout')) {
        action = 'add_to_cart';
      }

      if (lowerMsg.includes('whey') || lowerMsg.includes('proteina') || lowerMsg.includes('massa') || lowerMsg.includes('gold') || lowerMsg.includes('prime')) {
        matchedProd = products.find(p => p.name.toLowerCase().includes('whey prime') && p.stock > 0) || products.find(p => p.category === 'Proteínas' && p.stock > 0);
        if (matchedProd) {
          responseText = `Com certeza! O **${matchedProd.name}** é uma excelente escolha proteica de alta qualidade para ganho de massa e recuperação muscular! 💪 Feito com as melhores matérias-primas do mercado. O preço é de R$ ${matchedProd.price.toFixed(2)}. ${action === 'add_to_cart' ? 'Estou adicionando ao seu carrinho agora mesmo!' : 'Gostaria que eu adicionasse ao seu carrinho?'}`;
        }
      } else if (lowerMsg.includes('creatina') || lowerMsg.includes('creapure') || lowerMsg.includes('força') || lowerMsg.includes('explosao')) {
        matchedProd = products.find(p => p.name.toLowerCase().includes('creatina') && p.stock > 0);
        if (matchedProd) {
          responseText = `Ótima pedida! A **${matchedProd.name}** Creapure é perfeita para ganho de força, resistência e explosão nos treinos intensos! ⚡ Apenas R$ ${matchedProd.price.toFixed(2)}. ${action === 'add_to_cart' ? 'Adicionando ao seu carrinho!' : 'Quer garantir a sua agora?'}`;
        }
      } else if (lowerMsg.includes('bcaa') || lowerMsg.includes('recuperacao') || lowerMsg.includes('fadiga')) {
        const bcaaProd = products.find(p => p.name.toLowerCase().includes('bcaa'));
        if (bcaaProd && bcaaProd.stock === 0) {
          matchedProd = products.find(p => p.name.toLowerCase().includes('whey prime') && p.stock > 0);
          responseText = `Poxa! O nosso **BCAA Powder** está temporariamente esgotado devido à altíssima procura! 😢 Mas não se preocupe: para recuperação muscular rápida e redução da fadiga, eu recomendo fortemente o nosso **Whey Prime**! Ele já vem rico em BCAAs naturais em sua fórmula! 🥛💪 Quer aproveitar?`;
          action = 'highlight';
        } else {
          matchedProd = bcaaProd;
          if (matchedProd) {
            responseText = `O **${matchedProd.name}** ajuda muito a diminuir a fadiga muscular e acelerar a síntese proteica pós-treino! 💊 R$ ${matchedProd.price.toFixed(2)}.`;
          }
        }
      } else if (lowerMsg.includes('c4') || lowerMsg.includes('beta') || lowerMsg.includes('pump') || lowerMsg.includes('pre-treino') || lowerMsg.includes('pre treino') || lowerMsg.includes('energia') || lowerMsg.includes('disposição') || lowerMsg.includes('foco')) {
        matchedProd = products.find(p => p.name.toLowerCase().includes('c4') && p.stock > 0) || products.find(p => p.category === 'Energia' && p.stock > 0);
        if (matchedProd) {
          responseText = `Prepare-se para um treino insano! 🔥 O **${matchedProd.name}** oferece foco mental apurado, vasodilatação e uma energia explosiva! Por apenas R$ ${matchedProd.price.toFixed(2)}. ${action === 'add_to_cart' ? 'Já coloquei no seu carrinho!' : 'Pronto para esmagar os pesos?'}`;
        }
      } else if (lowerMsg.includes('emagrecer') || lowerMsg.includes('peso') || lowerMsg.includes('gordura') || lowerMsg.includes('termogenico') || lowerMsg.includes('queimar')) {
        matchedProd = products.find(p => p.category === 'Energia' && p.stock > 0) || products.find(p => p.stock > 0);
        if (matchedProd) {
          responseText = `Para acelerar a queima de gordura e te dar aquele gás extra no cardio, o pré-treino **${matchedProd.name}** funciona perfeitamente acelerando seu metabolismo! ⚡🔥 R$ ${matchedProd.price.toFixed(2)}. Quer levar?`;
        }
      } else {
        const sessionKey = `${activeTenantId}:${session}`;
        const currentSessionState = userStates.get(sessionKey) || 'inicio';
        let nextStateId = null;
        const currentStateConfig = getFlowState(currentSessionState, activeTenantId);

        const matchedOption = currentStateConfig.options.find(opt => {
          const optionTextClean = opt.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          const inputTextClean = message.toLowerCase().replace(/[^a-z0-9]/g, '');
          return optionTextClean.includes(inputTextClean) || inputTextClean.includes(optionTextClean);
        });

        if (matchedOption) {
          nextStateId = matchedOption.nextState;
        } else {
          nextStateId = currentSessionState;
        }

        userStates.set(sessionKey, nextStateId);
        const nextStateConfig = getFlowState(nextStateId, activeTenantId);
        responseText = nextStateConfig.message;
        if (!matchedOption && nextStateId === currentSessionState && nextStateId !== 'inicio') {
          responseText = `Não entendi sua escolha. Por favor, selecione uma das opções abaixo:\n\n` + responseText;
        }
      }

      if (matchedProd) {
        recommendation = { id: matchedProd.id, action: action };
      }
    }

    saveMessage(session, activeTenantId, 'user', message);
    saveMessage(session, activeTenantId, 'assistant', responseText);

    // Fetch next state config options for UI buttons
    const sessionKey = `${activeTenantId}:${session}`;
    const currentSessionState = userStates.get(sessionKey) || 'inicio';
    const nextStateConfig = getFlowState(currentSessionState, activeTenantId);

    res.json({
      response: responseText,
      recommendation: recommendation,
      options: nextStateConfig.options.map(opt => ({ text: opt.text })),
      sessionId: session
    });
  } catch (error) {
    console.error('Erro no chatbot local:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/context/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const tenantId = parseInt(req.query.tenantId) || 1;
  const messages = getContextMessages(sessionId, tenantId, 8);
  res.json({ messages });
});

app.get('/products', (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  res.json({ products: getAllProducts(tenantId) });
});

app.get('/products/promos', (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  res.json({ products: getPromos(tenantId) });
});

app.get('/products/search', (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  const { q } = req.query;
  if (!q) {
    return res.json({ products: getAllProducts(tenantId) });
  }
  res.json({ products: searchProducts(q, tenantId) });
});

// Admin Product CRUD (Authenticated with JWT)
app.post('/api/admin/products', authMiddleware, (req, res) => {
  const { product } = req.body;
  const tenantId = req.tenantId;

  if (!product || !product.name) {
    return res.status(400).json({ error: 'Dados do produto são inválidos' });
  }

  const success = addOrUpdateProduct(product, tenantId);
  if (success) {
    return res.json({ success: true, products: getAllProducts(tenantId) });
  }
  return res.status(500).json({ error: 'Falha ao salvar produto no banco de dados' });
});

app.post('/api/admin/products/delete', authMiddleware, (req, res) => {
  const { id } = req.body;
  const tenantId = req.tenantId;

  if (!id) {
    return res.status(400).json({ error: 'ID do produto é obrigatório' });
  }

  const success = deleteProduct(parseInt(id), tenantId);
  if (success) {
    return res.json({ success: true, products: getAllProducts(tenantId) });
  }
  return res.status(500).json({ error: 'Falha ao deletar produto do banco de dados' });
});

app.get('/whatsapp', (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  let whatsappPhone = '5517996705407';
  let storeName = 'VouComprarFácil';
  
  if (global.db && !process.env.VERCEL) {
    const db = global.db;
    const stmt = db.prepare('SELECT store_name, whatsapp_phone FROM tenants WHERE id = ?');
    stmt.bind([tenantId]);
    if (stmt.step()) {
      const row = stmt.get();
      if (row[0]) storeName = row[0];
      if (row[1]) whatsappPhone = row[1];
    }
    stmt.free();
  } else if (global.tenantsMemory) {
    const tenant = global.tenantsMemory.find(t => t.id === tenantId);
    if (tenant) {
      storeName = tenant.store_name;
      whatsappPhone = tenant.whatsapp_phone;
    }
  }

  const { message, product } = req.query;
  let finalMessage = message || `Olá! Gostaria de falar com um consultor da ${storeName}. 🌟`;
  
  if (product) {
    finalMessage = `Olá! Gostaria de saber mais sobre o produto: ${product}\n\nPor favor, me envie o link para compra.`;
  }
  
  res.json({
    link: `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(finalMessage)}`,
    phone: whatsappPhone,
    businessName: storeName
  });
});

app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'manifest.json'));
});

app.get('/icon.png', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'icon.png'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'index.html'));
});

initDatabase()
  .then(() => {
    console.log('Banco de dados OK');
    if (process.env.VERCEL) {
      console.log('Rodando no Vercel (Serverless)');
    } else {
      const server = app.listen(PORT, HOST, () => {
        console.log(`Servidor rodando em http://${HOST}:${PORT}`);
      });
      server.on('error', (err) => console.error('Erro no servidor:', err));
    }
  })
  .catch(err => {
    console.error('Erro ao iniciar banco de dados:', err);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  });

module.exports = app;