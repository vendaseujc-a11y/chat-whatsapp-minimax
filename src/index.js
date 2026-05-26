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

app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message é obrigatório' });
    }

    const session = sessionId || 'default';
    const axios = require('axios');

    const contextMessages = getContextMessages(session, 15);
    
    const systemPrompt = {
      role: 'system',
      content: `Você é o assistente virtual da "${whatsappConfig.businessName}".
Sua principal função é atender clientes interessados em nossos produtos (suplementos esportivos como Whey Protein, Creatina, Pré-Treinos, etc.), explicando seus benefícios de forma entusiasmada, profissional e autoexplicativa.

REGRAS RÍGIDAS DE ATENDIMENTO:
1. NUNCA FORNEÇA PREÇOS na conversa. Se o cliente perguntar o preço ou valor, explique de forma educada e persuasiva que as condições e valores atualizados, junto com as melhores promoções e kits, estão descritos em detalhes no nosso catálogo oficial e que você pode disponibilizar o catálogo para ele.
2. DIÁLOGO AUTOEXPLICATIVO E PERSUASIVO: Quando o cliente mencionar um produto (ex: Whey Protein, Creatina), use sua inteligência para explicar de forma completa o que é o produto, quais são seus benefícios específicos (ganho de massa, energia, força, recuperação) e tire todas as dúvidas de forma entusiasmada e clara. Use emojis (✨🛍️💪⚡).
3. PROPOSTA FINAL (OFERTA DO CATÁLOGO): Quando o cliente demonstrar forte interesse, pedir informações de valores, ou indicar que deseja comprar, você deve obrigatoriamente propor o envio do catálogo completo.
   - Use uma pergunta como: "Você gostaria que eu te enviasse o nosso catálogo completo com todos os produtos e condições especiais?"
4. ENVIO DO LINK PARCEIRO: Quando o cliente concordar em receber o catálogo ou desejar concluir, envie o link do WhatsApp para que um de nossos parceiros consultores envie o catálogo imediatamente para ele.

Exemplo de frase final com link:
"Excelente escolha! 🌟 Vou te direcionar para um dos nossos parceiros que irá te enviar o catálogo completo agora mesmo. Clique aqui para falar com ele no WhatsApp: 👉 [LINK]"

LINK DO WHATSAPP PARCEIRO: ${generateWhatsAppLink('Olá! Gostaria de receber o catálogo de produtos da VouComprarFácil.')}
HORÁRIO DE ATENDIMENTO: ${whatsappConfig.hours}`
    };

    const messages = [
      systemPrompt,
      ...contextMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const API_KEY = process.env.OPENROUTER_API_KEY;
    console.log('API Key disponível:', !!API_KEY);
    if (!API_KEY) {
      return res.status(500).json({ error: 'API Key não configurada no servidor' });
    }
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openrouter/free',
        messages: messages
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://chat-minimax.vercel.app',
          'X-Title': 'Chat IA MiniMax'
        }
      }
    );

    const assistantResponse = response.data.choices[0].message.content;

    saveMessage(session, 'user', message);
    saveMessage(session, 'assistant', assistantResponse);

    res.json({
      response: assistantResponse,
      sessionId: session
    });
  } catch (error) {
    console.error('Erro no chat:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
      if (error.response.status === 429) {
        return res.status(429).json({ error: 'Limite de mensagens gratuitas da IA atingido (Erro 429 - Too Many Requests). Aguarde alguns instantes antes de enviar nova mensagem.' });
      }
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/context/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const messages = getContextMessages(sessionId, 15);
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