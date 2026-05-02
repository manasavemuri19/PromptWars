/**
 * CONFIG
 * Application constants, API configuration, and Enums
 */
const CONFIG = {
    GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    MODEL_NAME: 'gemini-1.5-flash',
    MAX_RETRIES: 3,
    PULSE_MAX_WORDS: 20,
    ANIMATION_DELAY: 0.1,
    STATUSES: {
        IN_PROGRESS: 'In Progress',
        BLOCKED: 'Blocked',
        NEEDS_DECISION: 'Needs Decision',
        COMPLETED: 'Completed'
    }
};

/**
 * STATE
 * Centralized application state
 */
const STATE = {
    teamData: {},
    pulseText: "Waiting for team updates...",
    pulseNeedsUpdate: true
};

/**
 * API
 * Functions related to external data fetching and retries
 */

// SECURITY NOTE: API key is stored in sessionStorage (tab-scoped, never persisted)
// and transmitted only directly to Google's API endpoint.

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
 * @description Calls Gemini API with exponential backoff retry logic
 * @param {string} prompt - The prompt to send to Gemini
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<string>} The extracted text response
 */
async function callGeminiWithRetry(prompt, maxRetries = CONFIG.MAX_RETRIES) {
    const apiKey = sessionStorage.getItem('gemini_api_key');
    if (!apiKey) throw new Error('No API Key found');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(`${CONFIG.GEMINI_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.2 }
                })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            
            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
        } catch (error) {
            if (attempt === maxRetries) throw error;
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

/**
 * @description Builds the prompt to extract tasks from user input
 * @param {string} name - Team member name
 * @param {string} role - Team member role
 * @param {string} workingOn - Current tasks text
 * @param {string} blockers - Blockers text
 * @param {string} completed - Completed tasks text
 * @returns {string} The formatted prompt
 */
function buildExtractionPrompt(name, role, workingOn, blockers, completed) {
    return `
    Extract the tasks and status from this team update into a JSON array of objects.
    Name: ${name}, Role: ${role}
    Working On: ${workingOn}
    Blockers: ${blockers}
    Completed: ${completed}

    Rules:
    1. Each object must have keys: "task" (string), "status" (string), "blocker" (string).
    2. Status must be exactly one of: "${CONFIG.STATUSES.IN_PROGRESS}", "${CONFIG.STATUSES.BLOCKED}", "${CONFIG.STATUSES.NEEDS_DECISION}", "${CONFIG.STATUSES.COMPLETED}".
    3. If blocked, specify what/who is blocking in the "blocker" field. If not, empty string.
    4. Keep tasks very concise.
    5. Return ONLY valid JSON array.
    `;
}

/**
 * @description Builds the prompt for the Team Pulse summary
 * @returns {string|null} The formatted prompt or null if no active tasks
 */
function buildPulsePrompt() {
    let allTasks = [];
    Object.entries(STATE.teamData).forEach(([name, data]) => {
        if (data.parseError) return;
        data.tasks.forEach(t => allTasks.push(`${name} is working on: ${t.task}. Status: ${t.status}.`));
    });

    if (allTasks.length === 0) return null;

    return `Based on these tasks: ${allTasks.join(' ')}. Write a 1-sentence team pulse summary (max ${CONFIG.PULSE_MAX_WORDS} words) showing overall progress. Keep it energetic. Plain text only.`;
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
 * @description Builds the prompt for the smart daily digest
 * @returns {string|null} The formatted prompt or null if no tasks
 */
function buildDailyDigestPrompt() {
    let allTasks = [];
    Object.entries(STATE.teamData).forEach(([name, data]) => {
        if (data.parseError) return;
        data.tasks.forEach(t => {
            allTasks.push(`- ${name} (${data.role}): ${t.task} [Status: ${t.status}] ${t.blocker ? '(Blocked by: ' + t.blocker + ')' : ''}`);
        });
    });

    if (allTasks.length === 0) return null;

    return `You are writing a morning team briefing message for a startup team. Based on this status:\n${allTasks.join('\n')}\n\nWrite a friendly, concise WhatsApp/Slack message (max 120 words) that:\n- Starts with a greeting and todays date\n- Mentions each person by first name only\n- Highlights the one most important blocker needing resolution\n- Lists one key win from yesterday\n- Ends with one clear call to action for the team\nTone: warm, direct, human. Not corporate. No bullet points — flowing sentences.`;
}


/**
 * UI
 * Functions strictly responsible for generating and rendering HTML
 */

/**
 * @description Formats a date into a human-readable "time ago" string
 * @param {Date} date - The date to format
 * @returns {string} Formatted string
 */
function getTimeAgo(date) {
    if (!date) return '';
    const minutes = Math.floor((new Date() - date) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/**
 * @description Generates the HTML for a single task card
 * @param {Object} task - Task data object
 * @param {string} memberName - Name of the team member
 * @param {number} index - Index for animation delay
 * @param {Object} flashInfo - Information about recently resolved tasks
 * @returns {string} HTML string
 */
function generateTaskCardHtml(task, memberName, index, flashInfo) {
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

    let blockerHtml = '';
    if (statusText === CONFIG.STATUSES.BLOCKED) {
        blockerHtml = `<div class="blocker-section"><strong>Blocked by:</strong> ${task.blocker || 'Needs unblocking'} <br>`;
        blockerHtml += `<button class="resolve-btn" aria-label="Mark this blocker as resolved">Resolve Blocker</button>`;
        blockerHtml += `</div>`;
    }
    
    const extraCardClass = statusText === CONFIG.STATUSES.BLOCKED ? 'blocked-card' : '';
    const delay = index * CONFIG.ANIMATION_DELAY;
    const flashClass = (flashInfo && flashInfo.member === memberName && flashInfo.index === index) ? 'resolve-flash' : '';

    // Ensure reactions object exists
    task.reactions = task.reactions || { aware: 0, help: 0, done: 0, userReactions: [] };
    const r = task.reactions;
    const awareActive = r.userReactions.includes('aware') ? 'reaction-active' : '';
    const helpActive = r.userReactions.includes('help') ? 'reaction-active' : '';
    const doneActive = r.userReactions.includes('done') ? 'reaction-active' : '';

    const reactionsHtml = `
        <div class="reactions-row">
            <button class="reaction-btn ${awareActive}" data-reaction="aware" aria-label="I am aware of this task">👀 <span>${r.aware}</span></button>
            <button class="reaction-btn ${helpActive}" data-reaction="help" aria-label="I can help with this task">✋ <span>${r.help}</span></button>
            <button class="reaction-btn ${doneActive}" data-reaction="done" aria-label="This task is complete">✅ <span>${r.done}</span></button>
        </div>
    `;

    return `
        <div class="task-card fade-in ${extraCardClass} ${flashClass}" style="animation-delay: ${delay}s" data-member="${memberName}" data-task-index="${index}">
            <span class="status-tag ${tagClass}" role="status" aria-label="Task status: ${statusText}">${icon}${statusText}</span>
            <p>${task.task}</p>
            ${blockerHtml}
            ${reactionsHtml}
        </div>
    `;
}

/**
 * @description Generates the HTML for a team member's column
 * @param {string} name - Member name
 * @param {Object} data - Member data object
 * @param {string} cardsHtml - Pre-rendered HTML for the member's tasks
 * @returns {string} HTML string
 */
function generateMemberColumnHtml(name, data, cardsHtml) {
    let contentHtml = '';
    let progressHtml = '';
    
    if (data.parseError) {
        contentHtml = '<p class="inline-error">Update received — processing took longer than expected. Try submitting again.</p>';
    } else if (data.tasks.length === 0) {
        contentHtml = `
            <div class="empty-state-text">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                No update yet today
            </div>
        `;
    } else {
        const completedCount = data.tasks.filter(t => t.status === CONFIG.STATUSES.COMPLETED).length;
        const totalCount = data.tasks.length;
        const percentage = Math.round((completedCount / totalCount) * 100);
        
        progressHtml = `
            <div class="progress-section">
                <div class="progress-bar-track" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="${completedCount} of ${totalCount} tasks completed">
                    <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <span class="progress-label">${completedCount}/${totalCount} done</span>
            </div>
        `;
        contentHtml = cardsHtml;
    }

    const timeStr = data.lastUpdated ? `<span class="column-time">${getTimeAgo(data.lastUpdated)}</span>` : '';
    const initial = name.charAt(0);
    const extraEmptyClass = data.tasks.length === 0 ? 'empty-column' : '';

    return `
        <div class="member-column fade-in ${extraEmptyClass}">
            <div class="column-header">
                <div class="member-avatar">${initial}</div>
                <div class="column-header-info">
                    <h3 style="font-size: 16px; font-weight: 600;">${name}</h3>
                    <span style="font-size: 13px; color: var(--text-secondary);">${data.role}</span>
                </div>
            </div>
            ${progressHtml}
            ${contentHtml}
        </div>
    `;
}

/**
 * @description Generates the HTML for an attention sidebar item
 * @param {Object} task - Task data object
 * @param {string} memberName - Team member name
 * @param {number} index - Index for animation delay
 * @returns {string} HTML string
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
 * @description Renders the needs attention sidebar list
 * @param {boolean} hasIssues - True if there are issues to display
 * @param {string} attentionHtml - Pre-rendered HTML for issues
 * @param {HTMLElement} attentionList - The DOM container element
 * @returns {void}
 */
function renderAttentionList(hasIssues, attentionHtml, attentionList) {
    if (hasIssues) {
        attentionList.innerHTML = attentionHtml;
    } else {
        attentionList.innerHTML = `
            <div class="all-clear fade-in">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Team is unblocked
            </div>
        `;
    }
}

/**
 * @description Processes a single member's data and returns HTML fragments
 * @param {string} name - Member name
 * @param {Object} data - Member data object
 * @returns {Object} Object containing columnHtml, attentionHtml, and hasIssues boolean
 */
function processMemberData(name, data, flashInfo) {
    let cardsHtml = '';
    let attentionHtml = '';
    let hasIssues = false;

    if (!data.parseError && data.tasks) {
        data.tasks.forEach((task, index) => {
            cardsHtml += generateTaskCardHtml(task, name, index, flashInfo);
            
            if (task.status === CONFIG.STATUSES.BLOCKED || task.status === CONFIG.STATUSES.NEEDS_DECISION) {
                attentionHtml += generateAttentionItemHtml(task, name, index);
                hasIssues = true;
            }
        });
    }

    return {
        columnHtml: generateMemberColumnHtml(name, data, cardsHtml),
        attentionHtml,
        hasIssues
    };
}

/**
 * @description Orchestrates the rendering of the entire team dashboard
 * @param {Object} flashInfo - Information about recently resolved tasks
 * @returns {boolean} True if there are issues requiring attention
 */
function renderTeamColumns(flashInfo = null) {
    const container = document.querySelector('.dashboard-columns');
    const attentionList = document.getElementById('attention-list');
    
    let columnsHtml = '';
    let attentionHtml = '';
    let hasIssues = false;

    Object.entries(STATE.teamData).forEach(([name, data]) => {
        const result = processMemberData(name, data, flashInfo);
        columnsHtml += result.columnHtml;
        attentionHtml += result.attentionHtml;
        if (result.hasIssues) hasIssues = true;
    });

    container.innerHTML = columnsHtml;
    renderAttentionList(hasIssues, attentionHtml, attentionList);
    return hasIssues;
}

/**
 * @description Sets the visual loading state of the submit button
 * @param {boolean} isLoading - True to show loader, false to hide
 * @returns {void}
 */
function setSubmitLoadingState(isLoading) {
    const btn = document.getElementById('submit-btn');
    const text = document.getElementById('submit-text');
    const loader = document.getElementById('submit-loader');

    if (isLoading) {
        btn.disabled = true;
        text.textContent = 'Extracting tasks...';
        loader.classList.remove('hidden');
    } else {
        btn.disabled = false;
        text.textContent = 'Update the team';
        loader.classList.add('hidden');
    }
}

/**
 * @description Toggles the system offline banner
 * @param {boolean} isOffline - True if system is offline
 * @returns {void}
 */
function renderOfflineBanner(isOffline) {
    const banner = document.getElementById('system-banner');
    if (isOffline) {
        banner.textContent = "You are offline. Updates will not be processed.";
        banner.className = "banner amber";
    } else {
        banner.className = "banner hidden";
    }
}

/**
 * HANDLERS
 * Event listeners, user interactions, and coordination
 */

/**
 * @description Debounce utility to rate limit function execution
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Milliseconds to delay
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
 * @description Handles the API key modal submission
 * @returns {void}
 */
function handleModalSubmit() {
    const key = document.getElementById('modal-api-key').value.trim();
    const errorEl = document.getElementById('api-error');
    
    if (key.startsWith('AIza') && key.length === 39) {
        sessionStorage.setItem('gemini_api_key', key);
        document.getElementById('api-modal').classList.add('hidden');
        errorEl.classList.add('hidden');
        document.body.style.overflow = 'auto';
    } else {
        errorEl.classList.remove('hidden');
    }
}

/**
 * @description Extracts and formats input values from the update form
 * @returns {Object} Object containing name, workingOn, blockers, completed
 */
function getUpdateInputs() {
    const memberSelect = document.getElementById('member-select');
    return {
        name: memberSelect.options[memberSelect.selectedIndex].value,
        workingOn: document.getElementById('working-on').value,
        blockers: document.getElementById('blockers').value,
        completed: document.getElementById('completed').value
    };
}

/**
 * @description Validates form inputs before submission
 * @param {Object} inputs - Inputs to validate
 * @returns {boolean} True if valid
 */
function validateUpdate(inputs) {
    if (!sessionStorage.getItem('gemini_api_key')) {
        document.getElementById('api-modal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        return false;
    }
    if (!inputs.workingOn && !inputs.completed) {
        alert('Please fill out either what you are working on or what you completed.');
        return false;
    }
    return true;
}

/**
 * @description Handles successful update post-processing (UI cleanup)
 * @returns {void}
 */
function finishUpdateFlow() {
    const btn = document.getElementById('submit-btn');
    
    setSubmitLoadingState(false);
    btn.classList.add('update-success');
    document.getElementById('submit-text').textContent = 'Updated!';
    
    document.getElementById('working-on').value = '';
    document.getElementById('blockers').value = '';
    document.getElementById('completed').value = '';

    setTimeout(() => {
        btn.classList.remove('update-success');
        document.getElementById('submit-text').textContent = 'Update the team';
        document.querySelector('[data-target="dashboard-view"]').click();
    }, 1500);

    renderTeamColumns();
    handleGenerateTeamPulse();
}

/**
 * @description Handles errors during update submission
 * @param {Error} e - The error thrown
 * @returns {void}
 */
function handleUpdateError(e) {
    console.error('Extraction failed:', e);
    setSubmitLoadingState(false);
    alert('Failed to process update. Please verify your API key and try again.');
}

/**
 * @description The debounced API call function for update submission
 */
const processUpdateDebounced = debounce(async (inputs, prompt) => {
    try {
        const result = await callGeminiWithRetry(prompt);
        const parsed = safeParseJSON(result);
        
        if (!STATE.teamData[inputs.name]) {
            STATE.teamData[inputs.name] = { tasks: [], parseError: false, role: "" };
        }

        if (!parsed.success) {
            STATE.teamData[inputs.name].parseError = true;
        } else {
            STATE.teamData[inputs.name].tasks = parsed.data;
            STATE.teamData[inputs.name].parseError = false;
        }
        
        STATE.teamData[inputs.name].lastUpdated = new Date();
        STATE.pulseNeedsUpdate = true;
        
        finishUpdateFlow();
    } catch (e) {
        handleUpdateError(e);
    }
}, 300);

/**
 * @description Main entry point for submitting a team update
 * @returns {void}
 */
function handleSubmitUpdate() {
    const inputs = getUpdateInputs();
    if (!validateUpdate(inputs)) return;

    setSubmitLoadingState(true);
    
    const role = STATE.teamData[inputs.name] ? STATE.teamData[inputs.name].role : "";
    const prompt = buildExtractionPrompt(inputs.name, role, inputs.workingOn, inputs.blockers, inputs.completed);
    processUpdateDebounced(inputs, prompt);
}

/**
 * @description Generates the team pulse summary via Gemini API
 * @returns {Promise<void>}
 */
async function handleGenerateTeamPulse() {
    const pulseEl = document.getElementById('pulse-text');
    
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
 * @description Handles the generation of the smart daily digest
 * @returns {Promise<void>}
 */
async function handleGenerateDailyDigest() {
    const modal = document.getElementById('digest-modal');
    const textEl = document.getElementById('digest-text');
    const copyBtn = document.getElementById('copy-digest-btn');
    
    if (!sessionStorage.getItem('gemini_api_key')) {
        alert("Please enter your Gemini API Key in the settings first.");
        return;
    }

    const prompt = buildDailyDigestPrompt();
    if (!prompt) {
        alert("No tasks available to generate a digest.");
        return;
    }

    modal.classList.remove('hidden');
    textEl.textContent = "Crafting your digest...";
    copyBtn.textContent = "Copy Message";
    copyBtn.disabled = true;

    try {
        const summary = await callGeminiWithRetry(prompt);
        textEl.textContent = summary.trim();
        copyBtn.disabled = false;
    } catch (e) {
        textEl.textContent = "Unable to generate daily digest at this time. Please try again.";
    }
}

/**
 * @description Copies the summary/digest text to clipboard
 * @param {string} textId - ID of text element
 * @param {string} btnId - ID of button
 * @returns {void}
 */
function handleCopyToClipboard(textId, btnId) {
    const textEl = document.getElementById(textId);
    const copyBtn = document.getElementById(btnId);
    
    navigator.clipboard.writeText(textEl.textContent).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "Copy Message", 2000);
    });
}

/**
 * @description Event delegation for all dashboard clicks (resolves, reactions)
 * @param {Event} e - The click event
 * @returns {void}
 */
function handleDashboardClicks(e) {
    const resolveBtn = e.target.closest('.resolve-btn');
    if (resolveBtn) {
        const blockerSection = resolveBtn.closest('.blocker-section');
        resolveBtn.remove();
        blockerSection.insertAdjacentHTML('beforeend', `
            <div class="resolve-input-container">
                <input type="text" class="resolve-input" placeholder="How was this resolved?">
                <button class="resolve-confirm">Confirm</button>
            </div>
        `);
        blockerSection.querySelector('.resolve-input').focus();
        return;
    }

    const confirmBtn = e.target.closest('.resolve-confirm');
    if (confirmBtn) {
        const card = confirmBtn.closest('.task-card');
        const memberName = card.getAttribute('data-member');
        const taskIndex = parseInt(card.getAttribute('data-task-index'), 10);
        
        const task = STATE.teamData[memberName].tasks[taskIndex];
        task.status = CONFIG.STATUSES.IN_PROGRESS;
        task.blocker = '';
        
        STATE.pulseNeedsUpdate = true;
        
        const flashInfo = { member: memberName, index: taskIndex };
        renderTeamColumns(flashInfo);
        handleGenerateTeamPulse();
        return;
    }

    const reactionBtn = e.target.closest('.reaction-btn');
    if (reactionBtn) {
        const card = reactionBtn.closest('.task-card');
        const memberName = card.getAttribute('data-member');
        const taskIndex = parseInt(card.getAttribute('data-task-index'), 10);
        const type = reactionBtn.getAttribute('data-reaction');
        
        const task = STATE.teamData[memberName].tasks[taskIndex];
        task.reactions = task.reactions || { aware: 0, help: 0, done: 0, userReactions: [] };
        
        const span = reactionBtn.querySelector('span');
        
        if (task.reactions.userReactions.includes(type)) {
            task.reactions[type]--;
            task.reactions.userReactions = task.reactions.userReactions.filter(r => r !== type);
            reactionBtn.classList.remove('reaction-active');
        } else {
            task.reactions[type]++;
            task.reactions.userReactions.push(type);
            reactionBtn.classList.add('reaction-active');
            
            span.classList.remove('reaction-anim');
            void span.offsetWidth; // trigger reflow
            span.classList.add('reaction-anim');
        }
        
        span.textContent = task.reactions[type];
        return;
    }
}

/**
 * @description Setup all DOM event listeners
 * @returns {void}
 */
function initEventListeners() {
    document.getElementById('modal-submit-btn').addEventListener('click', handleModalSubmit);
    document.getElementById('submit-btn').addEventListener('click', handleSubmitUpdate);
    document.getElementById('demo-btn').addEventListener('click', handleDemoClick);
    
    document.getElementById('weekly-summary-btn').addEventListener('click', handleGenerateWeeklySummary);
    document.getElementById('close-summary-btn').addEventListener('click', () => document.getElementById('summary-modal').classList.add('hidden'));
    document.getElementById('copy-summary-btn').addEventListener('click', () => handleCopyToClipboard('summary-text', 'copy-summary-btn'));

    document.getElementById('digest-btn').addEventListener('click', handleGenerateDailyDigest);
    document.getElementById('close-digest-btn').addEventListener('click', () => document.getElementById('digest-modal').classList.add('hidden'));
    document.getElementById('copy-digest-btn').addEventListener('click', () => handleCopyToClipboard('digest-text', 'copy-digest-btn'));

    document.querySelector('.dashboard-columns').addEventListener('click', handleDashboardClicks);

    const tabsContainer = document.querySelector('.tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab')) {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                
                e.target.classList.add('active');
                const targetId = e.target.getAttribute('data-target');
                document.getElementById(targetId).classList.add('active');

                if (targetId === 'dashboard-view') {
                    renderTeamColumns();
                    handleGenerateTeamPulse();
                }
            }
        });
    }

    window.addEventListener('online', () => renderOfflineBanner(false));
    window.addEventListener('offline', () => renderOfflineBanner(true));
}


/**
 * INIT
 * Initialization logic and demo mode setup
 */

/**
 * @description Checks security state on app load
 * @returns {void}
 */
function checkSecurityState() {
    if (!sessionStorage.getItem('gemini_api_key')) {
        document.getElementById('api-modal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * @description Populates the application with realistic demo data
 * @returns {void}
 */
function populateDemoData() {
    STATE.teamData = {
        "Priya": {
            role: "Designer",
            lastUpdated: new Date(Date.now() - 1000 * 60 * 30),
            parseError: false,
            tasks: [
                { task: "Finalized new homepage mockups", status: "Completed", blocker: "", reactions: { aware: 2, help: 0, done: 0, userReactions: [] } },
                { task: "Waiting on copy for about page", status: "Blocked", blocker: "Meera needs to provide final text", reactions: { aware: 0, help: 0, done: 0, userReactions: [] } }
            ]
        },
        "Arjun": {
            role: "Developer",
            lastUpdated: new Date(Date.now() - 1000 * 60 * 120),
            parseError: false,
            tasks: [
                { task: "Building API endpoints for user auth", status: "In Progress", blocker: "", reactions: { aware: 0, help: 0, done: 0, userReactions: [] } },
                { task: "Database schema migration", status: "Completed", blocker: "", reactions: { aware: 0, help: 0, done: 0, userReactions: [] } }
            ]
        },
        "Meera": {
            role: "Marketer",
            lastUpdated: new Date(Date.now() - 1000 * 60 * 15),
            parseError: false,
            tasks: [
                { task: "Drafting product launch email", status: "In Progress", blocker: "", reactions: { aware: 0, help: 1, done: 0, userReactions: [] } },
                { task: "Approve ad creatives", status: "Needs Decision", blocker: "Need Rohan's sign-off on budget", reactions: { aware: 0, help: 0, done: 0, userReactions: [] } }
            ]
        },
        "Rohan": {
            role: "Founder",
            lastUpdated: null,
            parseError: false,
            tasks: []
        }
    };
    STATE.pulseNeedsUpdate = true;
}

/**
 * @description Handles the demo mode activation
 * @returns {void}
 */
function handleDemoClick() {
    // Inject a dummy key to bypass modal checks for demo
    sessionStorage.setItem('gemini_api_key', 'AIzaDemoModeActive1234567890abcdefghijk');
    populateDemoData();
    document.querySelector('[data-target="dashboard-view"]').click();
}

/**
 * @description Application initialization
 * @returns {void}
 */
function init() {
    initEventListeners();
    checkSecurityState();
    
    // Initialize empty state structure
    STATE.teamData = {
        "Priya": { role: "Designer", tasks: [] },
        "Arjun": { role: "Developer", tasks: [] },
        "Meera": { role: "Marketer", tasks: [] },
        "Rohan": { role: "Founder", tasks: [] }
    };
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);
