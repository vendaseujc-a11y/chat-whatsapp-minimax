require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getContextMessages, saveMessage } = require('./config/database');

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
    
    const messages = [
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
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Chat Backend'
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/context/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const messages = getContextMessages(sessionId, 15);
  res.json({ messages });
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