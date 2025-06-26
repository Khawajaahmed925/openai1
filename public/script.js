class AICommandCenter {
    constructor() {
        this.currentEmployee = 'brenden';
        this.currentThreadId = null; // Track active thread
        this.conversationHistory = new Map(); // Store conversation history per employee
        this.employees = {
            brenden: {
                name: 'AI Brenden',
                role: 'lead scraper',
                specialty: 'Lead Research Specialist',
                avatar: 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop&crop=face',
                description: 'Expert data researcher specializing in B2B lead generation. I extract high-quality prospects from LinkedIn, Google Maps, and Yellow Pages with precision and attention to detail.',
                assistantId: 'asst_MvlMZ3IOvQrTkbsENRSzGRwZ',
                quickActions: [
                    'Find wedding venues in Los Angeles',
                    'Search event planners in Sherman Oaks',
                    'Get luxury hotels in LA area',
                    'Find corporate offices for subscriptions',
                    'Search restaurants with private dining',
                    'Find photography studios nearby'
                ]
            },
            van: {
                name: 'AI Van',
                role: 'page operator',
                specialty: 'Digital Marketing Designer',
                avatar: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop&crop=face',
                description: 'Creative digital marketing specialist focused on landing page design and conversion optimization. I create compelling pages that turn visitors into customers.',
                assistantId: 'asst_x0WhKHr61IUopNPR7A8No9kK',
                quickActions: [
                    'Create a SaaS landing page',
                    'Design a product launch page',
                    'Build a local business website',
                    'Generate a portfolio page',
                    'Create an event registration page',
                    'Design a contact form page'
                ]
            },
            angel: {
                name: 'AI Angel',
                role: 'voice caller',
                specialty: 'Voice Outreach Manager',
                avatar: 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop&crop=face',
                description: 'Professional voice communication specialist handling outbound calls and customer engagement. I manage phone campaigns with natural conversation skills.',
                assistantId: 'asst_angel_placeholder',
                quickActions: [
                    'Start a cold calling campaign',
                    'Schedule follow-up calls',
                    'Create call scripts',
                    'Analyze call performance',
                    'Set up voicemail campaigns',
                    'Generate call reports'
                ]
            }
        };
        
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.chatForm = document.getElementById('chatForm');
        this.charCount = document.getElementById('charCount');
        this.configModal = document.getElementById('configModal');
        this.closeModal = document.getElementById('closeModal');
        this.configContent = document.getElementById('configContent');
        this.newChatButton = document.getElementById('newChatBtn');
        
        this.isWaiting = false;
        this.currentTypingMessage = null;
        
        this.init();
    }
    
    init() {
        this.setupNavigation();
        this.setupEmployeeSelection();
        this.setupTabs();
        this.setupQuickActions();
        this.setupChat();
        this.setupModal();
        this.setupMobileMenu();
        this.setupColorScheme();
        this.setupNewChatButton();
        
        // Focus input on load
        this.messageInput.focus();
        
        // Check server status on load
        this.checkServerStatus();
        
        // Initialize with default employee
        this.switchEmployee('brenden');
        
        // Load conversation history from localStorage
        this.loadConversationHistory();
    }
    
    setupNewChatButton() {
        if (this.newChatButton) {
            this.newChatButton.addEventListener('click', () => {
                this.startNewChat();
            });
        }
    }
    
    startNewChat() {
        console.log(`🆕 Starting new chat for ${this.employees[this.currentEmployee].name}`);
        
        // Clear current thread
        this.currentThreadId = null;
        
        // Clear conversation history for current employee
        this.conversationHistory.delete(this.currentEmployee);
        
        // Clear chat messages
        this.clearChat();
        
        // Show welcome message
        this.showWelcomeMessage(this.employees[this.currentEmployee]);
        
        // Save updated history
        this.saveConversationHistory();
        
        // Show notification
        this.showNotification(`🆕 Started new conversation with ${this.employees[this.currentEmployee].name}`, 'success');
        
        // Focus input
        this.messageInput.focus();
    }
    
    loadConversationHistory() {
        try {
            const saved = localStorage.getItem('orchid-conversation-history');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.conversationHistory = new Map(Object.entries(parsed.conversations || {}));
                
                // Restore current thread ID if exists
                if (parsed.currentThreads && parsed.currentThreads[this.currentEmployee]) {
                    this.currentThreadId = parsed.currentThreads[this.currentEmployee];
                }
                
                console.log('📚 Loaded conversation history:', {
                    employees: Array.from(this.conversationHistory.keys()),
                    currentThread: this.currentThreadId
                });
            }
        } catch (error) {
            console.error('Failed to load conversation history:', error);
            this.conversationHistory = new Map();
        }
    }
    
    saveConversationHistory() {
        try {
            const currentThreads = {};
            if (this.currentThreadId) {
                currentThreads[this.currentEmployee] = this.currentThreadId;
            }
            
            const toSave = {
                conversations: Object.fromEntries(this.conversationHistory),
                currentThreads: currentThreads,
                lastUpdated: new Date().toISOString()
            };
            
            localStorage.setItem('orchid-conversation-history', JSON.stringify(toSave));
            console.log('💾 Saved conversation history');
        } catch (error) {
            console.error('Failed to save conversation history:', error);
        }
    }
    
    restoreConversationForEmployee(employeeId) {
        const history = this.conversationHistory.get(employeeId);
        if (!history || !history.messages || history.messages.length === 0) {
            console.log(`📝 No conversation history for ${this.employees[employeeId].name}`);
            return;
        }
        
        console.log(`📚 Restoring ${history.messages.length} messages for ${this.employees[employeeId].name}`);
        
        // Clear current messages
        this.clearChat();
        
        // Show welcome message first
        this.showWelcomeMessage(this.employees[employeeId]);
        
        // Restore messages
        history.messages.forEach(msg => {
            this.addMessageToUI(msg.content, msg.sender, msg.timestamp, false);
        });
        
        // Restore thread ID
        this.currentThreadId = history.threadId || null;
        
        // Update chat status
        if (this.currentThreadId) {
            this.showThreadStatus(`📝 Continuing conversation (Thread: ${this.currentThreadId.substring(0, 8)}...)`);
        }
        
        // Scroll to bottom
        this.scrollToBottom();
    }
    
    addMessageToHistory(content, sender, threadId = null) {
        if (!this.conversationHistory.has(this.currentEmployee)) {
            this.conversationHistory.set(this.currentEmployee, {
                messages: [],
                threadId: null,
                lastUpdated: new Date().toISOString()
            });
        }
        
        const history = this.conversationHistory.get(this.currentEmployee);
        
        // Update thread ID if provided
        if (threadId) {
            history.threadId = threadId;
            this.currentThreadId = threadId;
        }
        
        // Add message
        history.messages.push({
            content,
            sender,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 50 messages to prevent storage bloat
        if (history.messages.length > 50) {
            history.messages = history.messages.slice(-50);
        }
        
        history.lastUpdated = new Date().toISOString();
        
        // Save to localStorage
        this.saveConversationHistory();
    }
    
    showThreadStatus(message) {
        // Remove existing thread status
        const existingStatus = this.chatMessages.querySelector('.thread-status');
        if (existingStatus) {
            existingStatus.remove();
        }
        
        const statusDiv = document.createElement('div');
        statusDiv.className = 'thread-status';
        statusDiv.innerHTML = `
            <div class="status-content">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>${message}</span>
            </div>
        `;
        
        // Insert after welcome message
        const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.insertAdjacentElement('afterend', statusDiv);
        } else {
            this.chatMessages.appendChild(statusDiv);
        }
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span>${message}</span>
                <button class="notification-close">&times;</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
        
        // Manual close
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });
    }
    
    setupMobileMenu() {
        const mobileToggle = document.getElementById('mobileMenuToggle');
        const sidebar = document.getElementById('sidebar');
        
        if (mobileToggle && sidebar) {
            mobileToggle.addEventListener('click', () => {
                sidebar.classList.toggle('mobile-open');
            });
            
            // Close sidebar when clicking outside on mobile
            document.addEventListener('click', (e) => {
                if (window.innerWidth <= 768 && 
                    !sidebar.contains(e.target) && 
                    !mobileToggle.contains(e.target) &&
                    sidebar.classList.contains('mobile-open')) {
                    sidebar.classList.remove('mobile-open');
                }
            });
        }
    }
    
    setupColorScheme() {
        const primaryPicker = document.getElementById('primaryPicker');
        const primaryInput = document.getElementById('primaryInput');
        const secondaryPicker = document.getElementById('secondaryPicker');
        const secondaryInput = document.getElementById('secondaryInput');
        const accentPicker = document.getElementById('accentPicker');
        const accentInput = document.getElementById('accentInput');
        const saveBtn = document.getElementById('saveColorsBtn');
        
        if (!primaryPicker || !saveBtn) return;
        
        // Sync color picker with text input
        const syncColorInputs = (picker, input) => {
            picker.addEventListener('input', () => {
                input.value = picker.value.toUpperCase();
                this.updateCSSVariable(input.id.replace('Input', ''), picker.value);
            });
            
            input.addEventListener('input', () => {
                if (this.isValidHexColor(input.value)) {
                    picker.value = input.value;
                    this.updateCSSVariable(input.id.replace('Input', ''), input.value);
                }
            });
        };
        
        syncColorInputs(primaryPicker, primaryInput);
        syncColorInputs(secondaryPicker, secondaryInput);
        syncColorInputs(accentPicker, accentInput);
        
        // Save colors
        saveBtn.addEventListener('click', () => {
            this.saveColorScheme();
        });
        
        // Load saved colors on init
        this.loadColorScheme();
    }
    
    isValidHexColor(hex) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
    }
    
    updateCSSVariable(colorType, value) {
        const root = document.documentElement;
        switch(colorType) {
            case 'primary':
                root.style.setProperty('--primary-color', value);
                break;
            case 'secondary':
                root.style.setProperty('--secondary-color', value);
                break;
            case 'accent':
                root.style.setProperty('--accent-color', value);
                break;
        }
    }
    
    saveColorScheme() {
        const colors = {
            primary: document.getElementById('primaryInput').value,
            secondary: document.getElementById('secondaryInput').value,
            accent: document.getElementById('accentInput').value
        };
        
        localStorage.setItem('orchid-color-scheme', JSON.stringify(colors));
        
        // Show notification
        this.showColorNotification('Color scheme saved successfully!', colors.primary);
    }
    
    loadColorScheme() {
        const saved = localStorage.getItem('orchid-color-scheme');
        if (saved) {
            const colors = JSON.parse(saved);
            
            // Update inputs
            document.getElementById('primaryPicker').value = colors.primary;
            document.getElementById('primaryInput').value = colors.primary;
            document.getElementById('secondaryPicker').value = colors.secondary;
            document.getElementById('secondaryInput').value = colors.secondary;
            document.getElementById('accentPicker').value = colors.accent;
            document.getElementById('accentInput').value = colors.accent;
            
            // Update CSS variables
            this.updateCSSVariable('primary', colors.primary);
            this.updateCSSVariable('secondary', colors.secondary);
            this.updateCSSVariable('accent', colors.accent);
        }
    }
    
    showColorNotification(message, color) {
        const notification = document.createElement('div');
        notification.className = 'color-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <div class="color-preview" style="background-color: ${color}"></div>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const contentSections = document.querySelectorAll('.content-section');
        
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.dataset.section;
                
                // Update nav active state
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                // Update content sections
                contentSections.forEach(content => content.classList.remove('active'));
                document.getElementById(`${section}-section`).classList.add('active');
                
                // Close mobile menu
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    sidebar.classList.remove('mobile-open');
                }
            });
        });
    }
    
    setupEmployeeSelection() {
        const teamMembers = document.querySelectorAll('.team-member');
        
        teamMembers.forEach(member => {
            member.addEventListener('click', () => {
                const employeeId = member.dataset.employee;
                this.switchEmployee(employeeId);
                
                // Update active state
                teamMembers.forEach(m => m.classList.remove('active'));
                member.classList.add('active');
            });
        });
    }
    
    switchEmployee(employeeId) {
        if (!this.employees[employeeId]) return;
        
        const previousEmployee = this.currentEmployee;
        this.currentEmployee = employeeId;
        const employee = this.employees[employeeId];
        
        console.log(`🔄 Switching from ${this.employees[previousEmployee]?.name} to ${employee.name}`);
        
        // Update chat header
        document.getElementById('current-employee-avatar').src = employee.avatar;
        document.getElementById('current-employee-name').textContent = employee.name;
        document.getElementById('current-employee-role').textContent = employee.role;
        document.getElementById('current-employee-specialty').textContent = employee.specialty;
        document.getElementById('employee-description').textContent = employee.description;
        
        // Update placeholder
        this.messageInput.placeholder = `Ask ${employee.name} to help you... (e.g., 'Find florists in Los Angeles')`;
        
        // Restore conversation history for this employee
        this.restoreConversationForEmployee(employeeId);
        
        // If no history, show welcome message
        const history = this.conversationHistory.get(employeeId);
        if (!history || !history.messages || history.messages.length === 0) {
            this.showWelcomeMessage(employee);
        }
        
        this.updateQuickActions(employee);
        
        // Check connection status
        this.checkEmployeeConnection(employeeId);
        
        // Update new chat button text
        if (this.newChatButton) {
            this.newChatButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    <path d="M12 7v6m3-3H9"></path>
                </svg>
                New Chat with ${employee.name}
            `;
        }
    }
    
    async checkEmployeeConnection(employeeId) {
        try {
            const response = await fetch(`/api/assistant-info?employee=${employeeId}`);
            const data = await response.json();
            
            if (!response.ok) {
                if (response.status === 503) {
                    this.showConnectionStatus(false, data.details);
                } else {
                    this.showConnectionStatus(false, `Connection error: ${data.details || data.error}`);
                }
                return;
            }
            
            this.showConnectionStatus(true, `Connected to ${data.name || 'OpenAI Assistant'}`);
        } catch (error) {
            console.error('Failed to check employee connection:', error);
            this.showConnectionStatus(false, 'Unable to verify connection');
        }
    }
    
    showConnectionStatus(isConnected, message) {
        // Remove existing status
        const existingStatus = this.chatMessages.querySelector('.connection-status');
        if (existingStatus) {
            existingStatus.remove();
        }
        
        const statusDiv = document.createElement('div');
        statusDiv.className = 'connection-status';
        statusDiv.innerHTML = `
            <div class="status-indicator">
                <div class="status-dot ${isConnected ? 'online' : 'offline'}"></div>
                <div class="status-text">${isConnected ? 'Connected' : 'Disconnected'}</div>
            </div>
            <p class="status-note">${message}</p>
        `;
        
        // Insert after welcome message
        const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.insertAdjacentElement('afterend', statusDiv);
        } else {
            this.chatMessages.appendChild(statusDiv);
        }
    }
    
    updateQuickActions(employee) {
        const quickActionsContainer = document.querySelector('.quick-actions');
        if (!quickActionsContainer || !employee.quickActions) return;
        
        quickActionsContainer.innerHTML = '';
        
        employee.quickActions.forEach(action => {
            const actionDiv = document.createElement('div');
            actionDiv.className = 'quick-action';
            actionDiv.dataset.action = action;
            actionDiv.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="M21 21l-4.35-4.35"></path>
                </svg>
                ${action}
            `;
            
            actionDiv.addEventListener('click', () => {
                this.messageInput.value = action;
                this.handleInput();
                this.sendMessage(action);
            });
            
            quickActionsContainer.appendChild(actionDiv);
        });
    }
    
    clearChat() {
        const messages = this.chatMessages.querySelectorAll('.message, .error-message, .tool-call-status, .connection-status, .thread-status');
        messages.forEach(msg => msg.remove());
    }
    
    showWelcomeMessage(employee) {
        const welcomeMessage = document.querySelector('.welcome-message');
        if (welcomeMessage) {
            const welcomeContent = welcomeMessage.querySelector('.welcome-content');
            welcomeContent.innerHTML = `
                <h4>Hi! I'm ${employee.name}, your ${employee.specialty}.</h4>
                <p>Ask me to help with ${employee.role === 'lead scraper' ? 'lead generation and research' : employee.role === 'page operator' ? 'landing pages and marketing design' : 'voice calls and customer outreach'} or use the quick actions above.</p>
            `;
        }
    }
    
    setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                
                // Update tab buttons
                tabBtns.forEach(tab => tab.classList.remove('active'));
                btn.classList.add('active');
                
                // Update tab content
                tabContents.forEach(content => content.classList.remove('active'));
                const targetTab = document.getElementById(`${tabId}-tab`);
                if (targetTab) {
                    targetTab.classList.add('active');
                }
            });
        });
    }
    
    setupQuickActions() {
        // Quick actions are now handled in updateQuickActions
    }
    
    setupChat() {
        // Event listeners
        this.chatForm.addEventListener('submit', (e) => this.handleSubmit(e));
        this.messageInput.addEventListener('input', () => this.handleInput());
        this.messageInput.addEventListener('keydown', (e) => this.handleKeydown(e));
        
        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => this.autoResize());
    }
    
    setupModal() {
        const configButton = document.getElementById('configureBtn');
        
        configButton.addEventListener('click', () => this.showConfigModal());
        this.closeModal.addEventListener('click', () => this.hideConfigModal());
        
        // Close modal when clicking outside
        this.configModal.addEventListener('click', (e) => {
            if (e.target === this.configModal) {
                this.hideConfigModal();
            }
        });
    }
    
    async checkServerStatus() {
        try {
            console.log('🔍 Checking server status...');
            const response = await fetch('/api/status');
            
            console.log('📊 Server status response:', {
                status: response.status,
                ok: response.ok,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('✅ Server status data:', data);
            
            if (!data.services_initialized.openai || !data.configuration.api_key_configured) {
                this.addErrorMessage('⚠️ Server configuration incomplete. Please check your environment variables.');
            }
        } catch (error) {
            console.error('❌ Failed to check server status:', error);
            this.addErrorMessage('⚠️ Unable to connect to server. Please check if the server is running.');
        }
    }
    
    async showConfigModal() {
        this.configModal.style.display = 'flex';
        this.configContent.innerHTML = '<div class="loading">Loading configuration...</div>';
        
        try {
            const response = await fetch(`/api/assistant-info?employee=${this.currentEmployee}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.details || data.error);
            }
            
            this.displayConfigInfo(data);
        } catch (error) {
            this.configContent.innerHTML = `
                <div class="error-message">
                    Failed to load assistant configuration: ${error.message}
                </div>
            `;
        }
    }
    
    displayConfigInfo(config) {
        const html = `
            <div class="config-section">
                <h3>Basic Information</h3>
                <div class="config-item">
                    <div class="config-label">Assistant ID</div>
                    <div class="config-value">${config.id}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Name</div>
                    <div class="config-value">${config.name || 'Not set'}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Model</div>
                    <div class="config-value">${config.model}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Description</div>
                    <div class="config-value">${config.description || 'Not set'}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Employee</div>
                    <div class="config-value">${config.employee?.name} (${config.employee?.role})</div>
                </div>
            </div>
            
            <div class="config-section">
                <h3>Instructions</h3>
                <div class="config-item">
                    <div class="config-value" style="white-space: pre-wrap; font-family: monospace; font-size: 12px;">${config.instructions || 'No instructions set'}</div>
                </div>
            </div>
            
            <div class="config-section">
                <h3>Tools</h3>
                ${config.tools && config.tools.length > 0 ? 
                    config.tools.map(tool => `
                        <div class="config-item">
                            <div class="config-label">${tool.type}</div>
                            <div class="config-value">${tool.function ? tool.function.name : 'Built-in tool'}</div>
                        </div>
                    `).join('') : 
                    '<div class="config-item"><div class="config-value">No tools configured</div></div>'
                }
            </div>
        `;
        
        this.configContent.innerHTML = html;
    }
    
    hideConfigModal() {
        this.configModal.style.display = 'none';
    }
    
    handleSubmit(e) {
        e.preventDefault();
        
        if (this.isWaiting) return;
        
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        this.sendMessage(message);
    }
    
    handleInput() {
        const length = this.messageInput.value.length;
        this.charCount.textContent = length;
        
        // Update character count styling
        const charCountElement = this.charCount.parentElement;
        charCountElement.classList.remove('warning', 'error');
        
        if (length > 3500) {
            charCountElement.classList.add('warning');
        }
        if (length > 3800) {
            charCountElement.classList.add('error');
        }
        
        // Enable/disable send button
        this.sendButton.disabled = length === 0 || length > 4000 || this.isWaiting;
    }
    
    handleKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!this.isWaiting && this.messageInput.value.trim()) {
                this.handleSubmit(e);
            }
        }
    }
    
    autoResize() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
    }
    
    async sendMessage(message) {
        console.log(`🚀 Sending message to ${this.employees[this.currentEmployee].name}:`, message);
        
        // Add user message to chat and history
        this.addMessage(message, 'user');
        
        // Clear input and reset
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        this.charCount.textContent = '0';
        this.charCount.parentElement.classList.remove('warning', 'error');
        
        // Set waiting state
        this.setWaitingState(true);
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            const requestBody = { 
                message,
                employee: this.currentEmployee
            };
            
            // Include thread ID if we have an active conversation
            if (this.currentThreadId) {
                requestBody.thread_id = this.currentThreadId;
                console.log(`📝 Using existing thread: ${this.currentThreadId}`);
            } else {
                console.log('🆕 Creating new thread for conversation');
            }
            
            console.log('📤 Request body:', requestBody);
            
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });
            
            console.log('📥 Response received:', {
                status: response.status,
                ok: response.ok,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            console.log('📋 Content-Type:', contentType);
            
            if (!contentType || !contentType.includes('application/json')) {
                const textResponse = await response.text();
                console.error('❌ Non-JSON response received:', textResponse);
                throw new Error('Server returned non-JSON response. Please check server logs.');
            }
            
            const data = await response.json();
            console.log('✅ JSON data received:', data);
            
            if (!response.ok) {
                throw new Error(data.details || data.error || `HTTP ${response.status}`);
            }
            
            // Hide typing indicator
            this.hideTypingIndicator();
            
            // Store thread ID for future messages
            if (data.thread_id) {
                this.currentThreadId = data.thread_id;
                this.addMessageToHistory(message, 'user', data.thread_id);
                
                // Show thread status if this is the first message
                const history = this.conversationHistory.get(this.currentEmployee);
                if (!history || history.messages.length <= 1) {
                    this.showThreadStatus(`📝 Started new conversation (Thread: ${data.thread_id.substring(0, 8)}...)`);
                }
            }
            
            if (data.status === 'completed') {
                console.log(`✅ ${this.employees[this.currentEmployee].name} completed without tool calls`);
                // Assistant completed without tool calls
                this.addMessage(data.message, 'assistant');
            } else if (data.status === 'requires_action') {
                console.log(`🔧 ${this.employees[this.currentEmployee].name} requires tool calls:`, data.tool_calls?.length || 0);
                // Tool calls were sent to webhook
                this.addMessage(data.message, 'assistant');
                this.addToolCallStatus(data.tool_calls);
                
                // Keep waiting state until webhook responses come back
                // In a real implementation, you might want to poll for updates
                // or use WebSockets for real-time updates
            }
            
        } catch (error) {
            console.error('❌ Error sending message:', error);
            this.hideTypingIndicator();
            this.addErrorMessage(`Failed to send message: ${error.message}`);
        } finally {
            this.setWaitingState(false);
        }
    }
    
    addMessage(content, sender) {
        this.addMessageToUI(content, sender, new Date().toISOString(), true);
    }
    
    addMessageToUI(content, sender, timestamp, addToHistory = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Handle multiline content
        const paragraphs = content.split('\n').filter(p => p.trim());
        if (paragraphs.length > 1) {
            paragraphs.forEach(paragraph => {
                const p = document.createElement('p');
                p.textContent = paragraph;
                contentDiv.appendChild(p);
            });
        } else {
            const p = document.createElement('p');
            p.textContent = content;
            contentDiv.appendChild(p);
        }
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = this.formatTime(new Date(timestamp));
        
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timeDiv);
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
        
        // Add to conversation history
        if (addToHistory) {
            this.addMessageToHistory(content, sender);
        }
    }
    
    addErrorMessage(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        
        this.chatMessages.appendChild(errorDiv);
        this.scrollToBottom();
    }
    
    addToolCallStatus(toolCalls) {
        if (!toolCalls || toolCalls.length === 0) return;
        
        const statusDiv = document.createElement('div');
        statusDiv.className = 'tool-call-status';
        
        const functionNames = toolCalls.map(tc => tc.function).join(', ');
        statusDiv.textContent = `🔧 Executing tools: ${functionNames}`;
        
        this.chatMessages.appendChild(statusDiv);
        this.scrollToBottom();
    }
    
    showTypingIndicator() {
        const template = document.getElementById('typingTemplate');
        this.currentTypingMessage = template.cloneNode(true);
        this.currentTypingMessage.id = '';
        this.currentTypingMessage.style.display = 'flex';
        
        this.chatMessages.appendChild(this.currentTypingMessage);
        this.scrollToBottom();
    }
    
    hideTypingIndicator() {
        if (this.currentTypingMessage) {
            this.currentTypingMessage.remove();
            this.currentTypingMessage = null;
        }
    }
    
    setWaitingState(waiting) {
        this.isWaiting = waiting;
        this.sendButton.disabled = waiting || this.messageInput.value.trim().length === 0;
        this.messageInput.disabled = waiting;
        
        // Disable new chat button while processing
        if (this.newChatButton) {
            this.newChatButton.disabled = waiting;
        }
    }
    
    scrollToBottom() {
        setTimeout(() => {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }, 100);
    }
    
    formatTime(date) {
        return date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
}

// Initialize command center when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AICommandCenter();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Page became visible, focus input
        const messageInput = document.getElementById('messageInput');
        if (messageInput && !messageInput.disabled) {
            messageInput.focus();
        }
    }
});