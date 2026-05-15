require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getContextMessages, saveMessage } = require('./config/database');
const { products, getAllProducts, getPromos, searchProducts } = require('./config/products');
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

COMO FUNCIONA NOSSA VENDA:
1. O cliente pergunta sobre um produto ou diz o nome do produto que quer
2. Você oferece o LINK DO PRODUTO via WhatsApp
3. O cliente clica no link e compra diretamente

REGRAS IMPORTANTES:
1. Quando o cliente perguntar sobre qualquer produto, ofereça o link de compra
2. Sempre pergunte: "Posso te enviar o link para compra direta?"
3. Use o botão/link do WhatsApp para enviar o link do produto
4. Seja rápido e direto nas respostas
5. Use emojis para deixar o chat mais agradável
6. Quando não souber o produto, diga que vai verificar e enviar o link

WHATSAPP: ${generateWhatsAppLink('')}
HORÁRIO: ${whatsappConfig.hours}

Exemplo de resposta quando cliente quer um produto:
"Claro! Posso te enviar o link direto para compra. É só clicar e pagar pelo WhatsApp! 👉 [LINK]"

Sempre ofereça o link do WhatsApp quando o cliente demonstrar interesse em comprar algo!`
    };

    const messages = [
      systemPrompt,
      ...contextMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const API_KEY = process.env.OPENROUTER_API_KEY;
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'minimax/minimax-m2.5:free',
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
  res.sendFile(path.join(__dirname, '..', 'index.html'));
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
    const server = app.listen(PORT, HOST, () => {
      console.log(`Servidor rodando em http://${HOST}:${PORT}`);
    });
    server.on('error', (err) => console.error('Erro no servidor:', err));
  })
  .catch(err => {
    console.error('Erro ao iniciar banco de dados:', err);
    process.exit(1);
  });