const TARGET_HOURS = 6;

let currentMonth = null; // Date pointing to the 1st of current month in view
let selectedDate = null; // yyyy-mm-dd
let isMonthView = false;
let revealedPastDays = 0; // how many past days (before today) have been revealed in the current week
let isWeekRevealAnimating = false;

let expandWeekBtnEl = null;

let weekState = null; // { dayOfWeek, startOfWeek: Date, dateStrByIndex: string[], cellEls: HTMLElement[] }

// Per-popup-session caches (NOT persisted).
// DATE_HOURS values: number | 'loading'
const DATE_HOURS = {};
// DATE_SUMMARY stores the full syncLogs response so selecting a date doesn't re-query.
const DATE_SUMMARY = {}; // dateStr -> { success, logs, totalHours, count }

let monthLoadKey = null;
let loadGeneration = 0; // used to cancel/ignore stale scheduled loads

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = formatDate(today);

  wireEvents();
  render();

  // On open: always compute only today's date.
  fetchLogs(selectedDate);
});

function wireEvents() {
  const toggleViewBtn = document.getElementById('toggleView');
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');
  const weekView = document.getElementById('weekView');

  if (!toggleViewBtn || !prevMonthBtn || !nextMonthBtn || !weekView) {
    console.error('[POPUP] Missing expected DOM elements. Are you loading popup_calendar.html?');
    return;
  }

  toggleViewBtn.addEventListener('click', () => {
    isMonthView = !isMonthView;
    revealedPastDays = 0;
    isWeekRevealAnimating = false;

    toggleViewBtn.textContent = isMonthView ? 'Week View' : 'Full Month';
    render();

    // Start month-hour loading only when month view is opened.
    if (isMonthView) {
      startLazyLoadingMonthHours();
    }
  });

  // Expand button is rendered inside the week grid; use event delegation.
  weekView.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.id === 'expandWeek') {
      // One-way reveal animation: yesterday -> Sunday, then the button disappears.
      if (isWeekRevealAnimating) return;
      animateRevealPastWeek();
    }
  });

  prevMonthBtn.addEventListener('click', () => {
    if (!isMonthView) {
      isMonthView = true;
      toggleViewBtn.textContent = 'Week View';
    }
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    render();

    // Month view implies month hours loading.
    startLazyLoadingMonthHours();
  });

  nextMonthBtn.addEventListener('click', () => {
    if (!isMonthView) {
      isMonthView = true;
      toggleViewBtn.textContent = 'Week View';
    }
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    render();

    startLazyLoadingMonthHours();
  });
}

function render() {
  updateMonthLabel();
  if (isMonthView) {
    document.getElementById('calendarGrid').style.display = 'grid';
    document.getElementById('weekView').style.display = 'none';
    renderMonthView();
    // Ensure month-day hours keep filling in even after re-renders.
    startLazyLoadingMonthHours();
  } else {
    document.getElementById('calendarGrid').style.display = 'none';
    document.getElementById('weekView').style.display = 'block';
    renderWeekView();
  }
}

function updateMonthLabel() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('monthLabel').textContent = `${monthNames[month]} ${year}`;
}

function renderWeekView() {
  const weekView = document.getElementById('weekView');

  const weekGrid = document.getElementById('weekGrid');
  weekGrid.innerHTML = '';

  const today = new Date();
  const todayStr = formatDate(today);
  const dayOfWeek = today.getDay(); // 0=Sun
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);

  weekState = {
    dayOfWeek,
    startOfWeek,
    dateStrByIndex: [],
    cellEls: []
  };

  for (let i = 0; i < 7; i++) {
    const cell = document.createElement('div');
    cell.className = 'week-cell';

    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    const dateStr = formatDate(date);
    weekState.dateStrByIndex[i] = dateStr;

    if (i === dayOfWeek) {
      // Today's cell: bubble always visible.
      const bubble = createDateBubble(todayStr, false, todayStr === selectedDate);
      cell.appendChild(bubble);
    } else if (i < dayOfWeek) {
      // Past days: reveal progressively from yesterday going backwards.
      // Example for Thursday (dayOfWeek=4): reveal indices 3(Wed),2(Tue),1(Mon),0(Sun)
      const shouldReveal = (dayOfWeek - 1 - i) < revealedPastDays;
      if (shouldReveal) {
        const bubble = createDateBubble(dateStr, false, dateStr === selectedDate);
        cell.appendChild(bubble);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'week-placeholder';
        placeholder.dataset.weekIndex = String(i);
        cell.appendChild(placeholder);
      }
    } else {
      // Future days or collapsed past days => keep empty cell to preserve alignment.
      const placeholder = document.createElement('div');
      placeholder.className = 'week-placeholder hidden';
      cell.appendChild(placeholder);
    }

    weekGrid.appendChild(cell);
    weekState.cellEls[i] = cell;
  }

  // Expand button positioning: starts under yesterday, moves left as we reveal, disappears at Sunday.
  const canExpand = dayOfWeek > 0;
  const remainingToReveal = dayOfWeek - revealedPastDays;
  const shouldShowButton = canExpand && remainingToReveal > 0;
  const targetIndex = shouldShowButton ? (dayOfWeek - 1 - revealedPastDays) : null;

  ensureExpandButton(weekGrid, targetIndex, shouldShowButton);
}

function ensureExpandButton(weekGrid, targetIndex, show) {
  // If it's Sunday (or nothing to show), remove the button entirely.
  if (!show || targetIndex === null || targetIndex < 0) {
    if (expandWeekBtnEl) {
      expandWeekBtnEl.classList.add('hidden');
      const toRemove = expandWeekBtnEl;
      expandWeekBtnEl = null;
      setTimeout(() => {
        if (toRemove && toRemove.parentElement) toRemove.remove();
      }, 220);
    }
    return;
  }

  if (!expandWeekBtnEl) {
    expandWeekBtnEl = document.createElement('button');
    expandWeekBtnEl.id = 'expandWeek';
    expandWeekBtnEl.className = 'calendar-nav expand-week-btn';
    expandWeekBtnEl.title = 'Expand week (yesterday → Sunday)';
    expandWeekBtnEl.textContent = '‹';
    expandWeekBtnEl.dataset.initialized = 'false';
  }

  if (expandWeekBtnEl.parentElement !== weekGrid) {
    weekGrid.appendChild(expandWeekBtnEl);
  }

  expandWeekBtnEl.disabled = isWeekRevealAnimating;
  expandWeekBtnEl.classList.remove('hidden');

  const pos = computeWeekAnchorCenter(weekGrid, targetIndex);
  if (!pos) return;

  // On first placement, set without transition to avoid a weird initial slide-in.
  if (expandWeekBtnEl.dataset.initialized !== 'true') {
    const prevTransition = expandWeekBtnEl.style.transition;
    expandWeekBtnEl.style.transition = 'none';
    expandWeekBtnEl.style.left = `${pos.left}px`;
    expandWeekBtnEl.style.top = `${pos.top}px`;
    requestAnimationFrame(() => {
      expandWeekBtnEl.style.transition = prevTransition;
      expandWeekBtnEl.dataset.initialized = 'true';
    });
    return;
  }

  expandWeekBtnEl.style.left = `${pos.left}px`;
  expandWeekBtnEl.style.top = `${pos.top}px`;
}

function computeWeekAnchorCenter(weekGrid, index) {
  if (!weekGrid || index === null || index === undefined || index < 0) return null;
  const cells = weekGrid.querySelectorAll('.week-cell');
  const cell = cells[index];
  if (!cell) return null;

  const target =
    cell.querySelector('.date-bubble') ||
    cell.querySelector('.week-placeholder') ||
    cell;

  const gridRect = weekGrid.getBoundingClientRect();
  const rect = target.getBoundingClientRect();

  return {
    left: (rect.left - gridRect.left) + (rect.width / 2),
    top: (rect.top - gridRect.top) + (rect.height / 2)
  };
}

async function animateRevealPastWeek() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  if (dayOfWeek === 0) return;
  if (revealedPastDays >= dayOfWeek) return;

  isWeekRevealAnimating = true;
  // Ensure we have a stable week grid rendered with placeholders.
  renderWeekView();

  const weekGrid = document.getElementById('weekGrid');
  if (!weekGrid || !weekState) {
    isWeekRevealAnimating = false;
    return;
  }

  // Position the button under yesterday immediately (no jumpy transition).
  ensureExpandButton(weekGrid, dayOfWeek - 1, true);

  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);
  const gen = loadGeneration;

  // Build a smooth left-glide path: yesterday -> ... -> Sunday.
  const indices = [];
  for (let idx = dayOfWeek - 1; idx >= 0; idx--) indices.push(idx);

  const keyframes = indices
    .map(i => computeWeekAnchorCenter(weekGrid, i))
    .filter(Boolean)
    .map(pos => ({ left: `${pos.left}px`, top: `${pos.top}px` }));

  const stepMs = 320;
  const totalMs = Math.max(0, (keyframes.length - 1) * stepMs);

  let motion = null;
  if (expandWeekBtnEl && keyframes.length >= 2) {
    try {
      motion = expandWeekBtnEl.animate(keyframes, {
        duration: totalMs,
        easing: 'linear',
        fill: 'forwards'
      });
    } catch {
      // If WAAPI fails for any reason, we still reveal bubbles on a timer.
      motion = null;
    }
  }

  // Reveal order: yesterday -> ... -> Sunday (timed to the motion).
  const revealPromises = indices.map((revealedIndex, step) => new Promise(resolve => {
    setTimeout(() => {
      const revealedDate = new Date(startOfWeek);
      revealedDate.setDate(startOfWeek.getDate() + revealedIndex);
      const revealedDateStr = formatDate(revealedDate);

      const cell = weekState.cellEls[revealedIndex];
      if (cell) {
        const existingBubble = cell.querySelector('.date-bubble');
        if (!existingBubble) {
          const placeholder = cell.querySelector('.week-placeholder');
          if (placeholder) placeholder.classList.add('hidden');

          const bubble = createDateBubble(revealedDateStr, false, revealedDateStr === selectedDate);
          bubble.classList.add('pop-in');
          setTimeout(() => bubble.classList.remove('pop-in'), 260);

          cell.innerHTML = '';
          cell.appendChild(bubble);
        }
      }

      fetchDateSummary(revealedDateStr, gen);
      revealedPastDays = Math.max(revealedPastDays, step + 1);

      resolve();
    }, step * stepMs);
  }));

  await Promise.all(revealPromises);
  if (motion) {
    try { await motion.finished; } catch { /* ignore */ }
  } else {
    await new Promise(resolve => setTimeout(resolve, totalMs));
  }

  isWeekRevealAnimating = false;
  // Ensure the button is removed at the end.
  ensureExpandButton(document.getElementById('weekGrid'), null, false);
}

function renderMonthView() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const prevLastDay = new Date(year, month, 0).getDate();

  const startWeekday = firstDay.getDay();
  const endDate = lastDay.getDate();

  // Previous month's trailing days
  for (let i = startWeekday - 1; i >= 0; i--) {
    const dateStr = formatDate(new Date(year, month - 1, prevLastDay - i));
    grid.appendChild(createDateBubble(dateStr, true, false));
  }

  // Current month days
  for (let day = 1; day <= endDate; day++) {
    const dateStr = formatDate(new Date(year, month, day));
    grid.appendChild(createDateBubble(dateStr, false, dateStr === selectedDate));
  }

  // Next month's leading days only to complete the last week row.
  const totalCells = grid.children.length;
  const remainder = totalCells % 7;
  const remainingCells = remainder === 0 ? 0 : (7 - remainder);
  for (let day = 1; day <= remainingCells; day++) {
    const dateStr = formatDate(new Date(year, month + 1, day));
    grid.appendChild(createDateBubble(dateStr, true, false));
  }
}

function createDateBubble(dateStr, isOtherMonth, isSelected) {
  const bubble = document.createElement('div');
  bubble.className = 'date-bubble';
  if (isOtherMonth) bubble.classList.add('other-month');
  if (isSelected) bubble.classList.add('selected');

  bubble.dataset.date = dateStr;

  const inner = document.createElement('div');
  inner.className = 'date-bubble-inner';
  bubble.appendChild(inner);

  const day = parseInt(dateStr.split('-')[2], 10);
  const text = document.createElement('div');
  text.className = 'date-bubble-text';
  text.textContent = day;
  bubble.appendChild(text);

  if (!isOtherMonth) {
    bubble.addEventListener('click', () => {
      selectDate(dateStr);
    });
  }

  // Apply hours color if already known
  const hours = DATE_HOURS[dateStr];
  if (hours === 'loading') {
    bubble.classList.add('loading');
  } else if (typeof hours === 'number') {
    updateBubbleData(bubble, hours);
  }

  return bubble;
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  // Re-render just to update selected highlights; no prefetch.
  render();
  fetchLogs(dateStr);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatHuman(dateStr) {
  const [year, month, day] = dateStr.split('-').map(n => parseInt(n, 10));
  const dateObj = new Date(year, month - 1, day);
  return dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function updateBubbleData(bubble, hours) {
  bubble.classList.remove('loading', 'empty', 'critical', 'warning', 'good', 'excellent');

  if (hours === 0) {
    bubble.classList.add('empty');
    return;
  }

  const fill = Math.max(0, Math.min(1, hours / TARGET_HOURS));

  if (hours < 2) {
    bubble.classList.add('critical');
    bubble.style.setProperty('--fill', fill.toFixed(2));
  } else if (hours < 4) {
    bubble.classList.add('warning');
    bubble.style.setProperty('--fill', fill.toFixed(2));
  } else if (hours < TARGET_HOURS) {
    bubble.classList.add('good');
    bubble.style.setProperty('--fill', fill.toFixed(2));
  } else {
    bubble.classList.add('excellent');
  }
}

function updateAllBubblesForDate(dateStr) {
  const hours = DATE_HOURS[dateStr];
  document.querySelectorAll(`.date-bubble[data-date="${dateStr}"]`).forEach(bubble => {
    if (hours === 'loading') {
      bubble.classList.add('loading');
    } else if (typeof hours === 'number') {
      updateBubbleData(bubble, hours);
    }
  });
}

function fetchDateSummary(dateStr, gen) {
  if (gen !== undefined && gen !== loadGeneration) return;

  // Already have full details
  if (DATE_SUMMARY[dateStr]) {
    const parsed = parseFloat(DATE_SUMMARY[dateStr].totalHours);
    DATE_HOURS[dateStr] = Number.isFinite(parsed) ? parsed : 0;
    updateAllBubblesForDate(dateStr);
    return;
  }

  // If we're already loading hours, keep it.
  if (DATE_HOURS[dateStr] === 'loading') return;

  // Don't fetch future dates.
  const todayStr = formatDate(new Date());
  if (dateStr > todayStr) {
    DATE_HOURS[dateStr] = 0;
    updateAllBubblesForDate(dateStr);
    return;
  }

  DATE_HOURS[dateStr] = 'loading';
  updateAllBubblesForDate(dateStr);

  chrome.runtime.sendMessage({ action: 'syncLogs', date: dateStr }, (response) => {
    if (gen !== undefined && gen !== loadGeneration) return;

    if (chrome.runtime.lastError) {
      DATE_HOURS[dateStr] = 0;
      updateAllBubblesForDate(dateStr);
      return;
    }

    if (response && response.success) {
      DATE_SUMMARY[dateStr] = response;
      const parsed = parseFloat(response.totalHours);
      DATE_HOURS[dateStr] = Number.isFinite(parsed) ? parsed : 0;
    } else {
      DATE_HOURS[dateStr] = 0;
    }

    updateAllBubblesForDate(dateStr);
  });
}

// Week loading is driven by animateRevealPastWeek() to ensure the intended order.

function startLazyLoadingMonthHours() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const todayStr = formatDate(new Date());
  const lastDay = new Date(year, month + 1, 0).getDate();

  // Pick the best starting point:
  // - If the selected date is in this month, start from selected date
  // - Else start from min(today, last day of month) for current month
  // - Else start from last day of month for past months
  let anchorDay = lastDay;
  const today = new Date();
  const isCurrentMonth = (year === today.getFullYear() && month === today.getMonth());
  if (isCurrentMonth) {
    anchorDay = Math.min(today.getDate(), lastDay);
  }

  if (selectedDate) {
    const [sy, sm, sd] = selectedDate.split('-').map(n => parseInt(n, 10));
    if (sy === year && (sm - 1) === month) {
      // Don't start from a future date.
      const selStr = selectedDate;
      const safeDay = Math.min(sd, lastDay);
      if (selStr <= todayStr) anchorDay = safeDay;
      else if (!isCurrentMonth) anchorDay = safeDay;
    }
  }

  // If we're still missing any past-day data for this month, allow re-run.
  let hasMissing = false;
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = formatDate(new Date(year, month, day));
    if (dateStr > todayStr) break;
    if (DATE_SUMMARY[dateStr]) continue;
    if (DATE_HOURS[dateStr] !== undefined) continue;
    hasMissing = true;
    break;
  }

  if (monthLoadKey === key && !hasMissing) return;

  // Only cancel/ignore previously scheduled loads when the month changes.
  if (monthLoadKey !== key) {
    monthLoadKey = key;
    loadGeneration++;
  }
  const gen = loadGeneration;

  let delay = 0;

  for (let day = anchorDay; day >= 1; day--) {
    const dateStr = formatDate(new Date(year, month, day));
    if (dateStr > todayStr) continue;
    if (DATE_SUMMARY[dateStr] || DATE_HOURS[dateStr] !== undefined) continue;

    delay += 110;
    setTimeout(() => fetchDateSummary(dateStr, gen), delay);
  }
}

function fetchLogs(dateStr) {
  const status = document.getElementById('status');
  const body = document.getElementById('logsBody');
  const copyBtn = document.getElementById('copyBtn');

  status.textContent = 'Loading…';
  body.innerHTML = '';
  copyBtn.onclick = null;

  document.getElementById('selectedDateDisplay').textContent = formatHuman(dateStr);
  document.getElementById('totalHours').textContent = '0.00';

  // If we already fetched this date's summary (e.g., via week/month coloring), reuse it.
  if (DATE_SUMMARY[dateStr]) {
    renderLogsFromResponse(dateStr, DATE_SUMMARY[dateStr]);
    return;
  }

  chrome.runtime.sendMessage({ action: 'syncLogs', date: dateStr }, (response) => {
    if (chrome.runtime.lastError) {
      status.textContent = 'Error: ' + chrome.runtime.lastError.message;
      return;
    }

    if (!response || !response.success) {
      status.textContent = 'Error: ' + (response?.error || 'Unknown error');
      return;
    }

    if (response && response.success) {
      DATE_SUMMARY[dateStr] = response;
    }
    renderLogsFromResponse(dateStr, response);
  });
}

function renderLogsFromResponse(dateStr, response) {
  const status = document.getElementById('status');
  const body = document.getElementById('logsBody');
  const copyBtn = document.getElementById('copyBtn');

  if (!response || !response.success) {
    status.textContent = 'Error: ' + (response?.error || 'Unknown error');
    return;
  }

  status.textContent = '';
  document.getElementById('totalHours').textContent = response.totalHours;

  // Store hours for bubble coloring in this popup session.
  const parsed = parseFloat(response.totalHours);
  DATE_HOURS[dateStr] = Number.isFinite(parsed) ? parsed : 0;
  updateAllBubblesForDate(dateStr);

  body.innerHTML = '';
  if (!response.logs || response.logs.length === 0) {
    status.textContent = 'No logs for this date.';
    return;
  }

  response.logs.forEach(log => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${log.issueKey}</td><td style="text-align: right;">${log.hours}h</td>`;
    body.appendChild(row);
  });

  const tickets = response.logs.map(l => l.issueKey).join(', ');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(tickets).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 900);
    });
  };
}


