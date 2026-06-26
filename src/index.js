require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getTenantByEmail, getTenantById, createTenant, updateTenant, getContextMessages, saveMessage, hashPassword: dbHashPassword } = require('./config/database');
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

// Sync Offline/Local Storage data (lightweight – just acknowledge)
app.post('/api/sync', (req, res) => {
  res.json({ success: true });
});

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  const { email, password, store_name, whatsapp_phone } = req.body;
  if (!email || !password || !store_name || !whatsapp_phone) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    // Check if email already exists
    const existing = await getTenantByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado' });
    }

    const passwordHash = hashPassword(password);
    const welcomeMessage = `Olá! Seja muito bem-vindo à **${store_name}**! 🛍️✨\n\nSou seu consultor virtual inteligente. O que você procura hoje?\n\nPor favor, escolha uma das opções abaixo ou me diga com suas palavras! 😊`;

    const tenantObj = await createTenant({
      email,
      password_hash: passwordHash,
      store_name,
      whatsapp_phone,
      welcome_message: welcomeMessage
    });

    if (!tenantObj) {
      return res.status(500).json({ error: 'Falha ao criar conta' });
    }

    const token = generateToken(tenantObj.id);
    res.json({ success: true, token, tenantId: tenantObj.id, tenant: tenantObj });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }

  try {
    const tenant = await getTenantByEmail(email);
    if (tenant && verifyPassword(password, tenant.password_hash)) {
      const token = generateToken(tenant.id);
      return res.json({ success: true, token, tenantId: tenant.id, tenant });
    }
    return res.status(401).json({ error: 'Credenciais inválidas' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Store settings API
app.get('/api/store/settings/:tenantId', async (req, res) => {
  const tenantId = parseInt(req.params.tenantId) || 1;

  try {
    const tenant = await getTenantById(tenantId);
    if (tenant) {
      return res.json({
        id: tenant.id,
        store_name: tenant.store_name,
        whatsapp_phone: tenant.whatsapp_phone,
        welcome_message: tenant.welcome_message
      });
    }
    return res.status(404).json({ error: 'Loja não encontrada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/store/settings', authMiddleware, async (req, res) => {
  const { store_name, whatsapp_phone, welcome_message } = req.body;
  const tenantId = req.tenantId;

  if (!store_name || !whatsapp_phone) {
    return res.status(400).json({ error: 'Nome da loja e WhatsApp são obrigatórios' });
  }

  try {
    const result = await updateTenant(tenantId, {
      store_name,
      whatsapp_phone,
      welcome_message: welcome_message || ''
    });

    if (result) {
      return res.json({ success: true, message: 'Configurações atualizadas com sucesso' });
    }
    return res.status(404).json({ error: 'Loja não encontrada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const userStates = new Map();

async function getFlowState(stateId, tenantId = 1) {
  let welcomeMsg = `Olá! Seja muito bem-vindo! 🛍️✨\n\nSou seu consultor virtual inteligente. O que você procura hoje?\n\nPor favor, escolha uma das opções abaixo ou me diga com suas palavras! 😊`;
  let whatsappPhone = '5517996705407';

  const tenant = await getTenantById(tenantId);
  if (tenant) {
    welcomeMsg = tenant.welcome_message || welcomeMsg;
    whatsappPhone = tenant.whatsapp_phone || whatsappPhone;
  }

  const generateWhatsAppLink = (text) => `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}`;

  const products = await getAllProducts(tenantId);
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
  const catEmojis = {
    'Proteínas': '🥩',
    'Força': '💪',
    'Energia': '⚡',
    'Recuperação': '💊',
    'Emagrecimento': '🔥',
    'Produtos gerais': '📦',
    'mercado': '🛒',
    'lojas do comercio': '🏪'
  };

  const flowTree = {
    inicio: {
      message: welcomeMsg,
      options: [
        { text: "Ver Categorias de Produtos 🛍️", nextState: "categorias" },
        { text: "Ver Promoções Ativas 🔥", nextState: "promocoes" },
        { text: "Falar com Consultor / Comprar 🛒", nextState: "falar_vendedor" },
        { text: "Informações de Entrega 📦", nextState: "entrega" }
      ]
    },
    categorias: {
      message: `Escolha qual categoria de produtos você gostaria de explorar hoje:`,
      options: [
        ...categories.map(cat => ({ text: `${cat} ${catEmojis[cat] || '📦'}`, nextState: `cat_${cat}` })),
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    },
    entrega: {
      message: `📦 **Informações de Entrega:**\n\n- **Prazo de Envio:** Todos os pedidos são despachados em até 24 horas úteis!\n- **Frete:** Temos condições de frete grátis dependendo da sua região e do valor do pedido (consulte o vendedor).\n- **Embalagem:** Enviamos tudo em caixas discretas e super seguras.\n\nComo gostaria de prosseguir?`,
      options: [
        { text: "Ver Categorias de Produtos 🛍️", nextState: "categorias" },
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
    const catProducts = products.filter(p => p.category.toLowerCase() === categoryName.toLowerCase());
    let messageText = `📦 **Produtos de ${categoryName} disponíveis:**\n\n`;
    if (catProducts.length === 0) {
      messageText += `Nenhum produto cadastrado nesta categoria no momento.`;
    } else {
      catProducts.forEach(p => {
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
    const promos = await getPromos(tenantId);
    let messageText = `🔥 **Produtos em Promoção no momento:**\n\n`;
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

    // Fetch products and store settings from Supabase
    const products = await getAllProducts(activeTenantId);
    const tenant = await getTenantById(activeTenantId);
    let storeName = tenant ? tenant.store_name : 'VouComprarFácil';
    let welcomeMessage = tenant ? tenant.welcome_message : '';
    let whatsappPhone = tenant ? tenant.whatsapp_phone : '5517996705407';

    let responseText = '';
    let recommendation = null;

    if (process.env.OPENROUTER_API_KEY) {
      // 1. OpenRouter AI recommendation flow
      const contextMessages = getContextMessages(session, activeTenantId, 10);
      const productCatalog = products.map(p =>
        `- ID: ${p.id}, Nome: ${p.name}, Categoria: ${p.category}, Preço: R$ ${parseFloat(p.price).toFixed(2)}, Estoque: ${p.stock}, Descrição: ${p.description}`
      ).join('\n');

      const systemPrompt = `Você é o assistente virtual oficial e consultor de vendas inteligente da loja "${storeName}".

COMPORTAMENTO DE VENDEDOR UNIVERSAL:
- Você é 100% GENÉRICO E ADAPTÁVEL a qualquer tipo de comércio (Roupas, Eletrônicos, Cosméticos, Suplementos, Autopeças, etc.).
- Você não assume o nicho da loja previamente; você descobre o que a loja vende analisando dinamicamente o catálogo de produtos abaixo.
- Seu tom de voz deve ser amigável, focado em conversão e prestativo, adaptando-se perfeitamente ao contexto do produto que o cliente busca.
- Sua abordagem de início ou recepção de conversa deve focar sempre na pergunta: "O que você procura hoje?".

Abaixo está o catálogo atualizado em tempo real da loja com os produtos cadastrados no banco de dados:
${productCatalog}

DIRETRIZES DE RECOMENDAÇÃO E BUSCA INTELIGENTE:
1. Lógica de Busca Ampla: Sempre que o cliente pedir uma recomendação, perguntar se tem algo em estoque, ou falar sobre uma necessidade (ex: "preciso de um presente para minha mãe", "quero algo para correr", "estou procurando uma blusa preta", "algo para o frio"), simule a chamada da função 'buscarNoEstoque' varrendo mentalmente o catálogo acima. Busque correspondências no NOME do produto, na CATEGORIA ou dentro da DESCRIÇÃO técnica dos itens.
2. Recomendação por Match de Contexto:
   - Se o produto exato estiver disponível: Apresente-o destacando o nome, o valor e use um argumento de venda baseado na própria descrição que o lojista cadastrou.
   - Se o cliente citar uma necessidade e o produto correspondente for encontrado via descrição ou categoria, faça a ponte lógica. Exemplo: Se o cliente quer "algo para frio" e encontra um casaco cuja descrição diz "ideal para o inverno", conecte esses pontos de forma persuasiva na sua resposta.
   - Se houver variações (tamanhos, cores, voltagem) listadas na descrição ou nos atributos do produto, pergunte a preferência do cliente: "Temos o [Produto] disponível! Qual tamanho/cor/voltagem você prefere?".
3. Se o produto estiver esgotado (Estoque == 0), avise educadamente que esgotou devido à alta procura e sugira imediatamente outro produto similar ou complementar do catálogo que tenha estoque disponível.
4. Fechamento de Venda Proativo: Nunca termine uma recomendação sem um próximo passo claro de call-to-action (CTA). Sempre termine perguntando: "Gostaria que eu adicionasse este item ao seu carrinho?" ou "Posso reservar este para você?".
5. Nunca cite preços que divirjam do catálogo acima e não invente produtos fora do catálogo.

Sempre que indicar ou recomendar um produto, adicione obrigatoriamente a tag JSON no final da resposta:
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
        await processFallbackHeuristics();
      }
    } else {
      await processFallbackHeuristics();
    }

    async function processFallbackHeuristics() {
      // 2. Rule-based local heuristic search fallback
      const lowerMsg = message.toLowerCase();
      let matchedProd = null;
      let action = 'highlight';

      if (lowerMsg.includes('comprar') || lowerMsg.includes('levar') || lowerMsg.includes('adicionar') || lowerMsg.includes('carrinho') || lowerMsg.includes('quero um') || lowerMsg.includes('pegar') || lowerMsg.includes('checkout')) {
        action = 'add_to_cart';
      }

      // Check if user is searching for a specific product by name
      matchedProd = products.find(p => lowerMsg.includes(p.name.toLowerCase()) && p.stock > 0);

      if (!matchedProd) {
        // Try finding by category match
        matchedProd = products.find(p => lowerMsg.includes(p.category.toLowerCase()) && p.stock > 0);
      }

      if (matchedProd) {
        responseText = `Com certeza! O **${matchedProd.name}** (${matchedProd.category}) é uma excelente escolha! 🛍️✨\n\n${matchedProd.description}\n\nO valor de tabela é R$ ${parseFloat(matchedProd.price).toFixed(2)}. ${action === 'add_to_cart' ? 'Estou adicionando ao seu carrinho agora mesmo!' : 'Gostaria que eu adicionasse ao seu carrinho?'}`;
      } else {
        // Default session state/menu flow
        const sessionKey = `${activeTenantId}:${session}`;
        const currentSessionState = userStates.get(sessionKey) || 'inicio';
        let nextStateId = null;
        const currentStateConfig = await getFlowState(currentSessionState, activeTenantId);

        const matchedOption = currentStateConfig.options.find(opt => {
          const optionTextClean = opt.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          const inputTextClean = message.toLowerCase().replace(/[^a-z0-9]/g, '');
          return optionTextClean.includes(inputTextClean) || inputTextClean.includes(optionTextClean);
        });

        if (matchedOption) {
          nextStateId = matchedOption.nextState;
        } else {
          // Fuzzy match on product description words
          const fuzzyProd = products.find(p => p.description.toLowerCase().split(' ').some(word => word.length > 3 && lowerMsg.includes(word)) && p.stock > 0);
          if (fuzzyProd) {
            matchedProd = fuzzyProd;
            responseText = `Acho que encontrei algo para você! O **${matchedProd.name}** pode ser exatamente o que você procura. 🛍️✨\n\n${matchedProd.description}\n\nPreço: R$ ${parseFloat(matchedProd.price).toFixed(2)}. Gostaria de adicionar ao carrinho?`;
          } else {
            nextStateId = currentSessionState;
          }
        }

        if (!matchedProd) {
          userStates.set(sessionKey, nextStateId);
          const nextStateConfig = await getFlowState(nextStateId, activeTenantId);
          responseText = nextStateConfig.message;
          if (!matchedOption && nextStateId === currentSessionState && nextStateId !== 'inicio') {
            responseText = `Não entendi sua escolha. Por favor, selecione uma das opções abaixo:\n\n` + responseText;
          }
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
    const nextStateConfig = await getFlowState(currentSessionState, activeTenantId);

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

app.get('/products', async (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  const products = await getAllProducts(tenantId);
  res.json({ products });
});

app.get('/products/promos', async (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  const promos = await getPromos(tenantId);
  res.json({ products: promos });
});

app.get('/products/search', async (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  const { q } = req.query;
  if (!q) {
    const all = await getAllProducts(tenantId);
    return res.json({ products: all });
  }
  const results = await searchProducts(q, tenantId);
  res.json({ products: results });
});

// Admin Product CRUD (Authenticated with JWT)
app.post('/api/admin/products', authMiddleware, async (req, res) => {
  const { product } = req.body;
  const tenantId = req.tenantId;

  if (!product || !product.name) {
    return res.status(400).json({ error: 'Dados do produto são inválidos' });
  }

  const success = await addOrUpdateProduct(product, tenantId);
  if (success) {
    const products = await getAllProducts(tenantId);
    return res.json({ success: true, products });
  }
  return res.status(500).json({ error: 'Falha ao salvar produto no banco de dados' });
});

app.post('/api/admin/products/delete', authMiddleware, async (req, res) => {
  const { id } = req.body;
  const tenantId = req.tenantId;

  if (!id) {
    return res.status(400).json({ error: 'ID do produto é obrigatório' });
  }

  const success = await deleteProduct(parseInt(id), tenantId);
  if (success) {
    const products = await getAllProducts(tenantId);
    return res.json({ success: true, products });
  }
  return res.status(500).json({ error: 'Falha ao deletar produto do banco de dados' });
});

app.get('/whatsapp', async (req, res) => {
  const tenantId = parseInt(req.query.tenantId) || 1;
  let whatsappPhone = '5517996705407';
  let storeName = 'VouComprarFácil';

  const tenant = await getTenantById(tenantId);
  if (tenant) {
    storeName = tenant.store_name || storeName;
    whatsappPhone = tenant.whatsapp_phone || whatsappPhone;
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