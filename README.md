# Chat Backend - MiniMax M2 via OpenRouter

## Configuração

1. Instale as dependências:
```bash
npm install
```

2. Configure a API Key do OpenRouter em `.env`:
```
OPENROUTER_API_KEY=sua_chave_aqui
```

## Uso

Inicie o servidor:
```bash
npm start
```

## Endpoints

### Enviar mensagem
```bash
POST /chat
{
  "message": "Olá, como você está?",
  "sessionId": "usuario_123"
}
```

### Ver contexto
```bash
GET /chat/context/usuario_123
```