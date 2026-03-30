// Configuration
const OLLAMA_API = 'http://localhost:11434/api/chat';
const DEFAULT_MODEL = 'deepseek-r1:1.5b';

// State Management
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem('lumina_chats')) || {};
let isGenerating = false;

// DOM Elements
const messagesContainer = document.getElementById('messages-container');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('history-list');
const ollamaStatus = document.getElementById('ollama-status');
const statusText = document.getElementById('status-text');
const welcomeScreen = document.getElementById('welcome-screen');
const newChatBtn = document.getElementById('new-chat-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const currentChatTitle = document.getElementById('current-chat-title');

// Initialize
function init() {
    renderHistory();
    checkOllamaStatus();

    // Event Listeners
    chatInput.addEventListener('input', handleInputPaste);
    chatInput.addEventListener('keydown', handleKeyDown);
    sendBtn.addEventListener('click', sendMessage);
    newChatBtn.addEventListener('click', startNewChat);
    clearChatBtn.addEventListener('click', deleteCurrentChat);

    // Auto-focus input
    chatInput.focus();
}

// --- API & Core Logic ---

async function checkOllamaStatus() {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) {
            ollamaStatus.classList.add('online');
            statusText.innerText = 'Ollama Online';
            sendBtn.disabled = !chatInput.value.trim();
        } else {
            throw new Error();
        }
    } catch (e) {
        ollamaStatus.classList.remove('online');
        statusText.innerText = 'Ollama Offline';
        sendBtn.disabled = true;
    }
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isGenerating) return;

    // Reset UI
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;
    welcomeScreen.style.display = 'none';
    isGenerating = true;

    // Add user message to UI & State
    addMessage('user', text);
    saveChatState();

    // Prepare AI container
    const aiMessageEl = createMessageElement('ai', '');
    const bubble = aiMessageEl.querySelector('.message-bubble');
    const textContentEl = bubble.querySelector('.text-content');
    messagesContainer.appendChild(aiMessageEl);

    let fullResponse = '';
    let currentThinkContent = '';
    let isThinking = false;
    let thinkContainer = null;

    try {
        const history = (chats[currentChatId] || []).slice(0, -1); // Exclude the user message we just added
        const response = await fetch(OLLAMA_API, {
            method: 'POST',
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: (chats[currentChatId] || []).map(m => ({ role: m.role, content: m.content })),
                stream: true
            }),
            headers: { 'Content-Type': 'application/json' }
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    const content = data.message.content;
                    fullResponse += content;

                    if (content.includes('<think>')) {
                        isThinking = true;
                        thinkContainer = createThinkContainer();
                        bubble.insertBefore(thinkContainer, textContentEl);
                        continue;
                    }

                    if (content.includes('</think>')) {
                        isThinking = false;
                        continue;
                    }

                    if (isThinking && thinkContainer) {
                        const contentEl = thinkContainer.querySelector('.thinking-content');
                        contentEl.innerText += content;
                    } else {
                        // Regular response content
                        const cleanContent = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                        textContentEl.innerHTML = marked.parse(cleanContent);
                        // Highlight only on new blocks or at the end to save performance
                    }

                    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'instant' });
                } catch (e) {
                    // console.error('Error parsing JSON chunk', e);
                }
            }
        }
    } catch (error) {
        textContentEl.innerHTML = `<span style="color: #ef4444;">Error: ${error.message}. Make sure Ollama is running.</span>`;
    } finally {
        isGenerating = false;
        checkOllamaStatus();
        addMessage('assistant', fullResponse, true); // Update state only
        saveChatState();
        Prism.highlightAllUnder(textContentEl);
    }
}

// --- UI Helpers ---

function handleInputPaste() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    sendBtn.disabled = !this.value.trim() || !ollamaStatus.classList.contains('online');
}

chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    sendBtn.disabled = !this.value.trim() || !ollamaStatus.classList.contains('online');
});

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function createMessageElement(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    // For AI messages, we might have thinking blocks already if loading from history
    let cleanContent = content;
    let thinkBlock = '';

    if (role === 'ai') {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            thinkBlock = thinkMatch[1];
            cleanContent = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        }
    }

    div.innerHTML = `
        <div class="message-bubble">
            ${thinkBlock ? `<div class="thinking-container collapsed">
                <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <span>Thinking Process</span>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="thinking-content">${thinkBlock}</div>
            </div>` : ''}
            <div class="text-content">${role === 'user' ? content : (cleanContent ? marked.parse(cleanContent) : '')}</div>
        </div>
    `;

    if (role === 'ai' && cleanContent) {
        setTimeout(() => Prism.highlightAllUnder(div), 0);
    }

    return div;
}

function createThinkContainer() {
    const container = document.createElement('div');
    container.className = 'thinking-container';
    container.innerHTML = `
        <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <span>Thinking Process</span>
            <span class="toggle-icon">▼</span>
        </div>
        <div class="thinking-content"></div>
    `;
    return container;
}

function addMessage(role, content, stateOnly = false) {
    if (!chats[currentChatId]) chats[currentChatId] = [];
    chats[currentChatId].push({ role, content });

    if (!stateOnly) {
        const el = createMessageElement(role, content);
        messagesContainer.appendChild(el);
        messagesContainer.scrollTo(0, messagesContainer.scrollHeight);
    }
}

// --- State & History ---

function saveChatState() {
    localStorage.setItem('lumina_chats', JSON.stringify(chats));
    renderHistory();
}

function renderHistory() {
    historyList.innerHTML = '';
    const sortedIds = Object.keys(chats).sort((a, b) => b - a);

    sortedIds.forEach(id => {
        const chat = chats[id];
        if (chat.length === 0) return;

        const firstMessage = chat[0].content;
        const div = document.createElement('div');
        div.className = `history-item ${id === currentChatId ? 'active' : ''}`;
        div.innerText = firstMessage.substring(0, 30) + (firstMessage.length > 30 ? '...' : '');
        div.onclick = () => loadChat(id);
        historyList.appendChild(div);
    });
}

function loadChat(id) {
    if (isGenerating) return;
    currentChatId = id;
    messagesContainer.innerHTML = '';
    welcomeScreen.style.display = 'none';

    const chat = chats[id];
    chat.forEach(msg => {
        const el = createMessageElement(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
        messagesContainer.appendChild(el);
    });

    currentChatTitle.innerText = chat[0].content.substring(0, 20) + '...';
    renderHistory();
    messagesContainer.scrollTo(0, messagesContainer.scrollHeight);
}

function startNewChat() {
    if (isGenerating) return;
    currentChatId = Date.now().toString();
    messagesContainer.innerHTML = '';
    welcomeScreen.style.display = 'flex';
    currentChatTitle.innerText = 'New Conversation';
    renderHistory();
    chatInput.focus();
}

function deleteCurrentChat() {
    if (confirm('Are you sure you want to clear this conversation?')) {
        delete chats[currentChatId];
        saveChatState();
        startNewChat();
    }
}

// Start
init();
