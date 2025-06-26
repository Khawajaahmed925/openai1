# OpenAI Assistant Webhook Bridge

A robust Express.js server that bridges OpenAI Assistants with external webhooks, enabling seamless integration between AI agents and external tools/workflows.

## 🎯 Overview

This server acts as a middleware layer that:
- Runs OpenAI Assistants on the server side
- Detects and forwards tool calls to external webhook URLs
- Accepts webhook responses and forwards results back to OpenAI
- Provides a complete backend bridge for AI agent integrations

## 🏗️ Architecture

```
User Request → Express Server → OpenAI Assistant → Tool Calls → External Webhook
                     ↑                                              ↓
User Response ← Tool Outputs ← OpenAI Assistant ← Webhook Response ←
```

## 🚀 Quick Start

1. **Clone and Install**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Required Environment Variables**
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   ASSISTANT_ID=asst_your_assistant_id_here
   WEBHOOK_URL=https://your-webhook-service.com/webhook
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## 📡 API Endpoints

### POST /api/ask
Send a message to the OpenAI Assistant.

**Request:**
```json
{
  "message": "What's the weather in Berlin?"
}
```

**Response (Completed):**
```json
{
  "status": "completed",
  "message": "The weather in Berlin is sunny with 22°C.",
  "thread_id": "thread_abc123",
  "run_id": "run_def456"
}
```

**Response (Tool Calls Required):**
```json
{
  "status": "requires_action",
  "message": "Tool calls have been sent to external webhook",
  "thread_id": "thread_abc123",
  "run_id": "run_def456",
  "tool_calls": [
    {
      "id": "call_xyz789",
      "function": "get_weather",
      "arguments": { "location": "Berlin" }
    }
  ],
  "webhook_results": [
    {
      "toolCallId": "call_xyz789",
      "status": "sent",
      "response": {}
    }
  ]
}
```

### POST /api/webhook-response
Receive responses from external webhooks.

**Request:**
```json
{
  "tool_call_id": "call_xyz789",
  "output": "Weather data: 22°C, sunny",
  "thread_id": "thread_abc123",
  "run_id": "run_def456"
}
```

**Response:**
```json
{
  "status": "completed",
  "message": "Based on the weather data, Berlin is sunny with 22°C today.",
  "thread_id": "thread_abc123",
  "run_id": "run_def456"
}
```

### GET /api/status
Get server status and monitoring information.

**Response:**
```json
{
  "status": "running",
  "assistant_id": "asst_abc123",
  "pending_tool_calls": 2,
  "pending_calls": [
    {
      "toolCallId": "call_xyz789",
      "threadId": "thread_abc123",
      "runId": "run_def456",
      "functionName": "get_weather",
      "timestamp": 1640995200000
    }
  ]
}
```

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ | Your OpenAI API key |
| `ASSISTANT_ID` | ✅ | OpenAI Assistant ID |
| `WEBHOOK_URL` | ✅ | External webhook endpoint URL |
| `WEBHOOK_SECRET` | ❌ | Optional webhook authentication secret |
| `PORT` | ❌ | Server port (default: 3000) |
| `NODE_ENV` | ❌ | Environment (development/production) |
| `RATE_LIMIT_WINDOW_MS` | ❌ | Rate limit window (default: 15 minutes) |
| `RATE_LIMIT_MAX_REQUESTS` | ❌ | Max requests per window (default: 100) |

## 🔐 Security Features

- **Helmet.js**: Security headers and CSP
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Prevents abuse and DoS attacks
- **Input Validation**: Comprehensive request validation
- **Error Handling**: Secure error responses
- **Webhook Authentication**: Optional secret-based auth

## 🛠️ Webhook Integration

### Outgoing Webhook Payload
When tool calls are detected, the server sends:

```json
{
  "tool_call_id": "call_xyz789",
  "function_name": "get_weather",
  "arguments": {
    "location": "Berlin",
    "units": "celsius"
  },
  "thread_id": "thread_abc123",
  "run_id": "run_def456",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Webhook Headers
```
Content-Type: application/json
User-Agent: OpenAI-Assistant-Bridge/1.0
X-Webhook-Secret: [your_secret] (if configured)
```

### Expected Webhook Response
Your webhook should respond with the tool execution result:

```json
{
  "tool_call_id": "call_xyz789",
  "output": "Current weather in Berlin: 22°C, sunny skies",
  "thread_id": "thread_abc123",
  "run_id": "run_def456"
}
```

## 📊 Monitoring

- **Health Check**: `GET /health`
- **Status Endpoint**: `GET /api/status`
- **Structured Logging**: Request/response logging
- **Error Tracking**: Comprehensive error handling
- **Pending Call Cleanup**: Automatic cleanup of stale tool calls

## 🚀 Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Configure production CORS origins
- [ ] Set up proper logging infrastructure
- [ ] Configure reverse proxy (nginx/cloudflare)
- [ ] Set up monitoring and alerting
- [ ] Configure SSL/TLS certificates

### Docker Support
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Integration Examples

### Make.com/Integromat
1. Create a webhook scenario in Make.com
2. Set the webhook URL in your `.env` file
3. Configure your Make.com scenario to process the tool call payload
4. Return the result using the expected response format

### Zapier
1. Create a Zapier webhook trigger
2. Configure the webhook URL in your environment
3. Process the tool call data in your Zap
4. Use Zapier's webhook response to return results

### Custom Webhook Service
Implement your webhook endpoint to handle:
- Receive POST requests with tool call payloads
- Process the function calls with your business logic
- Return formatted responses to continue the conversation

## 📚 Error Handling

The server provides detailed error responses:

```json
{
  "error": "Missing required fields",
  "details": "Missing: tool_call_id, output"
}
```

Common error scenarios:
- Invalid OpenAI credentials
- Missing webhook configuration
- Tool call correlation failures
- Webhook timeout/connection errors
- Rate limit exceeded

## 🔄 Development

```bash
# Start development server with hot reloading
npm run dev

# Start production server
npm start

# Run tests (when implemented)
npm test
```

## 📝 License

This project is licensed under the MIT License.