/**
 * ==========================================
 * CONFIG
 * ==========================================
 */
const CONFIG = {
    MODEL: 'gemini-1.5-flash',
    API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    PULSE_MAX_WORDS: 20,
    MAX_RETRIES: 3,
    STATUSES: {
        IN_PROGRESS: 'In Progress',
        BLOCKED: 'Blocked',
        COMPLETED: 'Completed',
        NEEDS_DECISION: 'Needs Decision'
    },
    ANIMATION_DELAY: 0.1,
    SUCCESS_TIMEOUT: 3000,
    PAST_TIME_MINS: 12
};

/**
 * ==========================================
 * STATE
 * ==========================================
 */
const STATE = {
    pulseText: "Waiting for team updates...",
    pulseNeedsUpdate: true,
    teamData: {
        Priya: { role: 'Designer', tasks: [], lastUpdated: null, parseError: false },
        Arjun: { role: 'Developer', tasks: [], lastUpdated: null, parseError: false },
        Meera: { role: 'Marketer', tasks: [], lastUpdated: null, parseError: false },
        Rohan: { role: 'Founder', tasks: [], lastUpdated: null, parseError: false }
    }
};

/**
 * ==========================================
 * API
 * ==========================================
 */

// SECURITY NOTE: API key is stored in sessionStorage (tab-scoped, never persisted)
// and transmitted only to generativelanguage.googleapis.com via HTTPS.
// Never logged, never sent to any third-party endpoint.

/**
 * @description Fetches content from Gemini API using the provided prompt
 * @param {string} prompt - The prompt to send to Gemini
 * @returns {Promise<string>} The generated text response
 */
async function callGemini(prompt) {
    const apiKey = sessionStorage.getItem('gemini_api_key');
    if (!apiKey) throw new Error('API Key is missing');

    const response = await fetch(`${CONFIG.API_URL}/${CONFIG.MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 }
        })
    });

    if (response.status === 401) throw new Error('API_KEY_INVALID');
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

/**
 * @description Wraps the Gemini API call with a retry mechanism
 * @param {string} prompt - The prompt to send
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<string>} The API response text
 */
async function callGeminiWithRetry(prompt, maxRetries = CONFIG.MAX_RETRIES) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await callGemini(prompt);
            return result;
        } catch (error) {
            if (attempt === maxRetries || error.message === 'API_KEY_INVALID') throw error;
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

/**
 * ==========================================
 * UI
 * ==========================================
 */

/**
 * @description Shows a system banner at the top of the screen
 * @param {string} msg - The message to display
 * @param {string} type - The class name indicating color/type
 * @returns {void}
 */
function showBanner(msg, type) {
    const banner = document.getElementById('system-banner');
    banner.textContent = msg;
    banner.className = `banner ${type}`;
}

/**
 * @description Hides the system banner
 * @returns {void}
 */
function hideBanner() {
    const banner = document.getElementById('system-banner');
    banner.classList.add('hidden');
}

/**
 * @description Formats a date into a time ago string
 * @param {Date} date - The date to format
 * @returns {string} The formatted string
 */
function getTimeAgo(date) {
    if (!date) return '';
    const minutes = Math.floor((new Date() - date) / 60000);
    if (minutes < 1) return 'Updated just now';
    return `Updated ${minutes} min${minutes !== 1 ? 's' : ''} ago`;
}

/**
 * @description Generates HTML for a single task card
 * @param {Object} task - The task object
 * @param {number} index - The index for animation delay
 * @returns {string} The HTML string for the task card
 */
function generateTaskCardHtml(task, index) {
    let tagClass = 'status-progress';
    let statusText = task.status || CONFIG.STATUSES.IN_PROGRESS;
    let icon = '● ';
    
    if (statusText === CONFIG.STATUSES.COMPLETED) {
        tagClass = 'status-completed';
        icon = '✓ ';
    } else if (statusText === CONFIG.STATUSES.BLOCKED) {
        tagClass = 'status-blocked';
        icon = '✕ ';
    } else if (statusText === CONFIG.STATUSES.NEEDS_DECISION) {
        tagClass = 'status-decision';
        icon = '◆ ';
    }

    const blockerHtml = (statusText === CONFIG.STATUSES.BLOCKED && task.blocker) 
        ? `<div class="blocker-section"><strong>Blocked by:</strong> ${task.blocker}</div>` : '';
    
    const extraCardClass = statusText === CONFIG.STATUSES.BLOCKED ? 'blocked-card' : '';
    const delay = index * CONFIG.ANIMATION_DELAY;

    return `
        <div class="task-card fade-in ${extraCardClass}" style="animation-delay: ${delay}s">
            <span class="status-tag ${tagClass}" role="status" aria-label="Task status: ${statusText}">${icon}${statusText}</span>
            <p>${task.task}</p>
            ${blockerHtml}
        </div>
    `;
}

/**
 * @description Generates HTML for a needs attention item using CSS classes instead of inline styles
 * @param {Object} task - The task object
 * @param {string} memberName - The team member's name
 * @param {number} index - The index for animation delay
 * @returns {string} The HTML string for the attention item
 */
function generateAttentionItemHtml(task, memberName, index) {
    const isBlocked = task.status === CONFIG.STATUSES.BLOCKED;
    const unblockText = isBlocked ? (task.blocker || 'Needs unblocking') : 'Needs decision to proceed';
    const borderClass = isBlocked ? 'attention-blocked' : 'attention-decision';
    const delay = index * CONFIG.ANIMATION_DELAY;

    return `
        <div class="attention-item fade-in ${borderClass}" style="animation-delay: ${delay}s">
            <span class="attention-member">${memberName}</span>
            <div class="attention-task">${task.task}</div>
            <div class="attention-unblock"><strong>Needed:</strong> ${unblockText}</div>
        </div>
    `;
}

/**
 * @description Generates the HTML for an entire member column, lazy loading empty columns
 * @param {string} name - Member name
 * @param {Object} data - Member data
 * @param {string} cardsHtml - Pre-rendered cards HTML
 * @returns {string} HTML string for the column
 */
function generateMemberColumnHtml(name, data, cardsHtml) {
    if (data.parseError) {
        cardsHtml = '<p class="inline-error">Update received — processing took longer than expected. Try submitting again.</p>';
    } else if (data.tasks.length === 0) {
        // Lightweight empty placeholder
        return `
            <div class="member-column empty-column fade-in">
                <div class="column-header">
                    <h3>${name}</h3>
                    <span>${data.role}</span>
                </div>
                <p class="empty-state-text">No update yet today</p>
            </div>
        `;
    }

    const timeStr = data.lastUpdated ? `<span class="column-time">${getTimeAgo(data.lastUpdated)}</span>` : '';

    return `
        <div class="member-column fade-in">
            <div class="column-header">
                <h3>${name}</h3>
                <span>${data.role}</span>
                ${timeStr}
            </div>
            ${cardsHtml}
        </div>
    `;
}

/**
 * @description Processes a single member's data and returns pre-rendered HTML strings
 * @param {string} name - Member name
 * @param {Object} data - Member data
 * @returns {Object} Object containing column HTML, attention HTML, and issue flag
 */
function processMemberData(name, data) {
    let cardsHtml = '';
    let attentionHtml = '';
    let hasIssues = false;

    if (!data.parseError && data.tasks.length > 0) {
        data.tasks.forEach((task, index) => {
            cardsHtml += generateTaskCardHtml(task, index);
            if (task.status === CONFIG.STATUSES.BLOCKED || task.status === CONFIG.STATUSES.NEEDS_DECISION) {
                hasIssues = true;
                attentionHtml += generateAttentionItemHtml(task, name, index);
            }
        });
    }

    const columnHtml = generateMemberColumnHtml(name, data, cardsHtml);
    return { columnHtml, attentionHtml, hasIssues };
}

/**
 * @description Renders the team columns on the dashboard using batch DOM updates
 * @returns {boolean} True if there are issues requiring attention, false otherwise
 */
function renderTeamColumns() {
    const container = document.querySelector('.dashboard-columns');
    const attentionList = document.getElementById('attention-list');
    
    let columnsHtml = '';
    let attentionHtml = '';
    let hasIssues = false;

    Object.entries(STATE.teamData).forEach(([name, data]) => {
        const result = processMemberData(name, data);
        columnsHtml += result.columnHtml;
        attentionHtml += result.attentionHtml;
        if (result.hasIssues) hasIssues = true;
    });

    // Batch DOM update
    container.innerHTML = columnsHtml;
    renderAttentionList(hasIssues, attentionHtml, attentionList);
    return hasIssues;
}

/**
 * @description Renders the needs attention panel
 * @param {boolean} hasIssues - Whether there are any issues
 * @param {string} attentionHtml - The HTML string of attention items
 * @param {HTMLElement} attentionList - The DOM element for the list
 * @returns {void}
 */
function renderAttentionList(hasIssues, attentionHtml, attentionList) {
    if (hasIssues) {
        attentionList.innerHTML = attentionHtml;
    } else {
        attentionList.innerHTML = `<div class="all-clear">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            All clear — no blockers today
        </div>`;
    }
}

/**
 * @description Renders the entire dashboard UI
 * @returns {void}
 */
function renderDashboard() {
    renderTeamColumns();
}

/**
 * @description Switches the active tab and view
 * @param {string} targetId - The ID of the view to switch to
 * @returns {void}
 */
function switchTab(targetId) {
    const tabs = document.querySelectorAll('.tab');
    const views = document.querySelectorAll('.view');
    
    tabs.forEach(t => {
        t.classList.remove('active');
        if (t.dataset.target === targetId) t.classList.add('active');
    });
    
    views.forEach(v => {
        v.classList.remove('active');
        if (v.id === targetId) v.classList.add('active');
    });
}

/**
 * @description Clears the update form inputs
 * @returns {void}
 */
function clearForm() {
    document.getElementById('working-on').value = '';
    document.getElementById('blockers').value = '';
    document.getElementById('completed').value = '';
}

/**
 * @description Sets the loading state of the submit button immediately
 * @param {boolean} isLoading - Whether it is loading
 * @returns {void}
 */
function setSubmitLoadingState(isLoading) {
    const submitBtn = document.getElementById('submit-btn');
    const submitText = document.getElementById('submit-text');
    const submitLoader = document.getElementById('submit-loader');

    submitBtn.disabled = isLoading;
    if (isLoading) {
        submitText.textContent = 'Processing...';
        submitLoader.classList.remove('hidden');
    } else {
        submitText.textContent = 'Update the team';
        submitLoader.classList.add('hidden');
    }
}

/**
 * @description Updates the submit button to a success state briefly
 * @returns {void}
 */
function showSubmitSuccess() {
    const submitBtn = document.getElementById('submit-btn');
    const submitText = document.getElementById('submit-text');
    const submitLoader = document.getElementById('submit-loader');

    submitLoader.classList.add('hidden');
    submitBtn.classList.add('update-success');
    submitText.textContent = 'Updated ✓';
    
    setTimeout(() => {
        submitBtn.classList.remove('update-success');
        submitText.textContent = 'Update the team';
        submitBtn.disabled = false;
        switchTab('dashboard-view');
    }, CONFIG.SUCCESS_TIMEOUT);
}

/**
 * ==========================================
 * HANDLERS
 * ==========================================
 */

/**
 * @description Debounces a function execution
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/**
 * @description Handles modal API key submission
 * @returns {void}
 */
function handleModalSubmit() {
    const apiKeyInput = document.getElementById('modal-api-key').value.trim();
    const errorText = document.getElementById('api-error');
    
    if (apiKeyInput.startsWith('AIza') && apiKeyInput.length === 39) {
        sessionStorage.setItem('gemini_api_key', apiKeyInput);
        document.getElementById('api-modal').classList.add('hidden');
        errorText.classList.add('hidden');
    } else {
        errorText.classList.remove('hidden');
    }
}

/**
 * @description Builds the prompt for extracting tasks
 * @param {string} name - Team member name
 * @param {string} role - Team member role
 * @param {string} workingOn - Working on text
 * @param {string} blockers - Blockers text
 * @param {string} completed - Completed text
 * @returns {string} The formatted prompt
 */
function buildExtractionPrompt(name, role, workingOn, blockers, completed) {
    return `A team member named ${name} with role ${role} submitted this update:
Working on: ${workingOn || 'nothing'}
Blocked by: ${blockers || 'nothing'}
Completed: ${completed || 'nothing'}
Extract all tasks and return ONLY a JSON array in this exact format, nothing else:
[
{
"task": "task description in plain English",
"status": "In Progress" or "Blocked" or "Completed" or "Needs Decision",
"blocker": "blocker description or null"
}
]

Rules for extraction:
— Each distinct task gets its own object
— If something is blocked, status is Blocked and blocker field is filled
— If something needs a human decision to proceed, status is Needs Decision
— Keep task descriptions concise, under 10 words
— Return valid JSON only, no explanation, no markdown`;
}

/**
 * @description Builds the prompt for the team pulse
 * @returns {string|null} The formatted prompt or null if no tasks
 */
function buildPulsePrompt() {
    let teamSummary = [];
    Object.entries(STATE.teamData).forEach(([name, data]) => {
        if (data.tasks.length === 0 || data.parseError) return;
        let summaryParts = [];
        data.tasks.forEach(t => {
            if (t.status === CONFIG.STATUSES.BLOCKED) summaryParts.push(`Blocked on ${t.blocker || t.task}`);
            else summaryParts.push(`${t.task} (${t.status})`);
        });
        teamSummary.push(`${name} (${data.role}) is working on: ${summaryParts.join(', ')}.`);
    });

    if (teamSummary.length === 0) return null;

    return `Here is the current status of a team: ${teamSummary.join(' ')}. In one sentence of maximum ${CONFIG.PULSE_MAX_WORDS} words, identify the single most important thing this team needs to address or decide today. Be specific, not generic. Do not start with The team. Start with an action word.`;
}

/**
 * @description Handles the generation of the team pulse, using cached version when applicable
 * @returns {Promise<void>}
 */
async function handleGenerateTeamPulse() {
    const pulseEl = document.getElementById('pulse-text');
    
    // Return cached text if no updates require regeneration
    if (!STATE.pulseNeedsUpdate) {
        pulseEl.textContent = STATE.pulseText;
        return;
    }

    const apiKey = sessionStorage.getItem('gemini_api_key');
    if (!apiKey) return;

    const prompt = buildPulsePrompt();
    if (!prompt) {
        STATE.pulseText = "Waiting for team updates...";
        pulseEl.textContent = STATE.pulseText;
        STATE.pulseNeedsUpdate = false;
        return;
    }
    
    try {
        const summary = await callGeminiWithRetry(prompt);
        STATE.pulseText = summary.trim();
        pulseEl.textContent = STATE.pulseText;
        STATE.pulseNeedsUpdate = false;
    } catch (e) {
        pulseEl.textContent = "Unable to generate team pulse at this time.";
    }
}

/**
 * @description Builds the prompt for the weekly summary
 * @returns {string|null} The formatted prompt or null if no tasks
 */
function buildWeeklySummaryPrompt() {
    let allTasks = [];
    Object.entries(STATE.teamData).forEach(([name, data]) => {
        if (data.parseError) return;
        data.tasks.forEach(t => {
            allTasks.push(`- ${name} (${data.role}): ${t.task} [Status: ${t.status}] ${t.blocker ? '(Blocked by: ' + t.blocker + ')' : ''}`);
        });
    });

    if (allTasks.length === 0) return null;

    return `Based on this team's current task status:\n${allTasks.join('\n')}\n\nGenerate a concise weekly summary suitable for a stakeholder update. Format as three sections: Accomplishments this week, Currently in progress, Blockers requiring attention. Keep each section to 2-3 bullet points maximum. Plain English only.`;
}

/**
 * @description Handles the generation of the weekly stakeholder summary
 * @returns {Promise<void>}
 */
async function handleGenerateWeeklySummary() {
    const modal = document.getElementById('summary-modal');
    const textEl = document.getElementById('summary-text');
    const copyBtn = document.getElementById('copy-summary-btn');
    
    if (!sessionStorage.getItem('gemini_api_key')) {
        alert("Please enter your Gemini API Key in the settings first.");
        return;
    }

    const prompt = buildWeeklySummaryPrompt();
    if (!prompt) {
        alert("No tasks available to generate a summary.");
        return;
    }

    modal.classList.remove('hidden');
    textEl.textContent = "Generating summary...";
    copyBtn.textContent = "Copy to Clipboard";
    copyBtn.disabled = true;

    try {
        const summary = await callGeminiWithRetry(prompt);
        textEl.textContent = summary.trim();
        copyBtn.disabled = false;
    } catch (e) {
        textEl.textContent = "Unable to generate weekly summary at this time. Please try again.";
    }
}

/**
 * @description Copies the summary text to clipboard
 * @returns {void}
 */
function handleCopySummary() {
    const textEl = document.getElementById('summary-text');
    const copyBtn = document.getElementById('copy-summary-btn');
    
    navigator.clipboard.writeText(textEl.textContent).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "Copy to Clipboard", 2000);
    });
}

/**
 * @description Closes the summary modal
 * @returns {void}
 */
function closeSummaryModal() {
    document.getElementById('summary-modal').classList.add('hidden');
}

/**
 * @description Safely parses JSON strings, resilient to markdown blocks
 * @param {string} text - Raw text to parse
 * @returns {Object} Result object with success boolean and data payload
 */
function safeParseJSON(text) {
    try {
        const cleaned = text.replace(/```json|```/g, '').trim();
        return { success: true, data: JSON.parse(cleaned) };
    } catch {
        return { success: false, data: null };
    }
}

/**
 * @description Gets inputs from the update form
 * @returns {Object} Form inputs
 */
function getUpdateInputs() {
    return {
        name: document.getElementById('member-select').value,
        workingOn: document.getElementById('working-on').value,
        blockers: document.getElementById('blockers').value,
        completed: document.getElementById('completed').value
    };
}

/**
 * @description Validates the update form inputs
 * @param {Object} inputs - Form inputs
 * @returns {boolean} True if valid, false otherwise
 */
function validateUpdate(inputs) {
    if (!inputs.workingOn && !inputs.blockers && !inputs.completed) {
        alert("Please enter at least some update.");
        return false;
    }
    if (!sessionStorage.getItem('gemini_api_key')) {
        alert("Please enter your Gemini API Key in the settings.");
        return false;
    }
    return true;
}

/**
 * @description Finishes the update flow, clearing form and rendering
 * @returns {void}
 */
function finishUpdateFlow() {
    clearForm();
    renderDashboard();
    handleGenerateTeamPulse();
    showSubmitSuccess();
}

/**
 * @description Handles an error during the update process
 * @param {Error} e - The error object
 * @returns {void}
 */
function handleUpdateError(e) {
    setSubmitLoadingState(false);
    
    if (e.message === 'API_KEY_INVALID') {
        sessionStorage.removeItem('gemini_api_key');
        document.getElementById('api-modal').classList.remove('hidden');
        const errText = document.getElementById('api-error');
        errText.textContent = 'Your API key appears to be invalid. Please re-enter it.';
        errText.classList.remove('hidden');
    } else {
        alert("Unable to process your update right now. Please try again.");
    }
}

/**
 * @description Debounced processor for handling updates via API
 */
const processUpdateDebounced = debounce(async (inputs, prompt) => {
    try {
        const result = await callGeminiWithRetry(prompt);
        const parsed = safeParseJSON(result);
        
        if (!parsed.success) {
            console.log("Raw response (malformed JSON):", result);
            STATE.teamData[inputs.name].parseError = true;
        } else {
            STATE.teamData[inputs.name].tasks = parsed.data;
            STATE.teamData[inputs.name].parseError = false;
        }
        
        STATE.teamData[inputs.name].lastUpdated = new Date();
        STATE.pulseNeedsUpdate = true; // Mark pulse for regeneration
        
        finishUpdateFlow();
    } catch (e) {
        handleUpdateError(e);
    }
}, 300);

/**
 * @description Handles form submission and triggers debounced API processing
 * @returns {void}
 */
function handleSubmitUpdate() {
    const inputs = getUpdateInputs();
    if (!validateUpdate(inputs)) return;

    // Show loading immediately, before the 300ms debounce
    setSubmitLoadingState(true);
    
    const prompt = buildExtractionPrompt(inputs.name, STATE.teamData[inputs.name].role, inputs.workingOn, inputs.blockers, inputs.completed);
    processUpdateDebounced(inputs, prompt);
}

/**
 * @description Populates mock data for the demo scenario
 * @returns {void}
 */
function populateDemoData() {
    STATE.teamData.Priya = {
        role: 'Designer',
        parseError: false,
        tasks: [
            { task: "Finalizing homepage mockups", status: CONFIG.STATUSES.IN_PROGRESS },
            { task: "Waiting for brand color confirmation from Rohan", status: CONFIG.STATUSES.BLOCKED, blocker: "brand color approval pending" }
        ]
    };
    STATE.teamData.Arjun = {
        role: 'Developer',
        parseError: false,
        tasks: [
            { task: "API integration for payments complete", status: CONFIG.STATUSES.COMPLETED },
            { task: "Starting user authentication module today", status: CONFIG.STATUSES.IN_PROGRESS }
        ]
    };
    STATE.teamData.Meera = {
        role: 'Marketer',
        parseError: false,
        tasks: [
            { task: "Launch email drafted and ready for review", status: CONFIG.STATUSES.NEEDS_DECISION },
            { task: "Social media calendar live for next 2 weeks", status: CONFIG.STATUSES.COMPLETED }
        ]
    };
    STATE.teamData.Rohan = {
        role: 'Founder',
        parseError: false,
        tasks: [
            { task: "Investor deck updated", status: CONFIG.STATUSES.COMPLETED },
            { task: "Need to decide on launch date before team can proceed", status: CONFIG.STATUSES.NEEDS_DECISION }
        ]
    };

    const pastTime = new Date(Date.now() - CONFIG.PAST_TIME_MINS * 60000);
    Object.keys(STATE.teamData).forEach(n => STATE.teamData[n].lastUpdated = pastTime);
    STATE.pulseNeedsUpdate = true;
}

/**
 * @description Handles the demo mode button click
 * @returns {void}
 */
function handleDemoClick() {
    populateDemoData();
    renderDashboard();
    
    // Explicitly set pulse for demo scenario
    const pulseEl = document.getElementById('pulse-text');
    STATE.pulseText = "Unblock Priya's design by confirming brand colors — it's holding up the homepage.";
    pulseEl.textContent = STATE.pulseText;
    STATE.pulseNeedsUpdate = false;
    
    switchTab('dashboard-view');
}

/**
 * @description Handles tab clicking
 * @param {Event} e - The click event
 * @returns {void}
 */
function handleTabClick(e) {
    if (e.target.classList.contains('tab')) {
        switchTab(e.target.dataset.target);
    }
}

/**
 * ==========================================
 * INIT
 * ==========================================
 */

/**
 * @description Initializes event listeners
 * @returns {void}
 */
function initEventListeners() {
    document.getElementById('modal-submit-btn').addEventListener('click', handleModalSubmit);
    document.getElementById('submit-btn').addEventListener('click', handleSubmitUpdate);
    document.getElementById('demo-btn').addEventListener('click', handleDemoClick);
    document.getElementById('weekly-summary-btn').addEventListener('click', handleGenerateWeeklySummary);
    document.getElementById('close-summary-btn').addEventListener('click', closeSummaryModal);
    document.getElementById('copy-summary-btn').addEventListener('click', handleCopySummary);
    
    const tabsContainer = document.querySelector('.tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', handleTabClick);
    }
    
    window.addEventListener('offline', () => showBanner('You appear to be offline. Updates will resume when connected.', 'amber'));
    window.addEventListener('online', () => hideBanner());
}

/**
 * @description Initializes the application
 * @returns {void}
 */
function init() {
    // Remove localStorage clear for existing users so it stops persisting
    localStorage.removeItem('gemini_api_key'); 
    
    if (!sessionStorage.getItem('gemini_api_key')) {
        document.getElementById('api-modal').classList.remove('hidden');
    }
    
    initEventListeners();
    renderDashboard();
}

// Start app
init();
