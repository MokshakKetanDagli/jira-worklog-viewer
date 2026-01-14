# Jira Worklog Viewer

A Chrome extension that provides a beautiful calendar view of your Jira worklogs, showing daily work hours as color-coded bubbles.

## Features

- 📅 **Week & Month View**: Toggle between week and full month calendar views
- 🎯 **Smart Loading**: Prioritizes selected date, then lazy-loads background data
- ⚡ **Cached Results**: 5-minute cache reduces API calls for instant detail views
- 🎨 **Health Visualization**: Color-coded bubbles show work hours at a glance
  - Red: < 2 hours
  - Orange: 2-4 hours
  - Green: 4-6 hours
  - Dark Green: 6+ hours
- 📋 **Copy Tickets**: Quickly copy all ticket numbers from a selected date

## Setup Instructions

### 1. Clone the Repository
```bash
git clone <repository-url>
cd Jira-Worklog-Viewer
```

### 2. Configure Your Jira Instance
```bash
# Copy the example config file
cp config.example.js config.js

# Edit config.js with your Jira details
nano config.js
```

Update `config.js` with:
- `JIRA_DOMAIN`: Your Jira instance domain (e.g., `your-company.atlassian.net`)
- `TIMEZONE`: Your timezone (e.g., `Asia/Kolkata`)

**Example config.js:**
```javascript
const CONFIG = {
  JIRA_DOMAIN: 'your-company.atlassian.net',
  TIMEZONE: 'Asia/Kolkata',
  // ... rest of config
};
```

### 3. Load the Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the project directory

### 4. Authenticate with Jira
1. Navigate to your Jira instance in Chrome (https://your-company.atlassian.net)
2. Log in to ensure authentication cookies are stored
3. The extension will use these cookies for API calls

### 5. Use the Extension
1. Click the extension icon in your Chrome toolbar
2. View your worklogs for the current week
3. Click on any date to see detailed logs
4. Use the **Full Month** button to expand to full month view
5. Use the **< >** buttons to navigate months

## Author

Created by **Mokshak Ketan Dagli**  
📧 [mokshak.dagli@syncron.com](mailto:mokshak.dagli@syncron.com)

## License

Private - For internal use only
