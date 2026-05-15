const express = require('express');
const router = express.Router();
const { getContextMessages, saveMessage } = require('../config/database');
const { chat } = require('../services/openrouter');

router.post('/', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message é obrigatório' });
    }

    const session = sessionId || 'default';

    const contextMessages = getContextMessages(session, 15);
    
    const messages = [
      ...contextMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const assistantResponse = await chat(messages);

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

router.get('/context/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const messages = getContextMessages(sessionId, 15);
  res.json({ messages });
});

module.exports = router;