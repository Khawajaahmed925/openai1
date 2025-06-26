const express = require('express');
const OpenAIService = require('../services/openai-client');
const WebhookHandler = require('../services/webhook-handler');
const { validateAskRequest, validateWebhookResponse } = require('../middleware/validation');
const config = require('../config');

const router = express.Router();

// Initialize services with error handling
let openaiService;
let webhookHandler;

try {
  openaiService = new OpenAIService();
  webhookHandler = new WebhookHandler();
} catch (error) {
  console.error('Failed to initialize services:', error.message);
  // Services will be null, and we'll handle this in the routes
}

/**
 * GET /assistant-info - Get detailed assistant configuration
 */
router.get('/assistant-info', async (req, res, next) => {
  try {
    if (!openaiService) {
      return res.status(503).json({
        error: 'Service unavailable',
        details: 'OpenAI service is not properly configured.'
      });
    }

    // Get employee from query parameter
    const employee = req.query.employee || 'brenden';
    const employeeConfig = config.employees[employee];
    
    if (!employeeConfig) {
      return res.status(404).json({
        error: 'Employee not found',
        details: `Employee '${employee}' is not configured`
      });
    }

    const assistantId = employeeConfig.assistantId;
    
    console.log(`Getting assistant info for ${employee} (${assistantId})`);

    // Check if assistant ID is placeholder
    if (assistantId.includes('placeholder')) {
      return res.status(503).json({
        error: 'Assistant not configured',
        details: `${employeeConfig.name} is not connected yet. Please contact your administrator to configure this AI employee.`,
        employee: employeeConfig
      });
    }

    // Get assistant details from OpenAI
    const assistant = await openaiService.client.beta.assistants.retrieve(assistantId);
    
    res.json({
      id: assistant.id,
      name: assistant.name,
      description: assistant.description,
      instructions: assistant.instructions,
      model: assistant.model,
      tools: assistant.tools,
      created_at: assistant.created_at,
      employee: employeeConfig
    });
    
  } catch (error) {
    console.error('Error getting assistant info:', error);
    
    // Handle specific OpenAI errors
    if (error.status === 404) {
      return res.status(404).json({
        error: 'Assistant not found',
        details: 'The specified assistant ID does not exist or is not accessible.'
      });
    }
    
    next(error);
  }
});

/**
 * POST /ask - Handle user messages and assistant interactions
 * ENHANCED: Better handling of active runs and thread state
 */
router.post('/ask', validateAskRequest, async (req, res, next) => {
  let threadId = null;
  let runId = null;
  let employeeId = null;
  let assistantId = null;
  
  try {
    console.log('=== ASK REQUEST RECEIVED ===');
    console.log('Request body:', req.body);
    console.log('Timestamp:', new Date().toISOString());

    // Check if services are properly initialized
    if (!openaiService) {
      console.error('OpenAI service not initialized');
      return res.status(503).json({
        error: 'Service unavailable',
        details: 'OpenAI service is not properly configured. Please check your environment variables.'
      });
    }

    const { message, employee = 'brenden', thread_id } = req.body;
    employeeId = employee;
    
    // Get employee configuration
    const employeeConfig = config.employees[employee];
    if (!employeeConfig) {
      return res.status(404).json({
        error: 'Employee not found',
        details: `Employee '${employee}' is not configured`
      });
    }

    assistantId = employeeConfig.assistantId;
    
    // CRITICAL: Validate we're using the CORRECT assistant for this employee
    console.log('🎯 EMPLOYEE ROUTING VALIDATION:');
    console.log(`   Employee ID: ${employeeId}`);
    console.log(`   Employee Name: ${employeeConfig.name}`);
    console.log(`   Employee Role: ${employeeConfig.role}`);
    console.log(`   Assistant ID: ${assistantId}`);
    console.log(`   Webhook URL: ${employeeConfig.webhookUrl}`);
    
    // Check if assistant ID is placeholder
    if (assistantId.includes('placeholder')) {
      return res.status(503).json({
        error: 'Assistant not configured',
        details: `❌ ${employeeConfig.name} is not connected yet. Please contact your administrator to configure this AI employee.`,
        employee: employeeConfig
      });
    }
    
    console.log(`🎯 Processing message for ${employeeConfig.name} (${employeeConfig.role})`);
    console.log('📝 Message:', message);

    // Step 1: Create or use existing thread
    if (thread_id) {
      console.log('Step 1: Using existing thread:', thread_id);
      threadId = thread_id;
      
      // ENHANCED: Check if there's an active run on this thread
      try {
        console.log('🔍 Checking for active runs on thread...');
        const runs = await openaiService.client.beta.threads.runs.list(threadId, { limit: 1 });
        
        if (runs.data.length > 0) {
          const latestRun = runs.data[0];
          console.log(`📊 Latest run status: ${latestRun.status} (${latestRun.id})`);
          
          if (['queued', 'in_progress', 'requires_action'].includes(latestRun.status)) {
            console.log(`⚠️ Thread ${threadId} has active run ${latestRun.id} with status: ${latestRun.status}`);
            
            // If it's requires_action, check if we have pending tool calls
            if (latestRun.status === 'requires_action') {
              const pendingCalls = webhookHandler.getPendingCalls().filter(call => 
                call.threadId === threadId && call.runId === latestRun.id
              );
              
              if (pendingCalls.length > 0) {
                console.log(`🔧 Found ${pendingCalls.length} pending tool calls for this run`);
                return res.status(409).json({
                  error: 'Thread busy with tool calls',
                  details: `${employeeConfig.name} is currently processing ${pendingCalls.length} tool call(s). Please wait for completion or send the webhook response.`,
                  thread_id: threadId,
                  run_id: latestRun.id,
                  pending_tool_calls: pendingCalls.length,
                  employee: employeeConfig,
                  status: 'requires_action'
                });
              }
            } else {
              return res.status(409).json({
                error: 'Thread busy',
                details: `${employeeConfig.name} is currently processing another request. Please wait for completion.`,
                thread_id: threadId,
                run_id: latestRun.id,
                current_status: latestRun.status,
                employee: employeeConfig
              });
            }
          }
        }
      } catch (runCheckError) {
        console.warn('⚠️ Could not check run status, proceeding anyway:', runCheckError.message);
      }
    } else {
      console.log('Step 1: Creating new thread...');
      let thread;
      let threadRetries = 3;
      while (threadRetries > 0) {
        try {
          thread = await openaiService.createThread();
          threadId = thread.id;
          console.log('✅ Thread created successfully:', threadId);
          break;
        } catch (error) {
          threadRetries--;
          console.error(`❌ Thread creation failed, retries left: ${threadRetries}`, error.message);
          if (threadRetries === 0) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Step 2: Add user message to thread
    console.log('Step 2: Adding message to thread...');
    let messageRetries = 3;
    while (messageRetries > 0) {
      try {
        await openaiService.addMessage(threadId, message);
        console.log('✅ Message added to thread successfully');
        break;
      } catch (error) {
        messageRetries--;
        console.error(`❌ Message addition failed, retries left: ${messageRetries}`, error.message);
        
        // If it's an active run error, provide specific guidance
        if (error.message && error.message.includes('while a run') && error.message.includes('is active')) {
          throw new Error(`Cannot add message to ${employeeConfig.name}'s thread while processing. Please wait for the current operation to complete or check for pending tool calls.`);
        }
        
        if (messageRetries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Step 3: Run the CORRECT assistant for this employee
    console.log(`Step 3: Running ${employeeConfig.name}'s assistant (${assistantId})...`);
    let run;
    let runRetries = 3;
    while (runRetries > 0) {
      try {
        run = await openaiService.runAssistant(threadId, assistantId);
        runId = run.id;
        console.log(`✅ ${employeeConfig.name}'s assistant run started successfully:`, runId);
        break;
      } catch (error) {
        runRetries--;
        console.error(`❌ ${employeeConfig.name}'s assistant run failed, retries left: ${runRetries}`, error.message);
        if (runRetries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Step 4: Poll for completion
    console.log(`Step 4: Polling for ${employeeConfig.name}'s completion...`);
    let result;
    let pollRetries = 2;
    while (pollRetries > 0) {
      try {
        result = await openaiService.pollRunStatus(threadId, runId, 45, 2000);
        console.log(`✅ ${employeeConfig.name} polling completed, result status:`, result.status);
        break;
      } catch (error) {
        pollRetries--;
        console.error(`❌ ${employeeConfig.name} polling failed, retries left: ${pollRetries}`, error.message);
        if (pollRetries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (result.status === 'completed') {
      console.log(`✅ ${employeeConfig.name} completed without tool calls`);
      // Get the final assistant message
      let assistantMessage;
      let messageGetRetries = 3;
      while (messageGetRetries > 0) {
        try {
          assistantMessage = await openaiService.getLatestAssistantMessage(threadId);
          console.log(`✅ ${employeeConfig.name} message retrieved successfully`);
          break;
        } catch (error) {
          messageGetRetries--;
          console.error(`❌ ${employeeConfig.name} message retrieval failed, retries left: ${messageGetRetries}`, error.message);
          if (messageGetRetries === 0) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      const response = {
        status: 'completed',
        message: assistantMessage.content,
        thread_id: threadId,
        run_id: runId,
        assistant_id: assistantId,
        employee: employeeConfig,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Sending completed response for ${employeeConfig.name}`);
      res.json(response);
      
    } else if (result.status === 'requires_action') {
      console.log(`🔧 ${employeeConfig.name} requires tool calls:`, result.toolCalls?.length || 0);
      
      // Validate employee-specific webhook configuration
      if (!employeeConfig.webhookUrl || employeeConfig.webhookUrl.includes('placeholder')) {
        console.error(`❌ Webhook URL not configured for ${employeeConfig.name}`);
        return res.status(503).json({
          error: 'Webhook not configured',
          details: `External webhook URL is not configured for ${employeeConfig.name}. Tool calls cannot be processed.`,
          employee: employeeConfig,
          tool_calls: result.toolCalls.map(tc => ({
            id: tc.id,
            function: tc.function.name,
            arguments: JSON.parse(tc.function.arguments)
          })),
          thread_id: threadId,
          run_id: runId
        });
      }
      
      // CRITICAL: Send to CORRECT employee's webhook
      console.log(`=== SENDING TOOL CALLS TO ${employeeConfig.name.toUpperCase()}'S WEBHOOK ===`);
      console.log(`🎯 WEBHOOK ROUTING VALIDATION:`);
      console.log(`   Employee: ${employeeConfig.name}`);
      console.log(`   Webhook URL: ${employeeConfig.webhookUrl}`);
      console.log(`   Tool Calls: ${result.toolCalls.length}`);
      
      let webhookResults;
      let webhookRetries = 3;
      while (webhookRetries > 0) {
        try {
          webhookResults = await webhookHandler.sendToolCalls(
            result.toolCalls,
            threadId,
            runId,
            employeeId // CRITICAL: Pass correct employee ID
          );
          console.log(`✅ Tool calls sent to ${employeeConfig.name}'s webhook successfully`);
          break;
        } catch (error) {
          webhookRetries--;
          console.error(`❌ ${employeeConfig.name} webhook sending failed, retries left: ${webhookRetries}`, error.message);
          if (webhookRetries === 0) {
            console.error(`💥 All ${employeeConfig.name} webhook attempts failed, but continuing with response`);
            webhookResults = result.toolCalls.map(tc => ({
              toolCallId: tc.id,
              employeeId: employeeId,
              employeeName: employeeConfig.name,
              status: 'error',
              error: 'Failed to send to webhook after multiple attempts'
            }));
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      const response = {
        status: 'requires_action',
        message: `Tool calls have been sent to ${employeeConfig.name}'s external webhook`,
        thread_id: threadId,
        run_id: runId,
        assistant_id: assistantId,
        employee: employeeConfig,
        tool_calls: result.toolCalls.map(tc => ({
          id: tc.id,
          function: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        })),
        webhook_results: webhookResults,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Sending requires_action response for ${employeeConfig.name}`);
      res.json(response);
    } else {
      console.error('Unexpected result status:', result.status);
      throw new Error(`Unexpected assistant status: ${result.status}`);
    }
    
  } catch (error) {
    console.error('=== ASK REQUEST ERROR ===');
    console.error('Error timestamp:', new Date().toISOString());
    console.error('Employee ID:', employeeId);
    console.error('Assistant ID:', assistantId);
    console.error('Thread ID:', threadId);
    console.error('Run ID:', runId);
    console.error('Error in /ask route:', error);
    console.error('Error stack:', error.stack);
    
    // Enhanced error response with context
    const errorResponse = {
      error: 'Request processing failed',
      details: error.message,
      context: {
        employee_id: employeeId,
        employee_name: employeeId ? config.employees[employeeId]?.name : null,
        assistant_id: assistantId,
        thread_id: threadId,
        run_id: runId,
        timestamp: new Date().toISOString()
      }
    };
    
    next(errorResponse);
  }
});

/**
 * POST /webhook-response - Handle webhook responses with tool outputs
 * ENHANCED: Better validation and error handling
 */
router.post('/webhook-response', validateWebhookResponse, async (req, res, next) => {
  let processedResponse = null;
  
  try {
    console.log('=== WEBHOOK RESPONSE RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);
    
    // Check if services are properly initialized
    if (!openaiService || !webhookHandler) {
      console.error('Services not initialized - openai:', !!openaiService, 'webhook:', !!webhookHandler);
      return res.status(503).json({
        error: 'Service unavailable',
        details: 'Services are not properly configured.'
      });
    }
    
    // Check current pending calls before processing
    const pendingBefore = webhookHandler.getPendingCalls();
    console.log('📊 Pending calls before processing:', pendingBefore.length);
    pendingBefore.forEach(call => {
      console.log(`  - ${call.toolCallId}: ${call.functionName} (${call.employeeName}, thread: ${call.threadId}, run: ${call.runId})`);
    });
    
    // Process and validate the webhook response
    console.log('🔍 Processing webhook response...');
    let processRetries = 3;
    while (processRetries > 0) {
      try {
        processedResponse = webhookHandler.processWebhookResponse(req.body);
        console.log(`✅ Webhook response processed successfully for ${processedResponse.employee_name}`);
        
        // CRITICAL: Validate employee context
        console.log('🎯 WEBHOOK RESPONSE VALIDATION:');
        console.log(`   Tool Call ID: ${processedResponse.tool_call_id}`);
        console.log(`   Employee ID: ${processedResponse.employee_id}`);
        console.log(`   Employee Name: ${processedResponse.employee_name}`);
        console.log(`   Thread ID: ${processedResponse.thread_id}`);
        console.log(`   Run ID: ${processedResponse.run_id}`);
        
        break;
      } catch (error) {
        processRetries--;
        console.error(`❌ Webhook processing failed, retries left: ${processRetries}`, error.message);
        if (processRetries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Check pending calls after processing
    const pendingAfter = webhookHandler.getPendingCalls();
    console.log('📊 Pending calls after processing:', pendingAfter.length);
    
    // Submit tool output back to OpenAI
    console.log(`🚀 Submitting tool output to OpenAI for ${processedResponse.employee_name}`);
    console.log(`📋 Thread: ${processedResponse.thread_id}, Run: ${processedResponse.run_id}`);
    console.log('📄 Tool output preview:', processedResponse.output.substring(0, 200) + (processedResponse.output.length > 200 ? '...' : ''));
    
    let submitResult;
    let submitRetries = 5;
    while (submitRetries > 0) {
      try {
        submitResult = await openaiService.submitToolOutputs(
          processedResponse.thread_id,
          processedResponse.run_id,
          [{
            tool_call_id: processedResponse.tool_call_id,
            output: processedResponse.output
          }]
        );
        console.log(`✅ Tool output submitted successfully for ${processedResponse.employee_name}. Status:`, submitResult.status);
        break;
      } catch (error) {
        submitRetries--;
        console.error(`❌ Tool output submission failed for ${processedResponse.employee_name}, retries left: ${submitRetries}`, error.message);
        if (submitRetries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`⏳ Starting polling for completion for ${processedResponse.employee_name}...`);
    
    // Poll for final completion
    let result;
    let finalPollRetries = 3;
    while (finalPollRetries > 0) {
      try {
        result = await openaiService.pollRunStatus(
          processedResponse.thread_id,
          processedResponse.run_id,
          90, // 3 minutes
          2000 // 2 second intervals
        );
        console.log(`✅ Final polling completed for ${processedResponse.employee_name}, status:`, result.status);
        break;
      } catch (error) {
        finalPollRetries--;
        console.error(`❌ Final polling failed for ${processedResponse.employee_name}, retries left: ${finalPollRetries}`, error.message);
        if (finalPollRetries === 0) {
          console.warn(`⚠️ Polling failed for ${processedResponse.employee_name}, attempting to get message anyway`);
          result = { status: 'unknown' };
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    console.log(`📊 Final run status for ${processedResponse.employee_name}:`, result.status);
    
    if (result.status === 'completed') {
      console.log(`📝 Getting final assistant message for ${processedResponse.employee_name}...`);
      let assistantMessage;
      let messageRetries = 5;
      while (messageRetries > 0) {
        try {
          assistantMessage = await openaiService.getLatestAssistantMessage(
            processedResponse.thread_id
          );
          console.log(`✅ ${processedResponse.employee_name} final message retrieved successfully`);
          break;
        } catch (error) {
          messageRetries--;
          console.error(`❌ Message retrieval failed for ${processedResponse.employee_name}, retries left: ${messageRetries}`, error.message);
          if (messageRetries === 0) {
            assistantMessage = {
              content: `Task completed successfully by ${processedResponse.employee_name}. The tool call has been processed and the assistant has finished the requested operation.`
            };
            console.warn(`⚠️ Using fallback message for ${processedResponse.employee_name} due to retrieval failure`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      const response = {
        status: 'completed',
        message: assistantMessage.content,
        thread_id: processedResponse.thread_id,
        run_id: processedResponse.run_id,
        tool_call_id: processedResponse.tool_call_id,
        employee_id: processedResponse.employee_id,
        employee_name: processedResponse.employee_name,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Sending webhook completion response for ${processedResponse.employee_name}`);
      res.json(response);
      
    } else if (result.status === 'requires_action') {
      console.log(`🔧 ${processedResponse.employee_name} requires more actions:`, result.toolCalls?.length || 0, 'tool calls');
      
      // Send additional tool calls to employee-specific webhook
      if (result.toolCalls && result.toolCalls.length > 0) {
        console.log(`🚀 Sending additional tool calls to ${processedResponse.employee_name} webhook...`);
        try {
          const additionalWebhookResults = await webhookHandler.sendToolCalls(
            result.toolCalls,
            processedResponse.thread_id,
            processedResponse.run_id,
            processedResponse.employee_id
          );
          console.log(`✅ Additional webhook results for ${processedResponse.employee_name}:`, additionalWebhookResults);
        } catch (error) {
          console.error(`❌ Failed to send additional tool calls for ${processedResponse.employee_name}:`, error.message);
        }
      }
      
      const response = {
        status: 'requires_action',
        message: `${processedResponse.employee_name} requires additional tool calls`,
        thread_id: processedResponse.thread_id,
        run_id: processedResponse.run_id,
        tool_call_id: processedResponse.tool_call_id,
        employee_id: processedResponse.employee_id,
        employee_name: processedResponse.employee_name,
        tool_calls: result.toolCalls?.map(tc => ({
          id: tc.id,
          function: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        })) || [],
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Sending requires_action response for ${processedResponse.employee_name}`);
      res.json(response);
      
    } else {
      console.log(`⏳ ${processedResponse.employee_name} still processing or unknown status:`, result.status);
      const response = {
        status: result.status === 'unknown' ? 'processing' : result.status,
        message: `Tool output submitted for ${processedResponse.employee_name}, assistant status: ${result.status}`,
        thread_id: processedResponse.thread_id,
        run_id: processedResponse.run_id,
        tool_call_id: processedResponse.tool_call_id,
        employee_id: processedResponse.employee_id,
        employee_name: processedResponse.employee_name,
        current_status: result.status,
        timestamp: new Date().toISOString()
      };

      console.log(`📊 Sending processing/status response for ${processedResponse.employee_name}`);
      res.json(response);
    }
    
  } catch (error) {
    console.error('=== WEBHOOK RESPONSE ERROR ===');
    console.error('Error timestamp:', new Date().toISOString());
    console.error('Processed response:', processedResponse);
    console.error('Error processing webhook response:', error);
    console.error('Error stack:', error.stack);
    
    const errorResponse = {
      error: 'Webhook response processing failed',
      details: error.message,
      context: {
        tool_call_id: processedResponse?.tool_call_id,
        thread_id: processedResponse?.thread_id,
        run_id: processedResponse?.run_id,
        employee_id: processedResponse?.employee_id,
        employee_name: processedResponse?.employee_name,
        timestamp: new Date().toISOString()
      }
    };
    
    next(errorResponse);
  }
});

/**
 * GET /status - Get server status and pending tool calls with employee breakdown
 */
router.get('/status', async (req, res) => {
  try {
    const pendingCalls = webhookHandler ? webhookHandler.getPendingCalls() : [];
    
    // Check webhook health for all employees if configured
    let webhookHealth = null;
    if (webhookHandler) {
      try {
        webhookHealth = await webhookHandler.checkWebhookHealth();
      } catch (error) {
        webhookHealth = { error: error.message };
      }
    }
    
    // Get comprehensive statistics
    const stats = webhookHandler ? webhookHandler.getStatistics() : null;
    
    const response = {
      status: 'running',
      employees: config.employees,
      services_initialized: {
        openai: !!openaiService,
        webhook: !!webhookHandler
      },
      configuration: {
        api_key_configured: !!(config.openai.apiKey && !config.openai.apiKey.includes('your_')),
        employees_configured: Object.keys(config.employees).reduce((acc, key) => {
          const employee = config.employees[key];
          acc[key] = {
            assistant_configured: !employee.assistantId.includes('placeholder'),
            webhook_configured: !!(employee.webhookUrl && !employee.webhookUrl.includes('placeholder')),
            name: employee.name,
            role: employee.role
          };
          return acc;
        }, {})
      },
      webhook_health: webhookHealth,
      pending_tool_calls: pendingCalls.length,
      pending_calls: pendingCalls,
      statistics: stats,
      timestamp: new Date().toISOString()
    };

    console.log('📊 Status request - response summary:', {
      total_employees: Object.keys(config.employees).length,
      pending_calls: pendingCalls.length,
      webhook_health_status: webhookHealth ? Object.keys(webhookHealth).length : 0
    });
    res.json(response);
  } catch (error) {
    console.error('Error in status endpoint:', error);
    res.status(500).json({
      error: 'Failed to get status',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /debug/pending - Debug endpoint to check pending tool calls with employee info
 */
router.get('/debug/pending', (req, res) => {
  try {
    if (!webhookHandler) {
      return res.status(503).json({ 
        error: 'Webhook handler not initialized',
        details: 'Service is not properly configured',
        timestamp: new Date().toISOString()
      });
    }
    
    const pendingCalls = webhookHandler.getPendingCalls();
    const stats = webhookHandler.getStatistics();
    
    const response = {
      count: pendingCalls.length,
      calls: pendingCalls,
      statistics: stats,
      timestamp: new Date().toISOString()
    };

    console.log('🔍 Debug pending calls:', {
      total: pendingCalls.length,
      by_employee: stats.pending_by_employee
    });
    res.json(response);
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      error: 'Failed to get pending calls',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /debug/simulate-webhook - Debug endpoint to simulate webhook response
 */
router.post('/debug/simulate-webhook', async (req, res) => {
  try {
    console.log('=== SIMULATING WEBHOOK RESPONSE ===');
    
    // Get current pending calls
    const pendingCalls = webhookHandler ? webhookHandler.getPendingCalls() : [];
    console.log('Current pending calls:', pendingCalls.length);
    
    if (pendingCalls.length === 0) {
      return res.json({
        error: 'No pending tool calls to simulate',
        message: 'Send a message that requires a tool call first',
        timestamp: new Date().toISOString()
      });
    }
    
    // Use the first pending call
    const pendingCall = pendingCalls[0];
    
    // Create a simulated webhook response
    const simulatedResponse = {
      tool_call_id: pendingCall.toolCallId,
      output: `Simulated response for ${pendingCall.functionName} from ${pendingCall.employeeName}: Operation completed successfully with sample data.`,
      thread_id: pendingCall.threadId,
      run_id: pendingCall.runId
    };
    
    console.log(`🎭 Simulating webhook response for ${pendingCall.employeeName}:`, simulatedResponse);
    
    // Process the simulated response through the webhook-response endpoint
    const processedResponse = webhookHandler.processWebhookResponse(simulatedResponse);
    
    // Submit to OpenAI
    await openaiService.submitToolOutputs(
      processedResponse.thread_id,
      processedResponse.run_id,
      [{
        tool_call_id: processedResponse.tool_call_id,
        output: processedResponse.output
      }]
    );
    
    // Poll for completion
    const result = await openaiService.pollRunStatus(
      processedResponse.thread_id,
      processedResponse.run_id,
      30,
      2000
    );
    
    if (result.status === 'completed') {
      const assistantMessage = await openaiService.getLatestAssistantMessage(
        processedResponse.thread_id
      );
      
      res.json({
        status: 'success',
        message: `Webhook response simulated successfully for ${processedResponse.employee_name}`,
        employee_name: processedResponse.employee_name,
        assistant_response: assistantMessage.content,
        simulated_data: simulatedResponse,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        status: 'partial',
        message: `Webhook response processed but ${processedResponse.employee_name} assistant not completed`,
        employee_name: processedResponse.employee_name,
        current_status: result.status,
        simulated_data: simulatedResponse,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error simulating webhook:', error);
    res.status(500).json({
      error: 'Failed to simulate webhook response',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
