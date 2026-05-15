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

if (process.env.VERCEL) {
  process.env.VERCEL = '1';
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

app.use(express.static('.'));

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
      content: `Você é um assistente de vendas do "${whatsappConfig.businessName}". Seu objetivo é vender os produtos do comércio e proporcionar uma excelente experiência ao cliente.

CATÁLOGO DE PRODUTOS:
${products.map(p => `${p.image} ${p.name} - R$ ${p.price.toFixed(2).replace('.', ',')} - ${p.description}${p.promo ? ' 🔥 PROMOÇÃO!' : ''}`).join('\n')}

REGRAS IMPORTANTES:
1. Sempre mostre os produtos relevantes quando o cliente perguntar ou procurar algo
2. Destaque as promoções do dia (itens com 🔥)
3. Quando o cliente demonstrar interesse em um produto, ofereça para finalizar o pedido via WhatsApp
4. Use o link do WhatsApp para finalizar vendas: ${generateWhatsAppLink('')}
5. Ofereça entrega ou retirada na loja
6. Informe sobre formas de pagamento disponíveis
7. Seja persuasivo mas não insistente
8. Use emojis para tornar o atendimento mais agradável

HORÁRIO DE FUNCIONAMENTO: ${whatsappConfig.hours}
ENDEREÇO: ${whatsappConfig.address}

Quando o cliente quiser comprar ou solicitar mais informações sobre um produto, redirecione para o WhatsApp com uma mensagem personalizada.`
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
  const { product } = req.query;
  let message = whatsappConfig.defaultMessage;
  
  if (product) {
    const prod = products.find(p => p.id === parseInt(product));
    if (prod) {
      message = `Olá! Gostaria de pedir:\n\n${prod.image} *${prod.name}*\nValor: R$ ${prod.price.toFixed(2).replace('.', ',')}\n\nPor favor, confirme o pedido.`;
    }
  }
  
  res.json({
    link: generateWhatsAppLink(message),
    phone: whatsappConfig.phoneNumber,
    businessName: whatsappConfig.businessName,
    hours: whatsappConfig.hours,
    address: whatsappConfig.address
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