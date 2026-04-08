// @ts-check
const vscode = acquireVsCodeApi();

const TEAM_ANIMAL_ICONS = ["🐶","🐱","🐻","🐼","🐨","🐰","🦊","🐸","🦉","🐧","🦋","🐬","🐙","🦭","🐢","🦜","🐳","🦔"];

/**
 * Simple string hash (djb2) to deterministically map a name to a number.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Deterministically assign unique emojis to a list of member names.
 * Uses name hashing with collision resolution. Falls back to the name's
 * first letter if there are more members than emojis.
 * @param {string[]} names
 * @returns {Map<string, string>}
 */
function assignMemberEmojis(names) {
  /** @type {Map<string, string>} */
  const assignments = new Map();
  const used = new Set();
  const pool = TEAM_ANIMAL_ICONS;

  for (const name of names) {
    if (pool.length === 0) break;
    let idx = hashString(name) % pool.length;
    let attempts = 0;
    while (used.has(idx) && attempts < pool.length) {
      idx = (idx + 1) % pool.length;
      attempts++;
    }
    if (!used.has(idx)) {
      used.add(idx);
      assignments.set(name, pool[idx]);
    }
  }

  // Fallback for overflow members: use first character of name
  for (const name of names) {
    if (!assignments.has(name)) {
      assignments.set(name, name.charAt(0).toUpperCase());
    }
  }

  return assignments;
}

/** @type {Map<string, string>} */
let currentEmojiMap = new Map();

const board = document.getElementById('board');
const teamNameEl = document.getElementById('team-name');
const membersStrip = document.getElementById('members-strip');
const switchTeamBtn = document.getElementById('switch-team-btn');
const toolbar = document.getElementById('toolbar');
const boardOriginalHtml = board.innerHTML;

// Restore previous state
const previousState = vscode.getState();
if (previousState?.tasks) {
  renderBoard(previousState.tasks, previousState.teamName, previousState.members || [], previousState.teamCount || 1, previousState.pendingPermissions || []);
}

// Listen for messages from extension host
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'updateTasks':
      renderBoard(msg.tasks, msg.teamName, msg.members || [], msg.teamCount || 1, msg.pendingPermissions || []);
      vscode.setState({ tasks: msg.tasks, teamName: msg.teamName, members: msg.members, teamCount: msg.teamCount, pendingPermissions: msg.pendingPermissions });
      break;
    case 'noTeams':
      showNoTeams();
      vscode.setState(null);
      break;
    case 'error':
      showError(msg.message);
      break;
  }
});

document.getElementById('switch-team-btn').addEventListener('click', () => {
  vscode.postMessage({ type: 'selectTeam' });
});

// Signal readiness
vscode.postMessage({ type: 'ready' });

/**
 * @param {any[]} tasks
 * @param {string} teamName
 * @param {any[]} members
 * @param {number} teamCount
 * @param {string[]} pendingPermissions
 */
function renderBoard(tasks, teamName, members, teamCount, pendingPermissions) {
  // Restore column structure if it was replaced by showNoTeams/showError
  if (!board.querySelector('.column')) {
    board.innerHTML = boardOriginalHtml;
  }
  board.classList.remove('no-teams');
  toolbar.style.display = '';
  teamNameEl.textContent = teamName;
  switchTeamBtn.style.display = teamCount > 1 ? '' : 'none';

  // Agents with unread permission requests need user action
  membersNeedingAction = new Set(pendingPermissions);

  renderMembers(members);

  const statuses = ['pending', 'in_progress', 'completed'];
  for (const status of statuses) {
    const column = board.querySelector(`.column[data-status="${status}"]`);
    const cardList = column.querySelector('.card-list');
    const statusTasks = tasks.filter(t => t.status === status);

    column.querySelector('.count').textContent = statusTasks.length;
    cardList.innerHTML = '';

    if (statusTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = status === 'pending' ? 'No pending tasks'
        : status === 'in_progress' ? 'No tasks in progress'
        : 'No completed tasks';
      cardList.appendChild(empty);
    } else {
      for (const task of statusTasks) {
        cardList.appendChild(createCard(task));
      }
    }
  }
}

/** @type {Set<string>} */
let membersNeedingAction = new Set();

/**
 * @param {any[]} members
 */
function renderMembers(members) {
  membersStrip.innerHTML = '';
  if (!members || members.length === 0) {
    return;
  }

  // Assign unique animal emojis to members
  currentEmojiMap = assignMemberEmojis(members.map(m => m.name));

  for (const member of members) {
    const el = document.createElement('div');
    el.className = 'member';
    if (membersNeedingAction.has(member.name)) {
      el.classList.add('needs-action');
    }

    const icon = document.createElement('span');
    icon.className = 'member-icon';
    icon.textContent = currentEmojiMap.get(member.name) || '👤';

    const name = document.createElement('span');
    name.className = 'member-name';
    name.textContent = member.name;

    const type = document.createElement('span');
    type.className = 'member-type';
    type.textContent = member.agentType ? `(${member.agentType})` : '';

    el.appendChild(icon);
    el.appendChild(name);
    el.appendChild(type);
    membersStrip.appendChild(el);
  }
}

/**
 * @param {any} task
 * @returns {HTMLElement}
 */
function createCard(task) {
  const card = document.createElement('div');
  card.className = 'card';
  if (task.blockedBy && task.blockedBy.length > 0) {
    card.classList.add('blocked');
  }

  const ownerNeedsAction = task.owner && membersNeedingAction.has(task.owner);
  if (ownerNeedsAction) {
    card.classList.add('needs-action');
  }

  let html = `<div class="card-header">
    <span class="card-id">#${escapeHtml(task.id)}</span>
    ${task.owner ? `<span class="card-owner">${currentEmojiMap.get(task.owner) || '👤'} ${escapeHtml(task.owner)}</span>` : ''}
  </div>
  <div class="card-subject">${escapeHtml(task.subject)}</div>`;

  if (task.description) {
    html += `<div class="card-description">${escapeHtml(task.description)}</div>`;
  }

  if (task.activeForm && task.status === 'in_progress') {
    html += `<div class="card-active-form">${escapeHtml(task.activeForm)}</div>`;
  }

  if (ownerNeedsAction) {
    html += `<div class="card-needs-action">\u26A0 Needs Action</div>`;
  }

  if (task.blockedBy && task.blockedBy.length > 0) {
    html += `<div class="card-blocked">Blocked by: ${task.blockedBy.map(id => '#' + escapeHtml(id)).join(', ')}</div>`;
  }

  if (task.blocks && task.blocks.length > 0) {
    html += `<div class="card-blocks">Blocks: ${task.blocks.map(id => '#' + escapeHtml(id)).join(', ')}</div>`;
  }

  card.innerHTML = html;
  card.title = buildTooltip(task);
  return card;
}

/**
 * @param {any} task
 * @returns {string}
 */
function buildTooltip(task) {
  const lines = [];
  lines.push(`#${task.id} — ${task.subject}`);
  lines.push(`Status: ${task.status.replace(/_/g, ' ')}`);
  if (task.owner) {
    lines.push(`Owner: ${currentEmojiMap.get(task.owner) || ''} ${task.owner}`);
  }
  if (task.description) {
    lines.push('');
    lines.push(task.description);
  }
  if (task.activeForm) {
    lines.push('');
    lines.push(`Action: ${task.activeForm}`);
  }
  if (task.blockedBy && task.blockedBy.length > 0) {
    lines.push(`Blocked by: ${task.blockedBy.map(id => '#' + id).join(', ')}`);
  }
  if (task.blocks && task.blocks.length > 0) {
    lines.push(`Blocks: ${task.blocks.map(id => '#' + id).join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function showNoTeams() {
  toolbar.style.display = 'none';
  membersStrip.innerHTML = '';
  board.classList.add('no-teams');
  board.innerHTML = `<div class="no-teams-state">
    <div class="no-teams-icon">📋</div>
    <div class="no-teams-title">No active teams</div>
    <div class="no-teams-subtitle">Start a Claude Code team to see tasks here</div>
  </div>`;
}

/**
 * @param {string} message
 */
function showError(message) {
  board.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
}
