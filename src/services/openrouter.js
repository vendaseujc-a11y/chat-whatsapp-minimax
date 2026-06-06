const axios = require('axios');

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
const BASE_URL = 'https://openrouter.ai/api/v1';

async function chat(messages) {
  if (!API_KEY) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
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

    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      throw new Error(`Erro da API: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Erro na requisição: ${error.message}`);
  }
}

module.exports = { chat };