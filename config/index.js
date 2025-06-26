const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    assistantId: process.env.ASSISTANT_ID
  },
  webhook: {
    url: process.env.WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },
  // AI Employee configurations with individual webhook URLs
  employees: {
    brenden: {
      assistantId: 'asst_MvlMZ3IOvQrTkbsENRSzGRwZ',
      name: 'AI Brenden',
      role: 'lead scraper',
      specialty: 'Lead Research Specialist',
      webhookUrl: 'https://hook.eu2.make.com/lxa5qab0magprieff0sujnfkfycwu9x7'
    },
    van: {
      assistantId: 'asst_x0WhKHr61IUopNPR7A8No9kK',
      name: 'AI Van',
      role: 'page operator',
      specialty: 'Digital Marketing Designer',
      webhookUrl: 'https://hook.eu2.make.com/6e1mvvrxjd2dm5mbdvlgmxc2sut3r3lk'
    },
    angel: {
      assistantId: 'asst_angel_placeholder',
      name: 'AI Angel',
      role: 'voice caller',
      specialty: 'Voice Outreach Manager',
      webhookUrl: 'https://hook.eu2.make.com/angel_webhook_placeholder' // Add real webhook when ready
    }
    // EASILY ADD MORE EMPLOYEES HERE:
    // sarah: {
    //   assistantId: 'asst_sarah_id',
    //   name: 'AI Sarah',
    //   role: 'content creator',
    //   specialty: 'Content Marketing Specialist',
    //   webhookUrl: 'https://hook.eu2.make.com/sarah_webhook_url'
    // }
  }
};

// Validate required configuration
const requiredConfig = [
  { key: 'openai.apiKey', value: config.openai.apiKey, name: 'OPENAI_API_KEY' }
];

const missingConfig = requiredConfig.filter(item => 
  !item.value || 
  item.value.includes('your_') || 
  item.value === 'your_openai_api_key_here'
);

if (missingConfig.length > 0) {
  if (config.server.nodeEnv === 'development') {
    console.warn('⚠️  Running in demo mode - some features will be limited:');
    missingConfig.forEach(item => {
      console.warn(`   - ${item.name} not configured properly`);
    });
    console.warn('\n   To enable full functionality, please configure your .env file with real values.');
    console.warn('   The server will start but API calls will fail until properly configured.\n');
  } else {
    console.error('Missing or invalid required environment variables:');
    missingConfig.forEach(item => {
      console.error(`- ${item.name}`);
    });
    console.error('\nPlease check your .env file or environment variables.');
    process.exit(1);
  }
}

// Additional validation for API key format
if (config.openai.apiKey && !config.openai.apiKey.startsWith('sk-')) {
  console.error('Invalid OpenAI API key format. API keys should start with "sk-"');
  if (config.server.nodeEnv !== 'development') {
    process.exit(1);
  }
}

// Validate employee webhook URLs
console.log('\n🔗 Employee Webhook Configuration:');
Object.entries(config.employees).forEach(([key, employee]) => {
  const isConfigured = employee.webhookUrl && !employee.webhookUrl.includes('placeholder');
  const status = isConfigured ? '✅' : '⚠️';
  console.log(`   ${status} ${employee.name}: ${employee.webhookUrl}`);
});

module.exports = config;