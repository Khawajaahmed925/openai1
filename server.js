const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const { errorHandler } = require('./middleware/validation');
const assistantRoutes = require('./routes/assistant');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: process.env.NODE_ENV === 'development' 
        ? ["'self'", "'unsafe-eval'"] // Allow unsafe-eval in development for WebContainer
        : ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] // Replace with your production domains
    : true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Webhook-Secret']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    error: 'Too many requests',
    details: 'Rate limit exceeded. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing middleware with error handling
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      console.error('Invalid JSON in request body:', e.message);
      const error = new Error('Invalid JSON in request body');
      error.status = 400;
      throw error;
    }
  }
}));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
  
  // Log request body for API endpoints (but not for static files)
  if (req.path.startsWith('/api') && req.method !== 'GET') {
    console.log('Request body:', req.body);
  }
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const response = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.server.nodeEnv
  };
  
  console.log('Health check response:', response);
  res.json(response);
});

// API routes
app.use('/api', assistantRoutes);

// Serve chat interface at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API documentation endpoint
app.get('/api-docs', (req, res) => {
  const response = {
    name: 'OpenAI Assistant Webhook Bridge',
    version: '1.0.0',
    description: 'Express.js server bridging OpenAI Assistants with external webhooks',
    endpoints: {
      health: 'GET /health - Server health check',
      ask: 'POST /api/ask - Send message to OpenAI Assistant',
      webhookResponse: 'POST /api/webhook-response - Receive webhook responses',
      status: 'GET /api/status - Get server status and pending tool calls'
    },
    documentation: {
      askEndpoint: {
        method: 'POST',
        path: '/api/ask',
        body: {
          message: 'string (required) - User message to send to assistant'
        },
        responses: {
          completed: 'Assistant completed without tool calls',
          requires_action: 'Tool calls sent to webhook, waiting for responses'
        }
      },
      webhookEndpoint: {
        method: 'POST',
        path: '/api/webhook-response',
        body: {
          tool_call_id: 'string (required) - ID of the tool call',
          output: 'string (required) - Result from webhook execution',
          thread_id: 'string (required) - OpenAI thread ID',
          run_id: 'string (required) - OpenAI run ID'
        }
      }
    }
  };
  
  console.log('API docs response:', response);
  res.json(response);
});

// 404 handler
app.use('*', (req, res) => {
  const response = {
    error: 'Endpoint not found',
    details: `Cannot ${req.method} ${req.originalUrl}`,
    availableEndpoints: [
      'GET / - Chat interface',
      'GET /health - Health check',
      'GET /api-docs - API documentation',
      'POST /api/ask - Send message to assistant',
      'POST /api/webhook-response - Receive webhook responses',
      'GET /api/status - Server status'
    ]
  };
  
  console.log('404 response:', response);
  res.status(404).json(response);
});

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handling
const server = app.listen(config.server.port, () => {
  console.log('\n🚀 OpenAI Assistant Webhook Bridge Server Started');
  console.log('='.repeat(50));
  console.log(`📍 Server running on port: ${config.server.port}`);
  console.log(`🌍 Environment: ${config.server.nodeEnv}`);
  console.log(`🤖 Assistant ID: ${config.openai.assistantId}`);
  console.log(`🔗 Webhook URL: ${config.webhook.url}`);
  console.log(`⚡ Rate limit: ${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000}s`);
  console.log('='.repeat(50));
  console.log('\n📚 Available endpoints:');
  console.log(`   GET  / - Chat interface`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /api-docs - API documentation`);
  console.log(`   GET  /api/status - Server status`);
  console.log(`   POST /api/ask - Send message to assistant`);
  console.log(`   POST /api/webhook-response - Receive webhook responses`);
  console.log('\n✅ Server ready to accept connections');
  console.log(`🎯 Open your browser to: http://localhost:${config.server.port}\n`);
});

// Cleanup pending tool calls every 15 minutes
const WebhookHandler = require('./services/webhook-handler');
let webhookHandler;

try {
  webhookHandler = new WebhookHandler();
  setInterval(() => {
    webhookHandler.cleanupPendingCalls();
  }, 15 * 60 * 1000);
} catch (error) {
  console.warn('Could not initialize webhook handler for cleanup:', error.message);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process in production, but log the error
  if (config.server.nodeEnv !== 'production') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Exit the process as this is a serious error
  process.exit(1);
});

module.exports = app;