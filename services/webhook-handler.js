const axios = require('axios');
const config = require('../config');

class WebhookHandler {
  constructor() {
    this.webhookSecret = config.webhook.secret;
    this.pendingCalls = new Map(); // Store pending tool calls for correlation
    this.retryAttempts = 5; // Increased retry attempts for maximum reliability
    this.retryDelay = 2000; // Delay between retries in milliseconds
    this.maxRetryDelay = 10000; // Maximum delay for exponential backoff
    
    console.log('🚀 WebhookHandler initialized with MULTI-EMPLOYEE support');
    console.log('📋 Configured employees and their webhooks:');
    Object.entries(config.employees).forEach(([key, employee]) => {
      const status = employee.webhookUrl && !employee.webhookUrl.includes('placeholder') ? '✅' : '⚠️';
      console.log(`   ${status} ${employee.name}: ${employee.webhookUrl}`);
    });
  }

  /**
   * Get webhook URL for specific employee
   */
  getWebhookUrlForEmployee(employeeId) {
    const employee = config.employees[employeeId];
    if (!employee) {
      throw new Error(`Employee '${employeeId}' not found in configuration`);
    }
    
    if (!employee.webhookUrl || employee.webhookUrl.includes('placeholder')) {
      throw new Error(`Webhook URL not configured for employee '${employee.name}'`);
    }
    
    return employee.webhookUrl;
  }

  /**
   * Send tool calls to employee-specific webhook with bulletproof retry logic
   */
  async sendToolCalls(toolCalls, threadId, runId, employeeId = 'brenden') {
    console.log(`=== SENDING ${toolCalls.length} TOOL CALLS TO ${employeeId.toUpperCase()} WEBHOOK ===`);
    
    // Get employee-specific webhook URL
    let webhookUrl;
    try {
      webhookUrl = this.getWebhookUrlForEmployee(employeeId);
      console.log(`🎯 Using webhook for ${config.employees[employeeId].name}: ${webhookUrl}`);
    } catch (error) {
      console.error(`❌ Webhook configuration error for ${employeeId}:`, error.message);
      throw error;
    }
    
    console.log('📊 Request details:');
    console.log('   Employee ID:', employeeId);
    console.log('   Employee Name:', config.employees[employeeId].name);
    console.log('   Webhook URL:', webhookUrl);
    console.log('   Thread ID:', threadId);
    console.log('   Run ID:', runId);
    console.log('   Tool Calls:', toolCalls.length);
    
    const results = [];

    for (const toolCall of toolCalls) {
      try {
        const payload = {
          tool_call_id: toolCall.id,
          function_name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments),
          thread_id: threadId,
          run_id: runId,
          employee_id: employeeId,
          employee_name: config.employees[employeeId].name,
          employee_role: config.employees[employeeId].role,
          timestamp: new Date().toISOString(),
          retry_count: 0
        };

        // Store the pending call for later correlation
        this.pendingCalls.set(toolCall.id, {
          threadId,
          runId,
          employeeId,
          functionName: toolCall.function.name,
          timestamp: Date.now(),
          arguments: payload.arguments,
          retryCount: 0,
          webhookUrl: webhookUrl,
          payload: payload
        });

        console.log(`📝 Storing pending call ${toolCall.id} for ${employeeId}:`, {
          threadId,
          runId,
          employeeId,
          functionName: toolCall.function.name,
          webhookUrl: webhookUrl
        });

        const result = await this.sendWebhookWithRetry(payload, webhookUrl);
        results.push(result);

      } catch (error) {
        console.error(`💥 CRITICAL ERROR sending tool call ${toolCall.id} to ${employeeId}:`, error.message);
        console.error('Error stack:', error.stack);
        
        // Even on error, keep the pending call for potential manual retry
        results.push({
          toolCallId: toolCall.id,
          employeeId: employeeId,
          status: 'error',
          error: error.message,
          retryable: true
        });
      }
    }

    console.log(`✅ All tool calls processed for ${employeeId}. Current pending calls:`, this.pendingCalls.size);
    this.logPendingCalls();

    return results;
  }

  /**
   * Send webhook with bulletproof retry logic and exponential backoff
   */
  async sendWebhookWithRetry(payload, webhookUrl, attempt = 1) {
    const maxAttempts = this.retryAttempts;
    
    try {
      console.log(`🚀 Sending tool call ${payload.tool_call_id} to ${payload.employee_name} webhook (attempt ${attempt}/${maxAttempts})`);
      console.log(`📡 Target URL: ${webhookUrl}`);

      // Calculate delay with exponential backoff
      const delay = Math.min(this.retryDelay * Math.pow(2, attempt - 1), this.maxRetryDelay);
      
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenAI-Assistant-Bridge/1.0',
        'X-Request-ID': `${payload.tool_call_id}-${Date.now()}`,
        'X-Thread-ID': payload.thread_id,
        'X-Run-ID': payload.run_id,
        'X-Employee-ID': payload.employee_id,
        'X-Employee-Name': payload.employee_name,
        'X-Attempt': attempt.toString(),
        'X-Max-Attempts': maxAttempts.toString()
      };

      // Add webhook secret if configured
      if (this.webhookSecret) {
        headers['X-Webhook-Secret'] = this.webhookSecret;
      }

      // Create axios instance with comprehensive configuration
      const axiosConfig = {
        headers,
        timeout: 60000, // 60 second timeout
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        maxRedirects: 3,
        // Retry on network errors
        retry: {
          retries: 0 // We handle retries manually
        }
      };

      console.log(`📤 Making HTTP request to ${webhookUrl} with timeout ${axiosConfig.timeout}ms`);
      
      const response = await axios.post(webhookUrl, payload, axiosConfig);

      console.log(`📥 Webhook response received - Status: ${response.status}, Headers:`, response.headers);

      if (response.status >= 400) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText} - ${JSON.stringify(response.data)}`);
      }

      console.log(`✅ Tool call ${payload.tool_call_id} sent successfully to ${payload.employee_name}:`, response.status);
      console.log('📋 Webhook response data:', response.data);
      
      return {
        toolCallId: payload.tool_call_id,
        employeeId: payload.employee_id,
        employeeName: payload.employee_name,
        webhookUrl: webhookUrl,
        status: 'sent',
        response: response.data,
        attempt: attempt,
        response_time: response.headers['x-response-time'] || 'unknown'
      };

    } catch (error) {
      console.error(`❌ Webhook attempt ${attempt}/${maxAttempts} failed for ${payload.tool_call_id} (${payload.employee_name}):`, error.message);
      
      // Log detailed error information
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
        console.error('Response data:', error.response.data);
      } else if (error.request) {
        console.error('No response received:', error.request);
      } else {
        console.error('Request setup error:', error.message);
      }
      
      if (attempt < maxAttempts) {
        const delay = Math.min(this.retryDelay * Math.pow(2, attempt - 1), this.maxRetryDelay);
        console.log(`⏳ Retrying ${payload.employee_name} webhook in ${delay}ms... (attempt ${attempt + 1}/${maxAttempts})`);
        
        // Update retry count in pending call
        const pendingCall = this.pendingCalls.get(payload.tool_call_id);
        if (pendingCall) {
          pendingCall.retryCount = attempt;
          pendingCall.lastError = error.message;
          pendingCall.lastAttempt = new Date().toISOString();
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendWebhookWithRetry(payload, webhookUrl, attempt + 1);
      } else {
        // Final failure - log comprehensive error details
        console.error(`💥 FINAL FAILURE: ${payload.employee_name} webhook failed after ${maxAttempts} attempts for ${payload.tool_call_id}`);
        console.error('Final error details:', {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          data: error.response?.data,
          webhookUrl: webhookUrl
        });
        
        // Update pending call with final failure status
        const pendingCall = this.pendingCalls.get(payload.tool_call_id);
        if (pendingCall) {
          pendingCall.status = 'failed';
          pendingCall.finalError = error.message;
          pendingCall.failedAt = new Date().toISOString();
        }
        
        throw new Error(`${payload.employee_name} webhook failed after ${maxAttempts} attempts: ${error.message}`);
      }
    }
  }

  /**
   * Process webhook response with enhanced validation and error handling
   */
  processWebhookResponse(responseData) {
    console.log('=== PROCESSING WEBHOOK RESPONSE ===');
    console.log('Processing timestamp:', new Date().toISOString());
    
    const { tool_call_id, output, thread_id, run_id } = responseData;

    console.log(`🔍 Processing webhook response for tool call ${tool_call_id}`);
    console.log('📊 Response data keys:', Object.keys(responseData));
    console.log('📏 Response data size:', JSON.stringify(responseData).length, 'bytes');

    // Enhanced validation with detailed error messages
    const validationErrors = [];
    
    if (!tool_call_id || typeof tool_call_id !== 'string') {
      validationErrors.push('tool_call_id must be a non-empty string');
    }
    
    if (output === undefined || output === null) {
      validationErrors.push('output cannot be undefined or null');
    }
    
    if (!thread_id || typeof thread_id !== 'string') {
      validationErrors.push('thread_id must be a non-empty string');
    }
    
    if (!run_id || typeof run_id !== 'string') {
      validationErrors.push('run_id must be a non-empty string');
    }

    if (validationErrors.length > 0) {
      const errorMessage = `Webhook response validation failed: ${validationErrors.join(', ')}`;
      console.error('❌ Validation errors:', validationErrors);
      console.error('Received data:', responseData);
      throw new Error(errorMessage);
    }

    // Enhanced output processing with multiple format support
    let processedOutput;
    try {
      if (typeof output === 'object') {
        // Handle object outputs
        if (Array.isArray(output)) {
          processedOutput = JSON.stringify(output, null, 2);
        } else {
          processedOutput = JSON.stringify(output, null, 2);
        }
      } else if (typeof output === 'string') {
        processedOutput = output.trim();
      } else if (typeof output === 'number' || typeof output === 'boolean') {
        processedOutput = String(output);
      } else {
        processedOutput = JSON.stringify(output);
      }
      
      // Ensure output is not empty after processing
      if (!processedOutput || processedOutput.trim() === '') {
        throw new Error('Processed output is empty');
      }
      
      // Validate output size (OpenAI has limits)
      if (processedOutput.length > 100000) { // 100KB limit
        console.warn(`⚠️ Large output detected: ${processedOutput.length} bytes`);
        processedOutput = processedOutput.substring(0, 100000) + '\n\n[Output truncated due to size limit]';
      }
      
    } catch (error) {
      console.error('❌ Output processing error:', error.message);
      console.error('Original output:', output);
      throw new Error(`Invalid output format: ${error.message}`);
    }

    // Log current pending calls for debugging
    console.log('📋 Current pending calls before processing:');
    this.logPendingCalls();

    // Enhanced pending call validation with employee context
    const pendingCall = this.pendingCalls.get(tool_call_id);
    if (!pendingCall) {
      console.warn(`⚠️ No pending tool call found for ID: ${tool_call_id}`);
      console.warn('Available pending call IDs:', Array.from(this.pendingCalls.keys()));
      
      // Check for similar IDs (in case of minor corruption)
      const similarIds = Array.from(this.pendingCalls.keys()).filter(id => 
        id.includes(tool_call_id.substring(0, 10)) || tool_call_id.includes(id.substring(0, 10))
      );
      
      if (similarIds.length > 0) {
        console.warn('Found similar pending call IDs:', similarIds);
      }
      
      // Don't throw error - allow processing of valid responses even if not in pending list
      console.warn('⚠️ Processing webhook response without pending call validation');
    } else {
      const employee = config.employees[pendingCall.employeeId];
      console.log(`✅ Found pending call for ${tool_call_id} from ${employee?.name || pendingCall.employeeId}:`, {
        threadId: pendingCall.threadId,
        runId: pendingCall.runId,
        employeeId: pendingCall.employeeId,
        functionName: pendingCall.functionName,
        webhookUrl: pendingCall.webhookUrl,
        age: Math.round((Date.now() - pendingCall.timestamp) / 1000) + 's'
      });
      
      // Enhanced correlation validation
      if (pendingCall.threadId !== thread_id) {
        const error = `Thread ID mismatch! Expected: ${pendingCall.threadId}, Received: ${thread_id}`;
        console.error(`❌ ${error}`);
        throw new Error(error);
      }
      
      if (pendingCall.runId !== run_id) {
        const error = `Run ID mismatch! Expected: ${pendingCall.runId}, Received: ${run_id}`;
        console.error(`❌ ${error}`);
        throw new Error(error);
      }

      // Mark as processed and remove from pending calls
      pendingCall.processedAt = new Date().toISOString();
      pendingCall.status = 'processed';
      this.pendingCalls.delete(tool_call_id);
      
      console.log(`✅ Removed tool call ${tool_call_id} from ${employee?.name || pendingCall.employeeId} pending calls`);
      console.log(`📊 Remaining pending calls: ${this.pendingCalls.size}`);
    }

    const processedResponse = {
      tool_call_id,
      output: processedOutput,
      thread_id,
      run_id,
      employee_id: pendingCall?.employeeId || 'unknown',
      employee_name: pendingCall?.employeeId ? config.employees[pendingCall.employeeId]?.name : 'unknown',
      processed_at: new Date().toISOString(),
      output_size: processedOutput.length,
      validation_passed: true
    };

    console.log('✅ Webhook response processed successfully:', {
      tool_call_id,
      thread_id,
      run_id,
      employee_id: processedResponse.employee_id,
      employee_name: processedResponse.employee_name,
      output_size: processedOutput.length,
      processed_at: processedResponse.processed_at
    });
    
    return processedResponse;
  }

  /**
   * Enhanced logging of pending calls with employee information
   */
  logPendingCalls() {
    if (this.pendingCalls.size === 0) {
      console.log('  📝 No pending calls');
      return;
    }

    console.log(`  📝 ${this.pendingCalls.size} pending calls:`);
    for (const [id, data] of this.pendingCalls.entries()) {
      const age = Math.round((Date.now() - data.timestamp) / 1000);
      const status = data.status || 'pending';
      const retries = data.retryCount || 0;
      const employee = config.employees[data.employeeId];
      
      console.log(`    - ${id}: ${data.functionName} (${employee?.name || data.employeeId}, thread: ${data.threadId}, run: ${data.runId}, age: ${age}s, retries: ${retries}, status: ${status})`);
      
      if (data.lastError) {
        console.log(`      Last error: ${data.lastError}`);
      }
      if (data.webhookUrl) {
        console.log(`      Webhook: ${data.webhookUrl}`);
      }
    }
  }

  /**
   * Get pending tool calls with enhanced employee information
   */
  getPendingCalls() {
    return Array.from(this.pendingCalls.entries()).map(([id, data]) => {
      const employee = config.employees[data.employeeId];
      return {
        toolCallId: id,
        ...data,
        employeeName: employee?.name || 'Unknown',
        age_seconds: Math.round((Date.now() - data.timestamp) / 1000),
        status: data.status || 'pending'
      };
    });
  }

  /**
   * Enhanced cleanup of old pending calls
   */
  cleanupPendingCalls() {
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    let cleanedCount = 0;
    let archivedCount = 0;

    for (const [id, data] of this.pendingCalls.entries()) {
      const age = Date.now() - data.timestamp;
      const employee = config.employees[data.employeeId];
      
      if (data.timestamp < oneDayAgo) {
        // Remove very old calls
        this.pendingCalls.delete(id);
        cleanedCount++;
        console.log(`🧹 Cleaned up very old pending call: ${id} (${employee?.name || data.employeeId}, ${data.functionName}, age: ${Math.round(age / 3600000)}h)`);
      } else if (data.timestamp < twoHoursAgo && data.status === 'failed') {
        // Remove failed calls older than 2 hours
        this.pendingCalls.delete(id);
        archivedCount++;
        console.log(`📁 Archived failed pending call: ${id} (${employee?.name || data.employeeId}, ${data.functionName})`);
      }
    }

    if (cleanedCount > 0 || archivedCount > 0) {
      console.log(`🧹 Cleanup complete: ${cleanedCount} old calls removed, ${archivedCount} failed calls archived`);
      console.log(`📊 Remaining pending calls: ${this.pendingCalls.size}`);
    }
  }

  /**
   * Check if a tool call is pending with detailed status and employee info
   */
  isPending(toolCallId) {
    const pendingCall = this.pendingCalls.get(toolCallId);
    const employee = pendingCall ? config.employees[pendingCall.employeeId] : null;
    
    return {
      pending: !!pendingCall,
      status: pendingCall?.status || null,
      employeeId: pendingCall?.employeeId || null,
      employeeName: employee?.name || null,
      age: pendingCall ? Math.round((Date.now() - pendingCall.timestamp) / 1000) : null
    };
  }

  /**
   * Get detailed pending call information with employee context
   */
  getPendingCall(toolCallId) {
    const pendingCall = this.pendingCalls.get(toolCallId);
    if (!pendingCall) return null;
    
    const employee = config.employees[pendingCall.employeeId];
    
    return {
      ...pendingCall,
      employeeName: employee?.name || 'Unknown',
      age_seconds: Math.round((Date.now() - pendingCall.timestamp) / 1000),
      status: pendingCall.status || 'pending'
    };
  }

  /**
   * Force remove a pending call with employee logging
   */
  removePendingCall(toolCallId) {
    const pendingCall = this.pendingCalls.get(toolCallId);
    const removed = this.pendingCalls.delete(toolCallId);
    
    if (removed && pendingCall) {
      const employee = config.employees[pendingCall.employeeId];
      console.log(`🗑️ Force removed pending call ${toolCallId} from ${employee?.name || pendingCall.employeeId}:`, {
        functionName: pendingCall.functionName,
        age: Math.round((Date.now() - pendingCall.timestamp) / 1000) + 's',
        status: pendingCall.status || 'pending'
      });
    }
    
    return removed;
  }

  /**
   * Enhanced webhook health check for specific employee
   */
  async checkWebhookHealth(employeeId = null) {
    const results = {};
    
    // If specific employee requested, check only that one
    if (employeeId) {
      try {
        const webhookUrl = this.getWebhookUrlForEmployee(employeeId);
        results[employeeId] = await this.performHealthCheck(employeeId, webhookUrl);
      } catch (error) {
        results[employeeId] = {
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    } else {
      // Check all configured employees
      for (const [empId, employee] of Object.entries(config.employees)) {
        if (employee.webhookUrl && !employee.webhookUrl.includes('placeholder')) {
          try {
            results[empId] = await this.performHealthCheck(empId, employee.webhookUrl);
          } catch (error) {
            results[empId] = {
              status: 'error',
              error: error.message,
              timestamp: new Date().toISOString()
            };
          }
        } else {
          results[empId] = {
            status: 'not_configured',
            error: 'Webhook URL not configured',
            timestamp: new Date().toISOString()
          };
        }
      }
    }
    
    return results;
  }

  /**
   * Perform health check for specific webhook
   */
  async performHealthCheck(employeeId, webhookUrl) {
    try {
      console.log(`🏥 Performing webhook health check for ${config.employees[employeeId]?.name}...`);
      
      const healthPayload = {
        type: 'health_check',
        employee_id: employeeId,
        employee_name: config.employees[employeeId]?.name,
        timestamp: new Date().toISOString(),
        test_data: {
          message: `Health check from OpenAI Assistant Bridge for ${config.employees[employeeId]?.name}`,
          version: '1.0.0'
        }
      };

      const startTime = Date.now();
      
      const response = await axios.post(webhookUrl, healthPayload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OpenAI-Assistant-Bridge/1.0',
          'X-Health-Check': 'true',
          'X-Employee-ID': employeeId,
          'X-Employee-Name': config.employees[employeeId]?.name
        },
        timeout: 15000, // 15 second timeout for health check
        validateStatus: (status) => status < 500
      });

      const responseTime = Date.now() - startTime;
      
      console.log(`✅ ${config.employees[employeeId]?.name} webhook health check passed - Status: ${response.status}, Response time: ${responseTime}ms`);

      return {
        status: 'healthy',
        employee_name: config.employees[employeeId]?.name,
        webhook_url: webhookUrl,
        response_time_ms: responseTime,
        webhook_status: response.status,
        webhook_response: response.data,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ ${config.employees[employeeId]?.name} webhook health check failed:`, error.message);
      
      return {
        status: 'unhealthy',
        employee_name: config.employees[employeeId]?.name,
        webhook_url: webhookUrl,
        error: error.message,
        error_code: error.code,
        webhook_reachable: !!error.response,
        response_status: error.response?.status,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get comprehensive webhook handler statistics with employee breakdown
   */
  getStatistics() {
    const pendingCalls = this.getPendingCalls();
    const now = Date.now();
    
    const stats = {
      total_pending: pendingCalls.length,
      pending_by_employee: {},
      pending_by_status: {},
      pending_by_age: {
        under_1min: 0,
        under_5min: 0,
        under_30min: 0,
        over_30min: 0
      },
      oldest_call_age: 0,
      employees: {},
      configuration: {
        retry_attempts: this.retryAttempts,
        retry_delay: this.retryDelay,
        max_retry_delay: this.maxRetryDelay
      },
      timestamp: new Date().toISOString()
    };
    
    // Initialize employee stats
    Object.keys(config.employees).forEach(empId => {
      const employee = config.employees[empId];
      stats.employees[empId] = {
        name: employee.name,
        role: employee.role,
        webhook_configured: !!(employee.webhookUrl && !employee.webhookUrl.includes('placeholder')),
        webhook_url: employee.webhookUrl,
        pending_calls: 0
      };
      stats.pending_by_employee[empId] = 0;
    });
    
    pendingCalls.forEach(call => {
      // Count by employee
      if (call.employeeId) {
        stats.pending_by_employee[call.employeeId] = (stats.pending_by_employee[call.employeeId] || 0) + 1;
        if (stats.employees[call.employeeId]) {
          stats.employees[call.employeeId].pending_calls++;
        }
      }
      
      // Count by status
      const status = call.status || 'pending';
      stats.pending_by_status[status] = (stats.pending_by_status[status] || 0) + 1;
      
      // Count by age
      const ageSeconds = call.age_seconds;
      if (ageSeconds < 60) stats.pending_by_age.under_1min++;
      else if (ageSeconds < 300) stats.pending_by_age.under_5min++;
      else if (ageSeconds < 1800) stats.pending_by_age.under_30min++;
      else stats.pending_by_age.over_30min++;
      
      // Track oldest call
      if (ageSeconds > stats.oldest_call_age) {
        stats.oldest_call_age = ageSeconds;
      }
    });
    
    return stats;
  }
}

module.exports = WebhookHandler;