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

  console.log('🔍 Validating webhook response:', {
    tool_call_id: tool_call_id || 'MISSING',
    output_length: output ? output.length : 'MISSING',
    thread_id: thread_id || 'MISSING',
    run_id: run_id || 'MISSING'
  });

  // ENHANCED: Check for empty strings as well as missing values
  const requiredFields = [
    { field: 'tool_call_id', value: tool_call_id, valid: tool_call_id && tool_call_id.trim() !== '' },
    { field: 'output', value: output, valid: output !== undefined && output !== null },
    { field: 'thread_id', value: thread_id, valid: thread_id && thread_id.trim() !== '' },
    { field: 'run_id', value: run_id, valid: run_id && run_id.trim() !== '' }
  ];

  const invalidFields = requiredFields.filter(item => !item.valid);

  if (invalidFields.length > 0) {
    console.error('❌ Webhook validation failed:', invalidFields.map(f => `${f.field}: ${f.value || 'missing'}`));
    return res.status(400).json({
      error: 'Missing or invalid required fields',
      details: `Invalid fields: ${invalidFields.map(f => f.field).join(', ')}`,
      received_data: {
        tool_call_id: tool_call_id || null,
        thread_id: thread_id || null,
        run_id: run_id || null,
        output_present: !!output
      }
    });
  }

  // Validate field types
  if (typeof tool_call_id !== 'string' || typeof thread_id !== 'string' || typeof run_id !== 'string') {
    return res.status(400).json({
      error: 'Invalid field types',
      details: 'tool_call_id, thread_id, and run_id must be strings'
    });
  }

  console.log('✅ Webhook validation passed');
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

  // FIXED: Safe error message handling with multiple fallbacks
  let errorMessage = 'Unknown error occurred';
  
  if (err) {
    if (typeof err === 'string') {
      errorMessage = err;
    } else if (err.message && typeof err.message === 'string') {
      errorMessage = err.message;
    } else if (err.details && typeof err.details === 'string') {
      errorMessage = err.details;
    } else if (err.error && typeof err.error === 'string') {
      errorMessage = err.error;
    }
  }

  // Handle specific error types with safe string operations
  if (errorMessage.includes && errorMessage.includes('OpenAI API authentication failed')) {
    statusCode = 401;
    message = 'Authentication error';
    details = 'OpenAI API key is invalid or missing. Please check your configuration.';
  } else if (errorMessage.includes && errorMessage.includes('OpenAI API rate limit exceeded')) {
    statusCode = 429;
    message = 'Rate limit exceeded';
    details = 'Too many requests to OpenAI API. Please try again later.';
  } else if (errorMessage.includes && errorMessage.includes('Failed to create conversation thread')) {
    statusCode = 503;
    message = 'Service temporarily unavailable';
    details = 'Unable to connect to OpenAI services';
  } else if (errorMessage.includes && errorMessage.includes('Failed to run assistant')) {
    statusCode = 502;
    message = 'Assistant service error';
    details = 'Unable to process request with AI assistant';
  } else if (errorMessage.includes && errorMessage.includes('while a run') && errorMessage.includes('is active')) {
    statusCode = 409;
    message = 'Thread busy';
    details = 'Cannot add messages while assistant is processing. Please wait for the current operation to complete.';
  } else if (errorMessage.includes && errorMessage.includes('No pending tool call found')) {
    statusCode = 404;
    message = 'Tool call not found';
    details = errorMessage;
  } else if (errorMessage.includes && errorMessage.includes('mismatch')) {
    statusCode = 400;
    message = 'Request correlation error';
    details = errorMessage;
  } else if (errorMessage.includes && errorMessage.includes('not properly configured')) {
    statusCode = 503;
    message = 'Service configuration error';
    details = 'Server is not properly configured. Please check environment variables.';
  } else if (errorMessage.includes && errorMessage.includes('timeout')) {
    statusCode = 408;
    message = 'Request timeout';
    details = 'The request took too long to process. Please try again.';
  }

  const errorResponse = {
    error: message,
    details: details || (process.env.NODE_ENV === 'development' ? errorMessage : 'An unexpected error occurred'),
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
