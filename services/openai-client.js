const OpenAI = require('openai');
const config = require('../config');

class OpenAIService {
  constructor() {
    // Validate API key before creating client
    if (!config.openai.apiKey || config.openai.apiKey.includes('your_')) {
      throw new Error('OpenAI API key is not properly configured. Please check your .env file.');
    }

    this.client = new OpenAI({
      apiKey: config.openai.apiKey
    });
    this.assistantId = config.openai.assistantId;
  }

  /**
   * Create a new thread for conversation
   */
  async createThread() {
    try {
      const thread = await this.client.beta.threads.create();
      console.log(`Created new thread: ${thread.id}`);
      return thread;
    } catch (error) {
      console.error('Error creating thread:', error);
      
      // Provide more specific error messages
      if (error.status === 401) {
        throw new Error('OpenAI API authentication failed. Please check your API key in the .env file.');
      } else if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      } else if (error.status === 500) {
        throw new Error('OpenAI API server error. Please try again later.');
      }
      
      throw new Error(`Failed to create conversation thread: ${error.message}`);
    }
  }

  /**
   * Add a message to an existing thread
   */
  async addMessage(threadId, content, role = 'user') {
    try {
      const message = await this.client.beta.threads.messages.create(threadId, {
        role,
        content
      });
      console.log(`Added message to thread ${threadId}`);
      return message;
    } catch (error) {
      console.error('Error adding message:', error);
      throw new Error(`Failed to add message to thread: ${error.message}`);
    }
  }

  /**
   * Run the assistant on a thread with specific assistant ID
   */
  async runAssistant(threadId, assistantId = null) {
    try {
      const targetAssistantId = assistantId || this.assistantId;
      
      const run = await this.client.beta.threads.runs.create(threadId, {
        assistant_id: targetAssistantId
      });
      console.log(`Started assistant run: ${run.id} on thread: ${threadId} with assistant: ${targetAssistantId}`);
      return run;
    } catch (error) {
      console.error('Error running assistant:', error);
      throw new Error(`Failed to run assistant: ${error.message}`);
    }
  }

  /**
   * Poll for run status until completion or tool calls required
   */
  async pollRunStatus(threadId, runId, maxAttempts = 30, intervalMs = 2000) {
    let attempts = 0;
    
    console.log(`Starting to poll run ${runId} status (max ${maxAttempts} attempts, ${intervalMs}ms intervals)`);
    
    while (attempts < maxAttempts) {
      try {
        const run = await this.client.beta.threads.runs.retrieve(threadId, runId);
        console.log(`Run ${runId} status: ${run.status} (attempt ${attempts + 1}/${maxAttempts})`);

        switch (run.status) {
          case 'completed':
            console.log(`Run ${runId} completed successfully`);
            return { status: 'completed', run };
          
          case 'requires_action':
            if (run.required_action?.type === 'submit_tool_outputs') {
              console.log(`Run ${runId} requires action: ${run.required_action.submit_tool_outputs.tool_calls.length} tool calls`);
              return { 
                status: 'requires_action', 
                run,
                toolCalls: run.required_action.submit_tool_outputs.tool_calls 
              };
            }
            break;
          
          case 'failed':
            console.error(`Run ${runId} failed:`, run.last_error);
            throw new Error(`Assistant run failed: ${run.last_error?.message || 'Unknown error'}`);
          
          case 'cancelled':
            throw new Error(`Assistant run was cancelled`);
          
          case 'expired':
            throw new Error(`Assistant run expired`);
          
          case 'queued':
          case 'in_progress':
          case 'cancelling':
            // Continue polling
            console.log(`Run ${runId} is ${run.status}, continuing to poll...`);
            break;
            
          default:
            console.warn(`Unknown run status: ${run.status}`);
            break;
        }

        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
      } catch (error) {
        console.error('Error polling run status:', error);
        throw error;
      }
    }

    throw new Error(`Assistant run polling timeout after ${maxAttempts} attempts (${(maxAttempts * intervalMs) / 1000}s)`);
  }

  /**
   * Submit tool outputs back to OpenAI
   */
  async submitToolOutputs(threadId, runId, toolOutputs) {
    try {
      console.log(`Submitting ${toolOutputs.length} tool outputs for run ${runId}:`);
      toolOutputs.forEach((output, index) => {
        console.log(`  ${index + 1}. Tool call ${output.tool_call_id}: ${output.output.substring(0, 100)}${output.output.length > 100 ? '...' : ''}`);
      });
      
      const run = await this.client.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs
      });

      console.log(`Tool outputs submitted successfully for run ${runId}, new status: ${run.status}`);
      return run;
    } catch (error) {
      console.error('Error submitting tool outputs:', error);
      console.error('Tool outputs that failed:', toolOutputs);
      throw new Error(`Failed to submit tool outputs: ${error.message}`);
    }
  }

  /**
   * Get messages from a thread
   */
  async getMessages(threadId, limit = 10) {
    try {
      const messages = await this.client.beta.threads.messages.list(threadId, {
        limit,
        order: 'desc'
      });
      return messages.data;
    } catch (error) {
      console.error('Error getting messages:', error);
      throw new Error(`Failed to retrieve messages: ${error.message}`);
    }
  }

  /**
   * Get the latest assistant message from a thread
   */
  async getLatestAssistantMessage(threadId) {
    try {
      const messages = await this.getMessages(threadId, 20); // Get more messages to find the latest assistant message
      const assistantMessage = messages.find(msg => msg.role === 'assistant');
      
      if (!assistantMessage) {
        console.error('No assistant message found in thread:', threadId);
        console.error('Available messages:', messages.map(m => ({ role: m.role, id: m.id })));
        throw new Error('No assistant message found');
      }

      // Extract text content from the message
      const textContent = assistantMessage.content
        .filter(content => content.type === 'text')
        .map(content => content.text.value)
        .join('\n');

      console.log(`Retrieved assistant message from thread ${threadId}: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);

      return {
        id: assistantMessage.id,
        content: textContent,
        created_at: assistantMessage.created_at
      };
    } catch (error) {
      console.error('Error getting latest assistant message:', error);
      throw new Error(`Failed to get assistant response: ${error.message}`);
    }
  }
}

module.exports = OpenAIService;