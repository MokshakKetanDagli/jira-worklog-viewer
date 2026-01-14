# Workday Health - Jira Worklog Viewer

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
cd Workday-Project
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

## Project Structure

```
.
├── manifest.json           # Extension configuration
├── background.js           # Service worker & API calls
├── config.js              # Local config (in .gitignore)
├── config.example.js      # Config template for GitHub
├── popup/
│   ├── popup.html         # UI markup & styles
│   └── popup.js           # Calendar logic & rendering
└── README.md              # This file
```

## Security Note

**Never commit `config.js` to version control!** It contains sensitive information about your Jira instance. The file is in `.gitignore` by default.

Always use `config.example.js` as a template for new setup.

## API Integration

The extension uses the Jira REST API v3:
- `/rest/api/3/myself` - Get current user profile
- `/rest/api/3/search/jql` - Search for issues with worklogs
- `/rest/api/3/issue/{key}/worklog` - Fetch worklog details

Authentication is handled via browser cookies (`tenant.session.token`).

## Performance

- **Caching**: 5-minute TTL reduces API calls
- **Lazy Loading**: Background loading doesn't block user interactions
- **Request Prioritization**: User-selected dates load immediately
- **Parallel Fetching**: Worklogs for all issues fetched in parallel

## Troubleshooting

### Extension not loading?
- Verify `config.js` exists with correct `JIRA_DOMAIN`
- Check Chrome DevTools console for errors (Right-click popup > Inspect)

### No worklogs showing?
- Ensure you're logged into Jira in this Chrome profile
- Check that you have worklogs for the selected dates
- Open DevTools console to see debug logs

### Worklogs are slow to load?
- Cache expires after 5 minutes - first load may take longer
- Parallel requests are limited by browser - wait for current requests to finish

## Development

- **Background Logic**: See `background.js` for API integration
- **UI Logic**: See `popup/popup.js` for calendar rendering
- **Styling**: CSS is in `popup/popup.html`

## Author

Created by **Mokshak Ketan Dagli**  
📧 [mokshak.dagli@syncron.com](mailto:mokshak.dagli@syncron.com)

## License

Private - For internal use only
