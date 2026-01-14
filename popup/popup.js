const TARGET_HOURS = 6;
const MONTH_DATA = {}; // Cache for month data
let currentMonth = new Date();
let selectedDate = null;
let isExpandedView = false;
let currentRequestVersion = 0; // Used to invalidate pending background requests
let backgroundLoadingCount = 0; // Track background requests
let showingMonthWeek = null; // Track if showing a specific month's week (not current week)

function showBackgroundLoading() {
  backgroundLoadingCount++;
  document.getElementById('backgroundStatus').classList.add('loading');
}

function hideBackgroundLoading() {
  backgroundLoadingCount--;
  if (backgroundLoadingCount <= 0) {
    backgroundLoadingCount = 0;
    document.getElementById('backgroundStatus').classList.remove('loading');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = today.toISOString().split('T')[0];
  
  renderCalendar();
  startLazyLoadingWeek(); // Start with week view only
});

/* ===== View Toggle ===== */
document.getElementById('toggleView').addEventListener('click', () => {
  isExpandedView = !isExpandedView;
  const btn = document.getElementById('toggleView');
  btn.textContent = isExpandedView ? 'Week View' : 'Full Month';
  showingMonthWeek = null; // Reset to today when toggling views
  currentMonth = new Date(); // Reset month to current month
  renderCalendar();
  
  // Auto-start loading when switching to month view
  if (isExpandedView) {
    setTimeout(() => startLazyLoadingMonth(), 100);
  } else {
    setTimeout(() => startLazyLoadingWeek(), 100);
  }
});

/* ===== Calendar Rendering ===== */
function renderCalendar() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  
  updateMonthLabel(year, month);
  
  if (isExpandedView) {
    renderFullMonth(year, month);
  } else {
    renderWeekView(year, month);
  }
}

function updateMonthLabel(year, month) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('monthLabel').textContent = `${monthNames[month]} ${year}`;
}

function renderFullMonth(year, month) {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const prevLastDay = new Date(year, month, 0).getDate();
  
  const startDate = firstDay.getDay();
  const endDate = lastDay.getDate();
  
  // Previous month's trailing days
  for (let i = startDate - 1; i >= 0; i--) {
    const dateStr = formatDate(new Date(year, month - 1, prevLastDay - i));
    const bubble = createDateBubble(dateStr, true);
    grid.appendChild(bubble);
  }
  
  // Current month's days
  for (let day = 1; day <= endDate; day++) {
    const dateStr = formatDate(new Date(year, month, day));
    const isSelected = dateStr === selectedDate;
    const bubble = createDateBubble(dateStr, false, isSelected);
    grid.appendChild(bubble);
  }
  
  // Next month's leading days
  const totalCells = grid.children.length;
  const remainingCells = 42 - totalCells;
  for (let day = 1; day <= remainingCells; day++) {
    const dateStr = formatDate(new Date(year, month + 1, day));
    const bubble = createDateBubble(dateStr, true);
    grid.appendChild(bubble);
  }
}

function renderWeekView(year, month) {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  
  let startOfWeek;
  
  if (showingMonthWeek === null) {
    // Show today's week (normal behavior)
    const today = new Date();
    const dayOfWeek = today.getDay();
    startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
  } else if (showingMonthWeek === 'last') {
    // Show last week of the previous month (when going back)
    const lastDay = new Date(year, month + 1, 0);
    const lastDayOfMonth = lastDay.getDate();
    const lastDayDayOfWeek = lastDay.getDay();
    startOfWeek = new Date(year, month, lastDayOfMonth - lastDayDayOfWeek);
  } else {
    // Show first week of next month (when going forward)
    const firstDay = new Date(year, month, 1);
    const firstDayDayOfWeek = firstDay.getDay();
    startOfWeek = new Date(year, month, 1 - firstDayDayOfWeek);
  }
  
  // Show 7 days from start of week
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    const dateStr = formatDate(date);
    const isSelected = dateStr === selectedDate;
    const isCurrentMonth = date.getMonth() === month && date.getFullYear() === year;
    const bubble = createDateBubble(dateStr, !isCurrentMonth, isSelected);
    grid.appendChild(bubble);
  }
}

function createDateBubble(dateStr, isOtherMonth, isSelected = false) {
  const bubble = document.createElement('div');
  const day = parseInt(dateStr.split('-')[2]);
  
  bubble.className = 'date-bubble';
  if (isOtherMonth) bubble.classList.add('other-month');
  if (isSelected) bubble.classList.add('selected');
  
  // Check if data is loading
  if (!isOtherMonth && MONTH_DATA[dateStr] === 'loading') {
    bubble.classList.add('loading');
  }
  
  const inner = document.createElement('div');
  inner.className = 'date-bubble-inner';
  
  const text = document.createElement('div');
  text.className = 'date-bubble-text';
  text.textContent = day;
  
  bubble.appendChild(inner);
  bubble.appendChild(text);
  
  // Update bubble with cached data
  if (MONTH_DATA[dateStr] !== undefined && MONTH_DATA[dateStr] !== 'loading') {
    updateBubbleData(bubble, MONTH_DATA[dateStr]);
  }
  
  // Click handler
  if (!isOtherMonth) {
    bubble.addEventListener('click', () => selectDate(dateStr, bubble));
  }
  
  return bubble;
}

function updateBubbleData(bubble, hours) {
  bubble.classList.remove('loading', 'empty', 'critical', 'warning', 'good', 'excellent');
  
  if (hours === 0) {
    bubble.classList.add('empty');
  } else if (hours < 2) {
    bubble.classList.add('critical');
    bubble.style.setProperty('--fill', (hours / TARGET_HOURS).toFixed(2));
  } else if (hours < 4) {
    bubble.classList.add('warning');
    bubble.style.setProperty('--fill', (hours / TARGET_HOURS).toFixed(2));
  } else if (hours < TARGET_HOURS) {
    bubble.classList.add('good');
    bubble.style.setProperty('--fill', (hours / TARGET_HOURS).toFixed(2));
  } else {
    bubble.classList.add('excellent');
  }
}

function selectDate(dateStr, bubble) {
  // Increment version to invalidate all pending background requests
  currentRequestVersion++;
  
  // Clear 'loading' states so they can be re-fetched after this completes
  Object.keys(MONTH_DATA).forEach(key => {
    if (MONTH_DATA[key] === 'loading') {
      delete MONTH_DATA[key];
    }
  });
  
  // Update selected state
  document.querySelectorAll('.date-bubble').forEach(b => b.classList.remove('selected'));
  bubble.classList.add('selected');
  
  // Show right panel
  document.getElementById('rightPanel').classList.add('visible');
  
  selectedDate = dateStr;
  fetchLogs(dateStr, true); // true = user-initiated, high priority
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ===== Prioritized Lazy Loading ===== */
function startLazyLoadingWeek() {
  let startOfWeek;
  
  if (showingMonthWeek === null) {
    // Show today's week (normal behavior)
    const today = new Date();
    const dayOfWeek = today.getDay();
    startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
  } else if (showingMonthWeek === 'last') {
    // Show last week of the specified month
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    const lastDayOfMonth = lastDay.getDate();
    const lastDayDayOfWeek = lastDay.getDay();
    startOfWeek = new Date(year, month, lastDayOfMonth - lastDayDayOfWeek);
  } else {
    // Show first week of the specified month
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstDayDayOfWeek = firstDay.getDay();
    startOfWeek = new Date(year, month, 1 - firstDayDayOfWeek);
  }
  
  // Fetch selected date first (immediate)
  fetchDateData(selectedDate, 'HIGH');
  
  // Then fetch rest of week (with background controller - can be interrupted)
  setTimeout(() => {
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      const dateStr = formatDate(date);
      if (dateStr !== selectedDate && MONTH_DATA[dateStr] === undefined) {
        fetchDateData(dateStr, 'BACKGROUND');
      }
    }
  }, 50);
}

function startLazyLoadingMonth() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  
  // Fetch rest of month with background priority (lower than user clicks)
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = formatDate(new Date(year, month, day));
    if (MONTH_DATA[dateStr] === undefined) {
      setTimeout(() => {
        if (MONTH_DATA[dateStr] === undefined) {
          fetchDateData(dateStr, 'BACKGROUND');
        }
      }, Math.random() * 1000); // Stagger requests
    }
  }
}

function fetchDateData(dateStr, priority = 'NORMAL') {
  if (MONTH_DATA[dateStr] !== undefined) return;
  
  // Don't fetch for future dates
  const today = new Date();
  const todayStr = formatDate(today);
  if (dateStr > todayStr) {
    MONTH_DATA[dateStr] = 0; // Mark as empty instead of loading
    updateCalendarBubble(dateStr);
    return;
  }
  
  MONTH_DATA[dateStr] = 'loading';
  updateCalendarBubble(dateStr);
  
  // Show background loading indicator if this is a background request
  if (priority === 'BACKGROUND') {
    showBackgroundLoading();
  }
  
  // Capture current version to detect if user clicked another date
  const versionAtRequest = currentRequestVersion;
  
  chrome.runtime.sendMessage({ action: 'getDateHours', date: dateStr }, (response) => {
    // Hide background loading indicator
    if (priority === 'BACKGROUND') {
      hideBackgroundLoading();
    }
    
    // Ignore response if a newer user request was made (user clicked a different date)
    if (versionAtRequest < currentRequestVersion) {
      console.log(`[POPUP] Ignoring response for ${dateStr}, newer request exists`);
      return;
    }
    
    if (response && response.success) {
      MONTH_DATA[dateStr] = response.totalHours;
    } else {
      MONTH_DATA[dateStr] = 0;
    }
    updateCalendarBubble(dateStr);
  });
}

function updateCalendarBubble(dateStr) {
  const bubbles = document.querySelectorAll('.date-bubble:not(.other-month)');
  bubbles.forEach(bubble => {
    const dayText = bubble.querySelector('.date-bubble-text').textContent;
    const [y, m, d] = dateStr.split('-');
    
    if (formatDate(new Date(parseInt(y), parseInt(m) - 1, parseInt(dayText))) === dateStr) {
      if (MONTH_DATA[dateStr] === 'loading') {
        bubble.classList.add('loading');
      } else if (MONTH_DATA[dateStr] !== undefined) {
        updateBubbleData(bubble, MONTH_DATA[dateStr]);
      }
    }
  });
}

/* ===== Log Fetching ===== */
function fetchLogs(selectedDate, isUserInitiated = false) {
  const status = document.getElementById('status');
  const container = document.getElementById('logsContainer');
  const body = document.getElementById('logsBody');
  
  status.textContent = isUserInitiated ? 'Loading your logs...' : 'Loading...';
  container.style.display = 'none';
  
  chrome.runtime.sendMessage({ action: 'syncLogs', date: selectedDate }, (response) => {
    if (chrome.runtime.lastError) {
      status.textContent = 'Error: ' + chrome.runtime.lastError.message;
      
      // Resume background loading after selected date attempt (even if failed)
      if (isUserInitiated) {
        setTimeout(() => resumeBackgroundLoading(), 100);
      }
      return;
    }
    
    const [year, month, day] = selectedDate.split('-');
    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const displayDate = dateObj.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    document.getElementById('selectedDateDisplay').textContent = displayDate;
    
    if (response && response.success) {
      status.textContent = '';
      
      if (response.logs && response.logs.length > 0) {
        body.innerHTML = '';
        response.logs.forEach(log => {
          const row = document.createElement('tr');
          row.innerHTML = `<td>${log.issueKey}</td><td style="text-align: right;">${log.hours}h</td>`;
          body.appendChild(row);
        });
        
        document.getElementById('totalHours').textContent = response.totalHours;
        container.style.display = 'block';
        
        // Update MONTH_DATA with actual hours
        MONTH_DATA[selectedDate] = parseFloat(response.totalHours);
        updateCalendarBubble(selectedDate);
        
        // Copy functionality
        const tickets = response.logs.map(l => l.issueKey).join(', ');
        document.getElementById('copyBtn').onclick = () => {
          navigator.clipboard.writeText(tickets).then(() => {
            const orig = document.getElementById('copyBtn').textContent;
            document.getElementById('copyBtn').textContent = 'Copied!';
            setTimeout(() => { 
              document.getElementById('copyBtn').textContent = orig; 
            }, 1000);
          });
        };
      } else {
        status.textContent = 'No logs for this date.';
        MONTH_DATA[selectedDate] = 0;
        updateCalendarBubble(selectedDate);
      }
    } else {
      status.textContent = 'Error: ' + (response?.error || 'Unknown error');
    }
    
    // Resume background loading after selected date completes
    if (isUserInitiated) {
      setTimeout(() => resumeBackgroundLoading(), 100);
    }
  });
}

function resumeBackgroundLoading() {
  console.log('[POPUP] Resuming background loading, isExpandedView:', isExpandedView);
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  
  if (!isExpandedView) {
    // Resume week loading
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    
    console.log('[POPUP] Loading week data...');
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      const dateStr = formatDate(date);
      if (MONTH_DATA[dateStr] === undefined) {
        console.log('[POPUP] Queueing:', dateStr);
        setTimeout(() => {
          if (MONTH_DATA[dateStr] === undefined) {
            fetchDateData(dateStr, 'BACKGROUND');
          }
        }, i * 100); // Stagger by 100ms each
      } else {
        console.log('[POPUP] Already loaded/loading:', dateStr, MONTH_DATA[dateStr]);
      }
    }
  } else {
    // Resume month loading
    console.log('[POPUP] Loading month data...');
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = formatDate(new Date(year, month, day));
      if (MONTH_DATA[dateStr] === undefined) {
        setTimeout(() => {
          if (MONTH_DATA[dateStr] === undefined) {
            fetchDateData(dateStr, 'BACKGROUND');
          }
        }, Math.random() * 1000);
      }
    }
  }
}

/* ===== Month Navigation ===== */
document.getElementById('prevMonth').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1);
  showingMonthWeek = 'last'; // Show last week of previous month
  renderCalendar();
  if (isExpandedView) {
    setTimeout(() => startLazyLoadingMonth(), 100);
  } else {
    setTimeout(() => startLazyLoadingWeek(), 100);
  }
});

document.getElementById('nextMonth').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1);
  showingMonthWeek = 'first'; // Show first week of next month
  renderCalendar();
  if (isExpandedView) {
    setTimeout(() => startLazyLoadingMonth(), 100);
  } else {
    setTimeout(() => startLazyLoadingWeek(), 100);
  }
});
