require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getContextMessages, saveMessage } = require('./config/database');
const { getAllProducts, getPromos, searchProducts, addOrUpdateProduct, deleteProduct } = require('./config/products');
const { whatsappConfig, generateWhatsAppLink } = require('./config/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

app.use(express.static('.'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const userStates = new Map();

function getFlowState(stateId) {
  const flowTree = {
    inicio: {
      message: `Olá! Seja muito bem-vindo à **VouComprarFácil**! ⚡💪\n\nSou seu consultor virtual inteligente especializado em suplementação esportiva de alto rendimento. Estou aqui para te ajudar a encontrar os melhores produtos para alcançar o shape dos seus sonhos!\n\nPor favor, escolha uma das opções abaixo para começarmos:`,
      options: [
        { text: "Ver Categorias de Suplementos 💪", nextState: "categorias" },
        { text: "Ver Promoções Ativas 🔥", nextState: "promocoes" },
        { text: "Falar com Consultor / Comprar 🛒", nextState: "falar_vendedor" },
        { text: "Informações de Entrega 📦", nextState: "entrega" }
      ]
    },
    categorias: {
      message: `Escolha qual categoria de suplementos você gostaria de explorar hoje:`,
      options: [
        { text: "Proteínas 🥩", nextState: "cat_Proteínas" },
        { text: "Força 💪", nextState: "cat_Força" },
        { text: "Energia ⚡", nextState: "cat_Energia" },
        { text: "Recuperação 💊", nextState: "cat_Recuperação" },
        { text: "Emagrecimento 🔥", nextState: "cat_Emagrecimento" },
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    },
    entrega: {
      message: `📦 **Informações de Entrega VouComprarFácil:**\n\n- **Prazo de Envio:** Todos os pedidos são despachados em até 24 horas úteis!\n- **Frete:** Temos condições de frete grátis dependendo da sua região e do valor do pedido (consulte o vendedor).\n- **Embalagem:** Enviamos tudo em caixas discretas e super seguras para garantir a integridade dos seus suplementos.\n\nComo gostaria de prosseguir?`,
      options: [
        { text: "Ver Categorias de Suplementos 💪", nextState: "categorias" },
        { text: "Falar com Consultor 🛒", nextState: "falar_vendedor" },
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    },
    falar_vendedor: {
      message: `Perfeito! ✨ Nossos consultores especializados estão prontos para te atender, tirar dúvidas técnicas e garantir as melhores condições e kits com descontos progressivos!\n\nClique no botão verde abaixo para falar direto com o nosso consultor no WhatsApp:\n\n👉 [Falar com Consultor](${generateWhatsAppLink('Olá! Estava tirando dúvidas no chat da VouComprarFácil e gostaria de falar com um consultor para finalizar meu pedido.')})`,
      options: [
        { text: "Voltar ao Menu Principal 🔄", nextState: "inicio" }
      ]
    }
  };

  if (stateId.startsWith('cat_')) {
    const categoryName = stateId.replace('cat_', '');
    const products = getAllProducts().filter(p => p.category === categoryName);
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
    const promos = getPromos();
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
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message é obrigatório' });
    }

    const session = sessionId || 'default';
    const currentSessionState = userStates.get(session) || 'inicio';

    let nextStateId = null;
    const currentStateConfig = getFlowState(currentSessionState);

    // Find option match
    const matchedOption = currentStateConfig.options.find(opt => {
      const optionTextClean = opt.text.toLowerCase().replace(/[^a-z0-9]/g, '');
      const inputTextClean = message.toLowerCase().replace(/[^a-z0-9]/g, '');
      return optionTextClean.includes(inputTextClean) || inputTextClean.includes(optionTextClean);
    });

    if (matchedOption) {
      nextStateId = matchedOption.nextState;
    } else {
      // Global keyword match fallback
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes('inicio') || lowerMsg.includes('oi') || lowerMsg.includes('olá') || lowerMsg.includes('ola') || lowerMsg.includes('começar') || lowerMsg.includes('reset') || lowerMsg.includes('menu')) {
        nextStateId = 'inicio';
      } else if (lowerMsg.includes('categoria') || lowerMsg.includes('produto') || lowerMsg.includes('suplemento')) {
        nextStateId = 'categorias';
      } else if (lowerMsg.includes('promo') || lowerMsg.includes('desconto') || lowerMsg.includes('oferta')) {
        nextStateId = 'promocoes';
      } else if (lowerMsg.includes('vendedor') || lowerMsg.includes('comprar') || lowerMsg.includes('preco') || lowerMsg.includes('preço') || lowerMsg.includes('falar')) {
        nextStateId = 'falar_vendedor';
      } else if (lowerMsg.includes('entrega') || lowerMsg.includes('frete') || lowerMsg.includes('prazo')) {
        nextStateId = 'entrega';
      } else {
        // Keep same state if unrecognized
        nextStateId = currentSessionState;
      }
    }

    userStates.set(session, nextStateId);
    const nextStateConfig = getFlowState(nextStateId);

    let responseMessage = nextStateConfig.message;
    if (!matchedOption && nextStateId === currentSessionState && nextStateId !== 'inicio') {
      responseMessage = `Não entendi sua escolha. Por favor, selecione uma das opções abaixo:\n\n` + responseMessage;
    }

    saveMessage(session, 'user', message);
    saveMessage(session, 'assistant', responseMessage);

    res.json({
      response: responseMessage,
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
  const messages = getContextMessages(sessionId, 8);
  res.json({ messages });
});

app.get('/products', (req, res) => {
  res.json({ products: getAllProducts() });
});

app.get('/products/promos', (req, res) => {
  res.json({ products: getPromos() });
});

app.get('/products/search', (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.json({ products: getAllProducts() });
  }
  res.json({ products: searchProducts(q) });
});

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'VOUPRO9988';

// Admin login verification endpoint
app.post('/api/admin/verify', (req, res) => {
  const { passcode } = req.body;
  if (passcode === ADMIN_PASSCODE) {
    return res.json({ success: true, message: 'Autenticado com sucesso' });
  }
  return res.status(401).json({ error: 'Código de acesso incorreto' });
});

// Admin save or update product
app.post('/api/admin/products', (req, res) => {
  const { passcode, product } = req.body;
  if (passcode !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: 'Código de acesso incorreto' });
  }

  if (!product || !product.name) {
    return res.status(400).json({ error: 'Dados do produto são inválidos' });
  }

  const success = addOrUpdateProduct(product);
  if (success) {
    // Attempt auto git-push locally so that Vercel automatically deploys updates
    if (!process.env.VERCEL) {
      const { exec } = require('child_process');
      exec('git add src/config/products.json && git commit -m "chore: update products database via admin console" && git push', (err, stdout, stderr) => {
        if (err) console.error('[Auto-push Error]', err);
        else console.log('[Auto-push Success]', stdout);
      });
    }

    return res.json({ success: true, products: getAllProducts() });
  }
  return res.status(500).json({ error: 'Falha ao salvar produto no banco de dados' });
});

// Admin delete product
app.post('/api/admin/products/delete', (req, res) => {
  const { passcode, id } = req.body;
  if (passcode !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: 'Código de acesso incorreto' });
  }

  if (!id) {
    return res.status(400).json({ error: 'ID do produto é obrigatório' });
  }

  const success = deleteProduct(parseInt(id));
  if (success) {
    // Attempt auto git-push locally so that Vercel automatically deploys updates
    if (!process.env.VERCEL) {
      const { exec } = require('child_process');
      exec('git add src/config/products.json && git commit -m "chore: remove product from database via admin console" && git push', (err, stdout, stderr) => {
        if (err) console.error('[Auto-push Error]', err);
        else console.log('[Auto-push Success]', stdout);
      });
    }

    return res.json({ success: true, products: getAllProducts() });
  }
  return res.status(500).json({ error: 'Falha ao deletar produto do banco de dados' });
});

app.get('/whatsapp', (req, res) => {
  const { message, product } = req.query;
  let finalMessage = message || whatsappConfig.defaultMessage;
  
  if (product) {
    finalMessage = `Olá! Gostaria de saber mais sobre o produto: ${product}\n\nPor favor, me envie o link para compra.`;
  }
  
  res.json({
    link: generateWhatsAppLink(finalMessage),
    phone: whatsappConfig.phoneNumber,
    businessName: whatsappConfig.businessName,
    hours: whatsappConfig.hours,
    address: whatsappConfig.address
  });
});

app.post('/whatsapp/link', (req, res) => {
  const { product } = req.body;
  let message = whatsappConfig.defaultMessage;
  
  if (product) {
    message = `Olá! Tenho interesse no produto: ${product}\nPor favor, me envie o link para compra.`;
  }
  
  res.json({
    link: generateWhatsAppLink(message)
  });
});

app.get('/', (req, res) => {
  const possiblePaths = [
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(process.cwd(), 'index.html')
  ];
  
  for (const p of possiblePaths) {
    try {
      const fs = require('fs');
      if (fs.existsSync(p)) {
        return res.sendFile(p);
      }
    } catch(e) {}
  }
  res.status(500).send('index.html não encontrado');
});

app.get('/api', (req, res) => {
  res.json({ 
    status: 'online',
    endpoints: {
      chat: 'POST /chat - Enviar mensagem',
      context: 'GET /chat/context/:sessionId - Ver contexto'
    }
  });
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