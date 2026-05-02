const teamData = {
    Priya: { role: 'Designer', tasks: [], lastUpdated: null },
    Arjun: { role: 'Developer', tasks: [], lastUpdated: null },
    Meera: { role: 'Marketer', tasks: [], lastUpdated: null },
    Rohan: { role: 'Founder', tasks: [], lastUpdated: null }
};

function getTimeAgo(date) {
    if (!date) return '';
    const minutes = Math.floor((new Date() - date) / 60000);
    if (minutes < 1) return 'Updated just now';
    return `Updated ${minutes} min${minutes !== 1 ? 's' : ''} ago`;
}

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.view');
const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key');
const submitBtn = document.getElementById('submit-btn');
const submitText = document.getElementById('submit-text');
const submitLoader = document.getElementById('submit-loader');

// Load API Key
apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
saveKeyBtn.addEventListener('click', () => {
    localStorage.setItem('gemini_api_key', apiKeyInput.value);
    saveKeyBtn.textContent = 'Saved!';
    setTimeout(() => saveKeyBtn.textContent = 'Save', 2000);
});

// Tab Switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
    });
});

async function callGemini(prompt) {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) throw new Error('API Key is missing');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 }
        })
    });

    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

function renderDashboard() {
    const container = document.querySelector('.dashboard-columns');
    const attentionList = document.getElementById('attention-list');
    container.innerHTML = '';
    
    let attentionHtml = '';
    let hasIssues = false;

    Object.entries(teamData).forEach(([name, data]) => {
        const col = document.createElement('div');
        col.className = 'member-column';
        
        let cardsHtml = '';
        data.tasks.forEach((task, index) => {
            let tagClass = 'status-progress';
            let statusText = task.status || 'In Progress';
            
            if (statusText === 'Completed') tagClass = 'status-completed';
            else if (statusText === 'Blocked') tagClass = 'status-blocked';
            else if (statusText === 'Needs Decision') tagClass = 'status-decision';

            let blockerHtml = '';
            if (statusText === 'Blocked' && task.blocker) {
                blockerHtml = `<div class="blocker-section"><strong>Blocked by:</strong> ${task.blocker}</div>`;
            }

            let extraCardClass = statusText === 'Blocked' ? 'blocked-card' : '';
            cardsHtml += `
                <div class="task-card fade-in ${extraCardClass}" style="animation-delay: ${index * 0.1}s">
                    <span class="status-tag ${tagClass}">${statusText}</span>
                    <p>${task.task}</p>
                    ${blockerHtml}
                </div>
            `;
            
            // Populate Needs Attention
            if (statusText === 'Blocked' || statusText === 'Needs Decision') {
                hasIssues = true;
                const unblockText = statusText === 'Blocked' ? (task.blocker || 'Needs unblocking') : 'Needs decision to proceed';
                const borderColor = statusText === 'Blocked' ? 'var(--status-blocked)' : 'var(--status-decision)';
                attentionHtml += `
                    <div class="attention-item fade-in" style="border-left: 3px solid ${borderColor}; animation-delay: ${index * 0.1}s">
                        <span class="attention-member">${name}</span>
                        <div class="attention-task">${task.task}</div>
                        <div class="attention-unblock"><strong>Needed:</strong> ${unblockText}</div>
                    </div>
                `;
            }
        });

        if (data.tasks.length === 0) {
            cardsHtml = '<p class="empty-state-text">No update yet today</p>';
        }

        const timeStr = data.lastUpdated ? `<span class="column-time">${getTimeAgo(data.lastUpdated)}</span>` : '';

        col.innerHTML = `
            <div class="column-header">
                <h3>${name}</h3>
                <span>${data.role}</span>
                ${timeStr}
            </div>
            ${cardsHtml}
        `;
        container.appendChild(col);
    });

    if (hasIssues) {
        attentionList.innerHTML = attentionHtml;
    } else {
        attentionList.innerHTML = `<div class="all-clear">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            All clear — no blockers today
        </div>`;
    }
}

async function generateTeamPulse() {
    const pulseEl = document.getElementById('pulse-text');
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return;

    let teamSummary = [];
    Object.entries(teamData).forEach(([name, data]) => {
        if (data.tasks.length === 0) return;
        let summaryParts = [];
        data.tasks.forEach(t => {
            if (t.status === 'Blocked') summaryParts.push(`Blocked on ${t.blocker || t.task}`);
            else summaryParts.push(`${t.task} (${t.status})`);
        });
        teamSummary.push(`${name} (${data.role}) is working on: ${summaryParts.join(', ')}.`);
    });

    if (teamSummary.length === 0) {
        pulseEl.textContent = "Waiting for team updates...";
        return;
    }

    const prompt = `Here is the current status of a team: ${teamSummary.join(' ')}. In one sentence of maximum 20 words, identify the single most important thing this team needs to address or decide today. Be specific, not generic. Do not start with The team. Start with an action word.`;
    
    try {
        const summary = await callGemini(prompt);
        pulseEl.textContent = summary.trim();
    } catch (e) {
        pulseEl.textContent = "Unable to generate team pulse.";
    }
}

submitBtn.addEventListener('click', async () => {
    const name = document.getElementById('member-select').value;
    const role = teamData[name].role;
    const workingOn = document.getElementById('working-on').value;
    const blockers = document.getElementById('blockers').value;
    const completed = document.getElementById('completed').value;

    if (!workingOn && !blockers && !completed) {
        alert("Please enter at least some update.");
        return;
    }

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        alert("Please enter and save your Gemini API Key at the top right first.");
        return;
    }

    submitBtn.disabled = true;
    submitText.textContent = 'Processing...';
    submitLoader.classList.remove('hidden');

    const prompt = `A team member named ${name} with role ${role} submitted this update:
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

    try {
        let result = await callGemini(prompt);
        // Clean markdown if Gemini still adds it despite prompt instructions
        result = result.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedTasks = JSON.parse(result);
        
        teamData[name].tasks = parsedTasks;
        teamData[name].lastUpdated = new Date();
        
        // Clear form
        document.getElementById('working-on').value = '';
        document.getElementById('blockers').value = '';
        document.getElementById('completed').value = '';
        
        renderDashboard();
        generateTeamPulse();
        
        // Success state
        submitLoader.classList.add('hidden');
        submitBtn.classList.add('update-success');
        submitText.textContent = 'Updated ✓';
        setTimeout(() => {
            submitBtn.classList.remove('update-success');
            submitText.textContent = 'Update the team';
            submitBtn.disabled = false;
            // Switch tab
            tabs[1].click();
        }, 3000);

    } catch (e) {
        alert("Error processing update. Please check API key and try again.");
        console.error(e);
        submitBtn.disabled = false;
        submitText.textContent = 'Update the team';
        submitLoader.classList.add('hidden');
    }
});

const demoBtn = document.getElementById('demo-btn');
demoBtn.addEventListener('click', () => {
    teamData.Priya.tasks = [
        { task: "Finalizing homepage mockups", status: "In Progress" },
        { task: "Waiting for brand color confirmation from Rohan", status: "Blocked", blocker: "brand color approval pending" }
    ];
    teamData.Arjun.tasks = [
        { task: "API integration for payments complete", status: "Completed" },
        { task: "Starting user authentication module today", status: "In Progress" }
    ];
    teamData.Meera.tasks = [
        { task: "Launch email drafted and ready for review", status: "Needs Decision" },
        { task: "Social media calendar live for next 2 weeks", status: "Completed" }
    ];
    teamData.Rohan.tasks = [
        { task: "Investor deck updated", status: "Completed" },
        { task: "Need to decide on launch date before team can proceed", status: "Needs Decision" }
    ];

    const pastTime = new Date(Date.now() - 12 * 60000); // 12 mins ago
    Object.keys(teamData).forEach(n => teamData[n].lastUpdated = pastTime);

    renderDashboard();
    
    document.getElementById('pulse-text').textContent = "Unblock Priya's design by confirming brand colors — it's holding up the homepage.";
    
    tabs[1].click();
});

// Initial render
renderDashboard();
