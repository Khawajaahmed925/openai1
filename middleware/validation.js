/**
 * Validation middleware for API requests
 */

const validateAskRequest = (req, res, next) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({
      error: 'Missing or invalid message field',
      details: 'Message must be a non-empty string'
    });
  }

  if (message.length > 4000) {
    return res.status(400).json({
      error: 'Message too long',
      details: 'Message must be less than 4000 characters'
    });
  }

  next();
};

const validateWebhookResponse = (req, res, next) => {
  const { tool_call_id, output, thread_id, run_id } = req.body;

  const requiredFields = [
    { field: 'tool_call_id', value: tool_call_id },
    { field: 'output', value: output },
    { field: 'thread_id', value: thread_id },
    { field: 'run_id', value: run_id }
  ];

  const missingFields = requiredFields.filter(item => !item.value);

  if (missingFields.length > 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      details: `Missing: ${missingFields.map(f => f.field).join(', ')}`
    });
  }

  // Validate field types
  if (typeof tool_call_id !== 'string' || typeof thread_id !== 'string' || typeof run_id !== 'string') {
    return res.status(400).json({
      error: 'Invalid field types',
      details: 'tool_call_id, thread_id, and run_id must be strings'
    });
  }

  next();
};

const errorHandler = (err, req, res, next) => {
  console.error('=== API ERROR ===');
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  console.error('Request URL:', req.url);
  console.error('Request Method:', req.method);
  console.error('Request Body:', req.body);

  // Ensure we always send JSON responses
  res.setHeader('Content-Type', 'application/json');

  // Prevent sending response if already sent
  if (res.headersSent) {
    console.error('Headers already sent, cannot send error response');
    return next(err);
  }

  // Default error response
  let statusCode = 500;
  let message = 'Internal server error';
  let details = null;

  // Handle specific error types
  if (err.message.includes('OpenAI API authentication failed')) {
    statusCode = 401;
    message = 'Authentication error';
    details = 'OpenAI API key is invalid or missing. Please check your configuration.';
  } else if (err.message.includes('OpenAI API rate limit exceeded')) {
    statusCode = 429;
    message = 'Rate limit exceeded';
    details = 'Too many requests to OpenAI API. Please try again later.';
  } else if (err.message.includes('Failed to create conversation thread')) {
    statusCode = 503;
    message = 'Service temporarily unavailable';
    details = 'Unable to connect to OpenAI services';
  } else if (err.message.includes('Failed to run assistant')) {
    statusCode = 502;
    message = 'Assistant service error';
    details = 'Unable to process request with AI assistant';
  } else if (err.message.includes('No pending tool call found')) {
    statusCode = 404;
    message = 'Tool call not found';
    details = err.message;
  } else if (err.message.includes('mismatch')) {
    statusCode = 400;
    message = 'Request correlation error';
    details = err.message;
  } else if (err.message.includes('not properly configured')) {
    statusCode = 503;
    message = 'Service configuration error';
    details = 'Server is not properly configured. Please check environment variables.';
  } else if (err.message.includes('timeout')) {
    statusCode = 408;
    message = 'Request timeout';
    details = 'The request took too long to process. Please try again.';
  }

  const errorResponse = {
    error: message,
    details: details || (process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'),
    timestamp: new Date().toISOString()
  };

  console.error('Sending error response:', errorResponse);

  try {
    res.status(statusCode).json(errorResponse);
  } catch (sendError) {
    console.error('Failed to send error response:', sendError);
    // Last resort - try to send a basic response
    try {
      res.status(500).end('{"error":"Internal server error","details":"Failed to send proper error response"}');
    } catch (finalError) {
      console.error('Complete failure to send any response:', finalError);
    }
  }
};

module.exports = {
  validateAskRequest,
  validateWebhookResponse,
  errorHandler
};