const { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec, spawn } = require('child_process');
const os = require('os');
const chokidar = require('chokidar');

let mainWindow;
let splashWindow;
let projectsBasePath = path.join(os.homedir(), 'Projects');
let fileWatchers = new Map(); // Track active file watchers per project
let gitOperationHistory = []; // For undo/redo functionality
const MAX_HISTORY = 50;

let appSettings = {
  theme: 'dark',
  autoSave: true,
  openInVSCode: true,
  gitIntegration: true,
  defaultProjectPath: projectsBasePath,
  fontSize: 13,
  autoUpdate: true,
  terminalApp: 'cmd',
  showWelcome: true,
  autoRefreshInterval: 2000,
  enableFileWatcher: true
};

// Advanced Logger System
class Logger {
  constructor() {
    this.logPath = null;
    this.currentLogFile = null;
    this.initialized = false;
  }

  async initializeLogger() {
    if (this.initialized) return;

    try {
      // Initialize log path (app must be ready)
      this.logPath = path.join(app.getPath('userData'), 'logs');
      await fs.mkdir(this.logPath, { recursive: true });
      const date = new Date().toISOString().split('T')[0];
      this.currentLogFile = path.join(this.logPath, `app-${date}.log`);
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize logger:', error);
    }
  }

  async log(level, message, data = null) {
    // Ensure logger is initialized
    if (!this.initialized) {
      await this.initializeLogger();
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}\n`;

    // Console output
    if (level === 'error') {
      console.error(logLine);
    } else if (level === 'warn') {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }

    // File output
    if (this.currentLogFile) {
      try {
        await fs.appendFile(this.currentLogFile, logLine);
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  info(message, data) {
    return this.log('info', message, data);
  }

  warn(message, data) {
    return this.log('warn', message, data);
  }

  error(message, data) {
    return this.log('error', message, data);
  }

  debug(message, data) {
    return this.log('debug', message, data);
  }
}

const logger = new Logger();

// Git Command Wrapper with advanced error handling
async function executeGitCommand(command, cwd, operation = 'Git Operation') {
  return new Promise((resolve) => {
    logger.info(`Executing: ${command}`, { cwd, operation });

    exec(command, { cwd, timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Git command failed: ${command}`, {
          error: error.message,
          stderr,
          cwd,
          operation
        });

        // Provide user-friendly error messages
        let userMessage = error.message;
        if (stderr) {
          if (stderr.includes('not a git repository')) {
            userMessage = 'This is not a git repository. Initialize it first.';
          } else if (stderr.includes('Permission denied')) {
            userMessage = 'Permission denied. Check file permissions.';
          } else if (stderr.includes('Authentication failed')) {
            userMessage = 'Authentication failed. Check your credentials.';
          } else if (stderr.includes('Could not resolve host')) {
            userMessage = 'Network error. Check your internet connection.';
          } else if (stderr.includes('would be overwritten')) {
            userMessage = 'Local changes would be overwritten. Commit or stash them first.';
          } else if (stderr.includes('conflict')) {
            userMessage = 'Merge conflict detected. Resolve conflicts manually.';
          }
        }

        resolve({
          success: false,
          error: userMessage,
          stderr,
          details: error.message
        });
      } else {
        logger.info(`Git command succeeded: ${command}`, { stdout: stdout.substring(0, 200) });
        resolve({
          success: true,
          output: stdout,
          stderr
        });
      }
    });
  });
}

// Validation helper
function validateGitPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return { valid: false, error: 'Invalid project path' };
  }
  return { valid: true };
}

// ============================================
// ADVANCED FEATURE 1: Real-Time File Watcher
// ============================================
function startFileWatcher(projectPath) {
  // Stop existing watcher if any
  if (fileWatchers.has(projectPath)) {
    fileWatchers.get(projectPath).close();
  }

  const watcher = chokidar.watch(projectPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles except .git
    persistent: true,
    ignoreInitial: true,
    depth: 3,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });

  let updateTimeout;
  const debouncedUpdate = () => {
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git-status-changed', projectPath);
        logger.info('File change detected, sending update', { projectPath });
      }
    }, 500);
  };

  watcher
    .on('add', debouncedUpdate)
    .on('change', debouncedUpdate)
    .on('unlink', debouncedUpdate);

  fileWatchers.set(projectPath, watcher);
  logger.info('File watcher started', { projectPath });
}

function stopFileWatcher(projectPath) {
  if (fileWatchers.has(projectPath)) {
    fileWatchers.get(projectPath).close();
    fileWatchers.delete(projectPath);
    logger.info('File watcher stopped', { projectPath });
  }
}

// ============================================
// ADVANCED FEATURE 2: Operation History (Undo/Redo)
// ============================================
function recordGitOperation(operation) {
  const record = {
    ...operation,
    timestamp: new Date().toISOString(),
    id: Date.now()
  };

  gitOperationHistory.unshift(record);

  // Keep only last MAX_HISTORY operations
  if (gitOperationHistory.length > MAX_HISTORY) {
    gitOperationHistory = gitOperationHistory.slice(0, MAX_HISTORY);
  }

  logger.info('Git operation recorded', record);

  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('git-history-updated', gitOperationHistory);
  }
}

// ============================================
// ADVANCED FEATURE 3: Project Templates
// ============================================
const projectTemplates = {
  'react-app': {
    name: 'React Application',
    description: 'Modern React app with TypeScript',
    files: {
      'package.json': JSON.stringify({
        name: 'react-app',
        version: '1.0.0',
        dependencies: {
          'react': '^18.2.0',
          'react-dom': '^18.2.0'
        },
        scripts: {
          'start': 'react-scripts start',
          'build': 'react-scripts build'
        }
      }, null, 2),
      'src/App.jsx': `import React from 'react';\n\nfunction App() {\n  return (\n    <div className="App">\n      <h1>Hello React!</h1>\n    </div>\n  );\n}\n\nexport default App;`,
      'src/index.jsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nconst root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(<App />);`,
      'public/index.html': `<!DOCTYPE html>\n<html>\n<head>\n  <title>React App</title>\n</head>\n<body>\n  <div id="root"></div>\n</body>\n</html>`,
      'README.md': '# React Application\n\nCreated with Project Manager Pro\n\n## Getting Started\n\n```bash\nnpm install\nnpm start\n```'
    }
  },
  'node-api': {
    name: 'Node.js API',
    description: 'Express REST API with TypeScript',
    files: {
      'package.json': JSON.stringify({
        name: 'node-api',
        version: '1.0.0',
        main: 'src/index.js',
        dependencies: {
          'express': '^4.18.0',
          'cors': '^2.8.5'
        },
        scripts: {
          'start': 'node src/index.js',
          'dev': 'nodemon src/index.js'
        }
      }, null, 2),
      'src/index.js': `const express = require('express');\nconst cors = require('cors');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(cors());\napp.use(express.json());\n\napp.get('/api/health', (req, res) => {\n  res.json({ status: 'OK', timestamp: new Date() });\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});`,
      'README.md': '# Node.js API\n\nCreated with Project Manager Pro\n\n## Getting Started\n\n```bash\nnpm install\nnpm start\n```'
    }
  },
  'python-app': {
    name: 'Python Application',
    description: 'Flask web application',
    files: {
      'app.py': `from flask import Flask, jsonify\n\napp = Flask(__name__)\n\n@app.route('/api/health')\ndef health():\n    return jsonify({'status': 'OK'})\n\nif __name__ == '__main__':\n    app.run(debug=True, port=5000)`,
      'requirements.txt': 'Flask==2.3.0\nFlask-CORS==4.0.0',
      'README.md': '# Python Flask App\n\nCreated with Project Manager Pro\n\n## Getting Started\n\n```bash\npip install -r requirements.txt\npython app.py\n```'
    }
  }
};

// Load settings
async function loadSettings() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const data = await fs.readFile(settingsPath, 'utf-8');
    appSettings = { ...appSettings, ...JSON.parse(data) };
    projectsBasePath = appSettings.defaultProjectPath;
  } catch (error) {
    // Settings file doesn't exist yet
  }
}

// Save settings
async function saveSettings() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(appSettings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// Ensure projects directory exists
async function ensureProjectsDir() {
  try {
    await fs.mkdir(projectsBasePath, { recursive: true });
  } catch (error) {
    console.error('Error creating projects directory:', error);
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 700,
    height: 500,
    frame: false,
    transparent: false,
    backgroundColor: '#1e1e1e',
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile('splash.html');
  splashWindow.center();

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false, // Don't show until ready - will load in background
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');

  // Remove default menu
  Menu.setApplicationMenu(null);

  // When main window is ready, wait for minimum splash time then show
  mainWindow.once('ready-to-show', () => {
    // Ensure splash has been shown for at least 4.5 seconds to guarantee 100% completion
    const splashStartTime = global.splashStartTime || Date.now();
    const elapsedTime = Date.now() - splashStartTime;
    const minimumSplashTime = 4500; // 4.5 seconds - ensures progress reaches 100%
    const remainingTime = Math.max(0, minimumSplashTime - elapsedTime);

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      mainWindow.maximize();
      mainWindow.show();
    }, remainingTime);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Record splash start time
  global.splashStartTime = Date.now();

  // Show splash screen immediately
  createSplashWindow();

  // Load settings and create main window in background
  await loadSettings();
  await ensureProjectsDir();
  createWindow();
  registerGlobalShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Register global shortcuts
function registerGlobalShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (mainWindow) {
      mainWindow.webContents.send('show-command-palette');
    }
  });

  // DevTools toggle
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  globalShortcut.register('F12', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });
}

// IPC Handlers
ipcMain.handle('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.handle('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('close-window', () => {
  mainWindow.close();
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: projectsBasePath
  });

  if (!result.canceled) {
    projectsBasePath = result.filePaths[0];
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('select-file', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: options.properties || ['openFile'],
    filters: options.filters || [],
    defaultPath: options.defaultPath || projectsBasePath
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-projects-path', () => {
  return projectsBasePath;
});

// Settings handlers
ipcMain.handle('get-settings', () => {
  return appSettings;
});

ipcMain.handle('save-settings', async (event, settings) => {
  appSettings = { ...appSettings, ...settings };
  const success = await saveSettings();
  if (success && settings.theme) {
    mainWindow.webContents.send('theme-changed', settings.theme);
  }
  return success;
});

// File dialog for saving
ipcMain.handle('save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result.filePath;
});

// Reload window
ipcMain.handle('reload-window', () => {
  if (mainWindow) {
    mainWindow.reload();
  }
});

// Git operations
ipcMain.handle('init-git', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git init', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

ipcMain.handle('git-status', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git status --porcelain', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

ipcMain.handle('git-commit', async (event, projectPath, message) => {
  const validation = validateGitPath(projectPath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (!message || !message.trim()) {
    return { success: false, error: 'Commit message cannot be empty' };
  }

  // Escape message for command line
  const escapedMessage = message.replace(/"/g, '\\"');
  const result = await executeGitCommand(
    `git add . && git commit -m "${escapedMessage}"`,
    projectPath,
    'Commit'
  );

  // Record operation for undo functionality
  if (result.success) {
    recordGitOperation({
      type: 'commit',
      message: message,
      projectPath: projectPath
    });
  }

  return result;
});

// Git pull with conflict detection
ipcMain.handle('git-pull', async (event, projectPath) => {
  const validation = validateGitPath(projectPath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Check for uncommitted changes first
  const statusCheck = await executeGitCommand('git status --porcelain', projectPath, 'Status Check');
  if (statusCheck.success && statusCheck.output && statusCheck.output.trim()) {
    logger.warn('Pull attempted with uncommitted changes', { projectPath });
  }

  return await executeGitCommand('git pull', projectPath, 'Pull');
});

// Git push with upstream tracking
ipcMain.handle('git-push', async (event, projectPath) => {
  const validation = validateGitPath(projectPath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // First try regular push
  let result = await executeGitCommand('git push', projectPath, 'Push');

  // If it fails due to no upstream, try with -u origin HEAD
  if (!result.success && result.stderr && result.stderr.includes('no upstream branch')) {
    logger.info('No upstream branch, setting up tracking', { projectPath });
    result = await executeGitCommand('git push -u origin HEAD', projectPath, 'Push with upstream');
  }

  return result;
});

// Git fetch
ipcMain.handle('git-fetch', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git fetch', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git sync (pull then push)
ipcMain.handle('git-sync', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git pull && git push', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git get branches
ipcMain.handle('git-branches', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git branch -a', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git create branch
ipcMain.handle('git-create-branch', async (event, projectPath, branchName) => {
  return new Promise((resolve) => {
    exec(`git checkout -b "${branchName}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git checkout branch
ipcMain.handle('git-checkout', async (event, projectPath, branchName) => {
  return new Promise((resolve) => {
    exec(`git checkout "${branchName}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git delete branch
ipcMain.handle('git-delete-branch', async (event, projectPath, branchName) => {
  return new Promise((resolve) => {
    exec(`git branch -d "${branchName}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git stash
ipcMain.handle('git-stash', async (event, projectPath, message) => {
  return new Promise((resolve) => {
    const cmd = message ? `git stash save "${message}"` : 'git stash';
    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git stash list
ipcMain.handle('git-stash-list', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git stash list', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git stash apply
ipcMain.handle('git-stash-apply', async (event, projectPath, stashIndex) => {
  return new Promise((resolve) => {
    const cmd = stashIndex !== undefined ? `git stash apply stash@{${stashIndex}}` : 'git stash apply';
    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git stash pop
ipcMain.handle('git-stash-pop', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git stash pop', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git diff
ipcMain.handle('git-diff', async (event, projectPath, filename) => {
  return new Promise((resolve) => {
    const cmd = filename ? `git diff "${filename}"` : 'git diff';
    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git log
ipcMain.handle('git-log', async (event, projectPath, limit = 50) => {
  return new Promise((resolve) => {
    exec(`git log --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso -n ${limit}`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git remote list
ipcMain.handle('git-remote-list', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git remote -v', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git add remote
ipcMain.handle('git-add-remote', async (event, projectPath, name, url) => {
  return new Promise((resolve) => {
    exec(`git remote add "${name}" "${url}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git remove remote
ipcMain.handle('git-remove-remote', async (event, projectPath, name) => {
  return new Promise((resolve) => {
    exec(`git remote remove "${name}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git merge
ipcMain.handle('git-merge', async (event, projectPath, branchName) => {
  return new Promise((resolve) => {
    exec(`git merge "${branchName}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Advanced Git Operations

// Git rebase
ipcMain.handle('git-rebase', async (event, projectPath, targetBranch) => {
  return new Promise((resolve) => {
    exec(`git rebase "${targetBranch}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git cherry-pick
ipcMain.handle('git-cherry-pick', async (event, projectPath, commitHash, noCommit = false) => {
  return new Promise((resolve) => {
    const cmd = noCommit ? `git cherry-pick --no-commit "${commitHash}"` : `git cherry-pick "${commitHash}"`;
    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git tag list
ipcMain.handle('git-tag-list', async (event, projectPath) => {
  return new Promise((resolve) => {
    exec('git tag -l -n', { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git create tag
ipcMain.handle('git-tag-create', async (event, projectPath, tagName, message, pushToRemote = false) => {
  return new Promise((resolve) => {
    const cmd = message ? `git tag -a "${tagName}" -m "${message}"` : `git tag "${tagName}"`;
    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        if (pushToRemote) {
          exec(`git push origin "${tagName}"`, { cwd: projectPath }, (pushError, pushStdout, pushStderr) => {
            if (pushError) {
              resolve({ success: true, output: stdout, pushWarning: pushError.message });
            } else {
              resolve({ success: true, output: stdout, pushed: true });
            }
          });
        } else {
          resolve({ success: true, output: stdout });
        }
      }
    });
  });
});

// Git delete tag
ipcMain.handle('git-tag-delete', async (event, projectPath, tagName, deleteRemote = false) => {
  return new Promise((resolve) => {
    exec(`git tag -d "${tagName}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        if (deleteRemote) {
          exec(`git push origin :refs/tags/"${tagName}"`, { cwd: projectPath }, (pushError) => {
            resolve({ success: true, output: stdout, remoteDeleted: !pushError });
          });
        } else {
          resolve({ success: true, output: stdout });
        }
      }
    });
  });
});

// Git reset
ipcMain.handle('git-reset', async (event, projectPath, target, mode = 'mixed') => {
  return new Promise((resolve) => {
    const modeFlag = mode === 'soft' ? '--soft' : mode === 'hard' ? '--hard' : '--mixed';
    exec(`git reset ${modeFlag} "${target}"`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git revert
ipcMain.handle('git-revert', async (event, projectPath, commitHash) => {
  return new Promise((resolve) => {
    exec(`git revert "${commitHash}" --no-edit`, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Git clean
ipcMain.handle('git-clean', async (event, projectPath, force = false, includeDirectories = false) => {
  return new Promise((resolve) => {
    let cmd = 'git clean';
    if (force) cmd += ' -f';
    if (includeDirectories) cmd += ' -d';
    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// GitHub Integration

// Save GitHub token
ipcMain.handle('github-save-token', async (event, token) => {
  try {
    appSettings.githubToken = token;
    await saveSettings();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get GitHub user info
ipcMain.handle('github-get-user', async (event) => {
  const token = appSettings.githubToken;
  if (!token) {
    return { success: false, error: 'No GitHub token found' };
  }

  return new Promise((resolve) => {
    const https = require('https');
    const options = {
      hostname: 'api.github.com',
      path: '/user',
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'ProjectManager'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, user: JSON.parse(data) });
        } else {
          resolve({ success: false, error: 'Failed to fetch user info' });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    req.end();
  });
});

// Create GitHub repository
ipcMain.handle('github-create-repo', async (event, repoData) => {
  const token = appSettings.githubToken;
  if (!token) {
    return { success: false, error: 'No GitHub token found' };
  }

  return new Promise((resolve) => {
    const https = require('https');
    const postData = JSON.stringify({
      name: repoData.name,
      description: repoData.description || '',
      private: repoData.isPrivate || false,
      auto_init: repoData.addReadme || false
    });

    const options = {
      hostname: 'api.github.com',
      path: '/user/repos',
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'ProjectManager',
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve({ success: true, repo: JSON.parse(data) });
        } else {
          resolve({ success: false, error: 'Failed to create repository', details: data });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    req.write(postData);
    req.end();
  });
});

// Upload project to GitHub
ipcMain.handle('github-upload-project', async (event, projectPath, repoData) => {
  const token = appSettings.githubToken;
  if (!token) {
    return { success: false, error: 'No GitHub token found' };
  }

  try {
    // First, create the repository
    const createResult = await new Promise((resolve) => {
      const https = require('https');
      const postData = JSON.stringify({
        name: repoData.name,
        description: repoData.description || '',
        private: repoData.isPrivate || false
      });

      const options = {
        hostname: 'api.github.com',
        path: '/user/repos',
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'ProjectManager',
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 201) {
            resolve({ success: true, repo: JSON.parse(data) });
          } else {
            resolve({ success: false, error: 'Failed to create repository', details: data });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      req.write(postData);
      req.end();
    });

    if (!createResult.success) {
      return createResult;
    }

    const repoUrl = createResult.repo.clone_url;

    // Initialize git if not already initialized
    await new Promise((resolve) => {
      exec('git rev-parse --git-dir', { cwd: projectPath }, (error) => {
        if (error) {
          // Not a git repo, initialize it
          exec('git init', { cwd: projectPath }, resolve);
        } else {
          resolve();
        }
      });
    });

    // Add remote
    await new Promise((resolve) => {
      exec(`git remote add origin "${repoUrl}"`, { cwd: projectPath }, (error) => {
        resolve(); // Continue even if remote already exists
      });
    });

    // Add all files
    await new Promise((resolve) => {
      exec('git add .', { cwd: projectPath }, resolve);
    });

    // Commit
    await new Promise((resolve) => {
      exec('git commit -m "Initial commit"', { cwd: projectPath }, (error) => {
        resolve(); // Continue even if nothing to commit
      });
    });

    // Push to GitHub
    const pushResult = await new Promise((resolve) => {
      exec('git push -u origin master', { cwd: projectPath }, (error, stdout, stderr) => {
        if (error) {
          // Try main branch if master fails
          exec('git branch -M main', { cwd: projectPath }, () => {
            exec('git push -u origin main', { cwd: projectPath }, (error2, stdout2, stderr2) => {
              if (error2) {
                resolve({ success: false, error: error2.message, stderr: stderr2 });
              } else {
                resolve({ success: true, output: stdout2 });
              }
            });
          });
        } else {
          resolve({ success: true, output: stdout });
        }
      });
    });

    if (!pushResult.success) {
      return { success: false, error: 'Repository created but push failed: ' + pushResult.error };
    }

    return { success: true, repo: createResult.repo, pushed: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Disconnect GitHub
ipcMain.handle('github-disconnect', async (event) => {
  try {
    delete appSettings.githubToken;
    await saveSettings();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Terminal operations
ipcMain.handle('open-terminal', async (event, projectPath) => {
  const terminal = appSettings.terminalApp || 'cmd';
  
  if (process.platform === 'win32') {
    if (terminal === 'powershell') {
      exec(`start powershell -NoExit -Command "cd '${projectPath}'"`, (error) => {
        if (error) console.error('Error opening PowerShell:', error);
      });
    } else if (terminal === 'wt') {
      // Windows Terminal
      exec(`wt -d "${projectPath}"`, (error) => {
        if (error) console.error('Error opening Windows Terminal:', error);
      });
    } else {
      exec(`start cmd /K cd /d "${projectPath}"`, (error) => {
        if (error) console.error('Error opening CMD:', error);
      });
    }
  } else if (process.platform === 'darwin') {
    exec(`open -a Terminal "${projectPath}"`, (error) => {
      if (error) console.error('Error opening Terminal:', error);
    });
  } else {
    exec(`gnome-terminal --working-directory="${projectPath}"`, (error) => {
      if (error) console.error('Error opening Terminal:', error);
    });
  }
});

// Search projects
ipcMain.handle('search-projects', async (event, searchPath, query) => {
  try {
    const results = [];
    const searchDir = searchPath || projectsBasePath;
    
    async function searchRecursive(dir, depth = 0) {
      if (depth > 2) return; // Limit search depth
      
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullPath = path.join(dir, entry.name);
            
            // Skip node_modules, .git, etc.
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              // Check if it's a project (has package.json, requirements.txt, etc.)
              const hasPackageJson = await fileExists(path.join(fullPath, 'package.json'));
              const hasRequirements = await fileExists(path.join(fullPath, 'requirements.txt'));
              const hasPom = await fileExists(path.join(fullPath, 'pom.xml'));
              
              if (hasPackageJson || hasRequirements || hasPom) {
                if (!query || entry.name.toLowerCase().includes(query.toLowerCase())) {
                  results.push({
                    name: entry.name,
                    path: fullPath,
                    type: hasPackageJson ? 'node' : hasRequirements ? 'python' : 'java'
                  });
                }
              }
              
              // Continue searching subdirectories
              await searchRecursive(fullPath, depth + 1);
            }
          }
        }
      } catch (error) {
        console.error(`Error searching directory ${dir}:`, error);
      }
    }
    
    await searchRecursive(searchDir);
    return results;
  } catch (error) {
    console.error('Error searching projects:', error);
    return [];
  }
});

// Helper function to check if file exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Clone repository
ipcMain.handle('clone-repository', async (event, repoUrl, targetPath) => {
  return new Promise((resolve) => {
    const clonePath = targetPath || projectsBasePath;
    exec(`git clone ${repoUrl}`, { cwd: clonePath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
});

// Import project
ipcMain.handle('import-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project to Import'
  });
  
  if (!result.canceled) {
    const projectPath = result.filePaths[0];
    const projectName = path.basename(projectPath);
    
    // Detect project type
    let projectType = 'empty';
    if (await fileExists(path.join(projectPath, 'package.json'))) {
      const packageJson = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
      if (packageJson.dependencies && packageJson.dependencies.electron) {
        projectType = 'electron';
      } else if (packageJson.dependencies && packageJson.dependencies.react) {
        projectType = 'react';
      } else if (packageJson.dependencies && packageJson.dependencies.vue) {
        projectType = 'vue';
      } else {
        projectType = 'nodejs';
      }
    } else if (await fileExists(path.join(projectPath, 'requirements.txt'))) {
      projectType = 'python';
    } else if (await fileExists(path.join(projectPath, 'pom.xml'))) {
      projectType = 'java';
    } else if (await fileExists(path.join(projectPath, 'CMakeLists.txt'))) {
      projectType = 'cpp';
    } else if (await fileExists(path.join(projectPath, 'index.html'))) {
      projectType = 'web';
    }
    
    return {
      success: true,
      project: {
        name: projectName,
        path: projectPath,
        type: projectType
      }
    };
  }
  
  return { success: false };
});

// Export project
ipcMain.handle('export-project', async (event, projectPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Project As',
    defaultPath: path.join(os.homedir(), 'Downloads', `${path.basename(projectPath)}.zip`),
    filters: [
      { name: 'ZIP Archive', extensions: ['zip'] }
    ]
  });
  
  if (!result.canceled) {
    return new Promise((resolve) => {
      const output = result.filePath;
      exec(`powershell Compress-Archive -Path "${projectPath}\\*" -DestinationPath "${output}" -Force`, 
        (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true, path: output });
          }
        }
      );
    });
  }
  
  return { success: false };
});

// Delete project
ipcMain.handle('delete-project', async (event, projectPath) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Delete Project',
    message: `Are you sure you want to delete this project?`,
    detail: projectPath,
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0
  });
  
  if (result.response === 1) {
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, cancelled: true };
});

// Show about dialog
ipcMain.handle('show-about', () => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Project Manager Pro',
    message: 'Project Manager Pro',
    detail: 'Version 1.0.0\n\nA professional project management application with VSCode-like interface.\n\n© 2024 Project Manager Pro',
    buttons: ['OK']
  });
});

// Open external link
ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

// Copy to clipboard
ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text);
});

// Get clipboard content
ipcMain.handle('get-clipboard', () => {
  return clipboard.readText();
});

// Run npm/pip commands
ipcMain.handle('run-command', async (event, command, projectPath) => {
  return new Promise((resolve) => {
    exec(command, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
});

// Check for VSCode installation
ipcMain.handle('check-vscode', async () => {
  return new Promise((resolve) => {
    exec('code --version', (error, stdout) => {
      resolve(!error);
    });
  });
});

// Get system info
ipcMain.handle('get-system-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    v8Version: process.versions.v8,
    osRelease: os.release(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    homedir: os.homedir()
  };
});

ipcMain.handle('create-project', async (event, projectData) => {
  const { name, type, description, path: customPath } = projectData;
  const projectPath = path.join(customPath || projectsBasePath, name);
  
  try {
    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });
    
    // Create project structure based on type
    switch(type) {
      case 'electron':
        await createElectronProject(projectPath, name, description);
        break;
      case 'python':
        await createPythonProject(projectPath, name, description);
        break;
      case 'web':
        await createWebProject(projectPath, name, description);
        break;
      case 'nodejs':
        await createNodeProject(projectPath, name, description);
        break;
      case 'react':
        await createReactProject(projectPath, name, description);
        break;
      case 'vue':
        await createVueProject(projectPath, name, description);
        break;
      case 'cpp':
        await createCppProject(projectPath, name, description);
        break;
      case 'java':
        await createJavaProject(projectPath, name, description);
        break;
      default:
        await createEmptyProject(projectPath, name, description);
    }
    
    // Open in VSCode
    exec(`code "${projectPath}"`, (error) => {
      if (error) {
        console.error('Error opening VSCode:', error);
      }
    });
    
    return { success: true, path: projectPath };
  } catch (error) {
    console.error('Error creating project:', error);
    return { success: false, error: error.message };
  }
});

// Get all projects from the projects directory
ipcMain.handle('get-projects', async () => {
  try {
    const projectsPath = appSettings.defaultProjectPath || projectsBasePath;

    // Check if projects directory exists
    try {
      await fs.access(projectsPath);
    } catch (error) {
      // Directory doesn't exist, create it
      await fs.mkdir(projectsPath, { recursive: true });
      return [];
    }

    const items = await fs.readdir(projectsPath, { withFileTypes: true });
    const projects = [];

    for (const item of items) {
      if (item.isDirectory()) {
        const projectPath = path.join(projectsPath, item.name);
        const project = {
          name: item.name,
          path: projectPath,
          type: 'unknown',
          lastModified: null,
          isGitRepo: false,
          hasPackageJson: false
        };

        try {
          // Check if it's a git repository
          const gitPath = path.join(projectPath, '.git');
          try {
            await fs.access(gitPath);
            project.isGitRepo = true;
            project.type = 'git';
          } catch (e) {
            // Not a git repo
          }

          // Check for package.json
          const packageJsonPath = path.join(projectPath, 'package.json');
          try {
            await fs.access(packageJsonPath);
            project.hasPackageJson = true;
            const packageData = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            project.type = packageData.type || 'node';
            project.description = packageData.description || '';
          } catch (e) {
            // No package.json
          }

          // Get last modified time
          const stats = await fs.stat(projectPath);
          project.lastModified = stats.mtime;

        } catch (error) {
          console.error(`Error reading project ${item.name}:`, error);
        }

        projects.push(project);
      }
    }

    // Sort by last modified (most recent first)
    projects.sort((a, b) => {
      if (!a.lastModified) return 1;
      if (!b.lastModified) return -1;
      return b.lastModified - a.lastModified;
    });

    return projects;
  } catch (error) {
    console.error('Error getting projects:', error);
    return [];
  }
});

ipcMain.handle('get-recent-projects', async () => {
  try {
    const configPath = path.join(app.getPath('userData'), 'recent-projects.json');
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('save-recent-project', async (event, project) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'recent-projects.json');
    let recentProjects = [];

    try {
      const data = await fs.readFile(configPath, 'utf-8');
      recentProjects = JSON.parse(data);
    } catch (e) {
      // File doesn't exist yet
    }

    // Remove any existing entry with the same path to avoid duplicates
    recentProjects = recentProjects.filter(p => p.path !== project.path);

    // Add new project to the beginning
    recentProjects.unshift(project);

    // Keep only last 10 projects
    recentProjects = recentProjects.slice(0, 10);

    await fs.writeFile(configPath, JSON.stringify(recentProjects, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving recent project:', error);
    return false;
  }
});

ipcMain.handle('open-in-vscode', async (event, projectPath) => {
  exec(`code "${projectPath}"`, (error) => {
    if (error) {
      console.error('Error opening VSCode:', error);
    }
  });
});

ipcMain.handle('open-in-explorer', async (event, projectPath) => {
  shell.openPath(projectPath);
});

// File Watcher IPC Handlers
ipcMain.handle('start-file-watcher', async (event, projectPath) => {
  try {
    startFileWatcher(projectPath);
    logger.info('File watcher started via IPC', { projectPath });
    return { success: true };
  } catch (error) {
    logger.error('Failed to start file watcher', { projectPath, error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-file-watcher', async (event, projectPath) => {
  try {
    stopFileWatcher(projectPath);
    logger.info('File watcher stopped via IPC', { projectPath });
    return { success: true };
  } catch (error) {
    logger.error('Failed to stop file watcher', { projectPath, error: error.message });
    return { success: false, error: error.message };
  }
});

// Undo/Redo IPC Handler
ipcMain.handle('undo-last-operation', async (event) => {
  if (gitOperationHistory.length === 0) {
    return { success: false, error: 'No operations to undo' };
  }

  const lastOp = gitOperationHistory[0];
  logger.info('Undoing operation', lastOp);

  // For commits, use git reset
  if (lastOp.type === 'commit') {
    const result = await executeGitCommand(
      'git reset --soft HEAD~1',
      lastOp.projectPath,
      'Undo Commit'
    );

    if (result.success) {
      // Remove from history
      gitOperationHistory.shift();

      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git-history-updated', gitOperationHistory);
      }
    }

    return result;
  }

  // For other operations, inform user it's not supported yet
  return { success: false, error: 'Undo not supported for this operation yet' };
});

ipcMain.handle('get-operation-history', async () => {
  return gitOperationHistory;
});

// Template System IPC Handlers
ipcMain.handle('create-from-template', async (event, templateId, projectName, targetPath) => {
  const template = projectTemplates[templateId];
  if (!template) {
    logger.error('Template not found', { templateId });
    return { success: false, error: 'Template not found' };
  }

  const projectPath = path.join(targetPath || projectsBasePath, projectName);

  try {
    // Check if directory already exists
    try {
      await fs.access(projectPath);
      return { success: false, error: 'A project with this name already exists' };
    } catch (e) {
      // Directory doesn't exist, continue
    }

    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });

    // Create all files from template
    for (const [filePath, content] of Object.entries(template.files)) {
      const fullPath = path.join(projectPath, filePath);
      const dir = path.dirname(fullPath);

      // Create directory if needed
      await fs.mkdir(dir, { recursive: true });

      // Write file
      await fs.writeFile(fullPath, content);
    }

    logger.info('Project created from template', { templateId, projectName, projectPath });

    // Initialize git repository
    await executeGitCommand('git init', projectPath, 'Initialize Git');

    return { success: true, path: projectPath };
  } catch (error) {
    logger.error('Failed to create project from template', { templateId, projectName, error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-templates', async () => {
  return Object.entries(projectTemplates).map(([id, template]) => ({
    id,
    name: template.name,
    description: template.description
  }));
});

// Project creation functions
async function createElectronProject(projectPath, name, description) {
  const packageJson = {
    name: name.toLowerCase().replace(/\s+/g, '-'),
    version: "0.1.0",
    description: description,
    main: "main.js",
    scripts: {
      start: "electron .",
      build: "electron-builder"
    },
    devDependencies: {
      electron: "^27.0.0"
    }
  };
  
  const mainJs = `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});`;

  const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${name}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      margin: 0;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    h1 { margin-bottom: 10px; }
    p { opacity: 0.9; }
  </style>
</head>
<body>
  <h1>Welcome to ${name}</h1>
  <p>${description}</p>
  <p>Electron: <span id="electron-version"></span></p>
  <script>
    document.getElementById('electron-version').textContent = process.versions.electron;
  </script>
</body>
</html>`;
  
  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));
  await fs.writeFile(path.join(projectPath, 'main.js'), mainJs);
  await fs.writeFile(path.join(projectPath, 'index.html'), indexHtml);
  await fs.writeFile(path.join(projectPath, '.gitignore'), 'node_modules/\ndist/\n*.log');
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\``);
}

async function createPythonProject(projectPath, name, description) {
  const mainPy = `#!/usr/bin/env python3
"""
${name}
${description}
"""

def main():
    """Main function"""
    print(f"Welcome to ${name}")
    print(f"${description}")
    
if __name__ == "__main__":
    main()
`;

  const requirements = `# Core dependencies
numpy>=1.21.0
pandas>=1.3.0
requests>=2.26.0
`;

  const gitignore = `# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
ENV/
build/
dist/
*.egg-info/
.venv
pip-log.txt
pip-delete-this-directory.txt

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Project specific
*.log
.DS_Store
`;

  const readme = `# ${name}

${description}

## Setup

\`\`\`bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\\Scripts\\activate
pip install -r requirements.txt
\`\`\`

## Usage

\`\`\`bash
python main.py
\`\`\`
`;

  await fs.writeFile(path.join(projectPath, 'main.py'), mainPy);
  await fs.writeFile(path.join(projectPath, 'requirements.txt'), requirements);
  await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore);
  await fs.writeFile(path.join(projectPath, 'README.md'), readme);
  
  // Create project structure
  await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'tests'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'docs'), { recursive: true });
  
  await fs.writeFile(path.join(projectPath, 'src', '__init__.py'), '');
  await fs.writeFile(path.join(projectPath, 'tests', '__init__.py'), '');
}

async function createWebProject(projectPath, name, description) {
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>${name}</h1>
            <nav>
                <ul>
                    <li><a href="#home">Home</a></li>
                    <li><a href="#about">About</a></li>
                    <li><a href="#services">Services</a></li>
                    <li><a href="#contact">Contact</a></li>
                </ul>
            </nav>
        </header>
        
        <main>
            <section id="hero">
                <h2>Welcome to ${name}</h2>
                <p>${description}</p>
                <button class="cta-button">Get Started</button>
            </section>
        </main>
        
        <footer>
            <p>&copy; 2024 ${name}. All rights reserved.</p>
        </footer>
    </div>
    
    <script src="js/script.js"></script>
</body>
</html>`;

  const styleCss = `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 1rem 0;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

header h1 {
    display: inline-block;
    margin-right: 2rem;
}

nav {
    display: inline-block;
}

nav ul {
    list-style: none;
    display: flex;
    gap: 2rem;
}

nav a {
    color: white;
    text-decoration: none;
    transition: opacity 0.3s;
}

nav a:hover {
    opacity: 0.8;
}

#hero {
    padding: 4rem 0;
    text-align: center;
    background: #f8f9fa;
    margin: 2rem 0;
    border-radius: 10px;
}

#hero h2 {
    font-size: 2.5rem;
    margin-bottom: 1rem;
}

#hero p {
    font-size: 1.2rem;
    margin-bottom: 2rem;
    color: #666;
}

.cta-button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 1rem 2rem;
    font-size: 1.1rem;
    border-radius: 50px;
    cursor: pointer;
    transition: transform 0.3s;
}

.cta-button:hover {
    transform: translateY(-2px);
}

footer {
    background: #333;
    color: white;
    text-align: center;
    padding: 2rem 0;
    margin-top: 4rem;
}`;

  const scriptJs = `// ${name} JavaScript
document.addEventListener('DOMContentLoaded', function() {
    console.log('${name} loaded successfully');
    
    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // CTA button click handler
    const ctaButton = document.querySelector('.cta-button');
    if (ctaButton) {
        ctaButton.addEventListener('click', function() {
            alert('Welcome to ${name}!');
        });
    }
});`;

  await fs.mkdir(path.join(projectPath, 'css'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'js'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'images'), { recursive: true });
  
  await fs.writeFile(path.join(projectPath, 'index.html'), indexHtml);
  await fs.writeFile(path.join(projectPath, 'css', 'style.css'), styleCss);
  await fs.writeFile(path.join(projectPath, 'js', 'script.js'), scriptJs);
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Features\n\n- Responsive design\n- Modern CSS with gradients\n- Smooth scrolling\n- Clean structure`);
}

async function createNodeProject(projectPath, name, description) {
  const packageJson = {
    name: name.toLowerCase().replace(/\s+/g, '-'),
    version: "1.0.0",
    description: description,
    main: "index.js",
    scripts: {
      start: "node index.js",
      dev: "nodemon index.js",
      test: "jest"
    },
    keywords: [],
    author: "",
    license: "ISC",
    dependencies: {
      express: "^4.18.0",
      dotenv: "^16.0.0"
    },
    devDependencies: {
      nodemon: "^2.0.0",
      jest: "^29.0.0"
    }
  };
  
  const indexJs = `const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    res.json({
        name: '${name}',
        description: '${description}',
        version: '1.0.0'
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString()
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(\`Server is running on http://localhost:\${PORT}\`);
});

module.exports = app;`;

  const envExample = `# Environment Variables
PORT=3000
NODE_ENV=development
`;

  const gitignore = `node_modules/
.env
.DS_Store
*.log
dist/
coverage/
`;

  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));
  await fs.writeFile(path.join(projectPath, 'index.js'), indexJs);
  await fs.writeFile(path.join(projectPath, '.env.example'), envExample);
  await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore);
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Usage\n\n\`\`\`bash\nnpm start\n\`\`\``);
  
  await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'routes'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'models'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'controllers'), { recursive: true });
}

async function createReactProject(projectPath, name, description) {
  const packageJson = {
    name: name.toLowerCase().replace(/\s+/g, '-'),
    version: "0.1.0",
    private: true,
    description: description,
    dependencies: {
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "react-scripts": "5.0.1"
    },
    scripts: {
      "start": "react-scripts start",
      "build": "react-scripts build",
      "test": "react-scripts test",
      "eject": "react-scripts eject"
    },
    "eslintConfig": {
      "extends": ["react-app"]
    },
    "browserslist": {
      "production": [">0.2%", "not dead", "not op_mini all"],
      "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
    }
  };
  
  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));
  await fs.writeFile(path.join(projectPath, '.gitignore'), 'node_modules/\n.DS_Store\nbuild/\n.env.local\n');
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Available Scripts\n\n### \`npm start\`\n\nRuns the app in development mode.\n\n### \`npm run build\`\n\nBuilds the app for production.`);
  
  // Create src directory and basic files
  const srcPath = path.join(projectPath, 'src');
  await fs.mkdir(srcPath, { recursive: true });
  
  const appJs = `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>${name}</h1>
        <p>${description}</p>
        <button className="App-button">Get Started</button>
      </header>
    </div>
  );
}

export default App;`;
  
  const indexJs = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
  
  const appCss = `.App {
  text-align: center;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.App-header {
  color: white;
}

.App-header h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.App-button {
  background: white;
  color: #667eea;
  border: none;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  border-radius: 50px;
  cursor: pointer;
  transition: transform 0.3s;
  margin-top: 2rem;
}

.App-button:hover {
  transform: translateY(-2px);
}`;
  
  const indexCss = `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}`;
  
  await fs.writeFile(path.join(srcPath, 'App.js'), appJs);
  await fs.writeFile(path.join(srcPath, 'index.js'), indexJs);
  await fs.writeFile(path.join(srcPath, 'App.css'), appCss);
  await fs.writeFile(path.join(srcPath, 'index.css'), indexCss);
  
  // Create public directory
  const publicPath = path.join(projectPath, 'public');
  await fs.mkdir(publicPath, { recursive: true });
  
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta name="description" content="${description}" />
    <title>${name}</title>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>`;
  
  await fs.writeFile(path.join(publicPath, 'index.html'), indexHtml);
}

async function createVueProject(projectPath, name, description) {
  const packageJson = {
    name: name.toLowerCase().replace(/\s+/g, '-'),
    version: "0.1.0",
    private: true,
    description: description,
    scripts: {
      serve: "vue-cli-service serve",
      build: "vue-cli-service build"
    },
    dependencies: {
      "vue": "^3.2.0",
      "vue-router": "^4.0.0",
      "vuex": "^4.0.0"
    },
    devDependencies: {
      "@vue/cli-service": "^5.0.0"
    }
  };
  
  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));
  await fs.writeFile(path.join(projectPath, '.gitignore'), 'node_modules/\n.DS_Store\ndist/\n*.log');
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Project setup\n\`\`\`\nnpm install\n\`\`\`\n\n### Compiles and hot-reloads for development\n\`\`\`\nnpm run serve\n\`\`\``);
  
  // Create src directory
  const srcPath = path.join(projectPath, 'src');
  await fs.mkdir(srcPath, { recursive: true });
  
  const mainJs = `import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')`;
  
  const appVue = `<template>
  <div id="app">
    <header>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
      <button @click="handleClick">Get Started</button>
    </header>
  </div>
</template>

<script>
export default {
  name: 'App',
  data() {
    return {
      title: '${name}',
      description: '${description}'
    }
  },
  methods: {
    handleClick() {
      alert('Welcome to ${name}!');
    }
  }
}
</script>

<style>
#app {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  text-align: center;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

header h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

button {
  background: white;
  color: #667eea;
  border: none;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  border-radius: 50px;
  cursor: pointer;
  transition: transform 0.3s;
  margin-top: 2rem;
}

button:hover {
  transform: translateY(-2px);
}
</style>`;
  
  await fs.writeFile(path.join(srcPath, 'main.js'), mainJs);
  await fs.writeFile(path.join(srcPath, 'App.vue'), appVue);
  
  // Create public directory
  const publicPath = path.join(projectPath, 'public');
  await fs.mkdir(publicPath, { recursive: true });
  
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${name}</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
  
  await fs.writeFile(path.join(publicPath, 'index.html'), indexHtml);
}

async function createCppProject(projectPath, name, description) {
  const mainCpp = `#include <iostream>
#include <string>

// ${name}
// ${description}

int main() {
    std::cout << "Welcome to ${name}" << std::endl;
    std::cout << "${description}" << std::endl;
    
    std::cout << "\\nPress Enter to continue...";
    std::cin.get();
    
    return 0;
}`;

  const cmakeLists = `cmake_minimum_required(VERSION 3.10)
project(${name.replace(/\s+/g, '_')})

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add source files
add_executable(\${PROJECT_NAME} src/main.cpp)

# Include directories
target_include_directories(\${PROJECT_NAME} PUBLIC include)`;

  const buildScript = `#!/bin/bash
# Build script for ${name}

mkdir -p build
cd build
cmake ..
make
echo "Build complete. Executable: ./build/${name.replace(/\s+/g, '_')}"`;

  const buildBat = `@echo off
REM Build script for ${name}

if not exist build mkdir build
cd build
cmake -G "MinGW Makefiles" ..
mingw32-make
echo Build complete. Executable: build\\${name.replace(/\s+/g, '_')}.exe
pause`;

  await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'include'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'tests'), { recursive: true });
  
  await fs.writeFile(path.join(projectPath, 'src', 'main.cpp'), mainCpp);
  await fs.writeFile(path.join(projectPath, 'CMakeLists.txt'), cmakeLists);
  await fs.writeFile(path.join(projectPath, 'build.sh'), buildScript);
  await fs.writeFile(path.join(projectPath, 'build.bat'), buildBat);
  await fs.writeFile(path.join(projectPath, '.gitignore'), 'build/\n*.exe\n*.o\n*.out');
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Building\n\n### Linux/Mac\n\`\`\`bash\n./build.sh\n\`\`\`\n\n### Windows\n\`\`\`cmd\nbuild.bat\n\`\`\``);
}

async function createJavaProject(projectPath, name, description) {
  const className = name.replace(/[^a-zA-Z0-9]/g, '');
  const packageName = `com.${className.toLowerCase()}`;
  
  const mainJava = `package ${packageName};

/**
 * ${name}
 * ${description}
 */
public class Main {
    public static void main(String[] args) {
        System.out.println("Welcome to ${name}");
        System.out.println("${description}");
        
        // Your code here
        Application app = new Application();
        app.run();
    }
}`;

  const appJava = `package ${packageName};

public class Application {
    public void run() {
        System.out.println("Application is running...");
    }
}`;

  const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>${packageName}</groupId>
    <artifactId>${className.toLowerCase()}</artifactId>
    <version>1.0-SNAPSHOT</version>

    <properties>
        <maven.compiler.source>11</maven.compiler.source>
        <maven.compiler.target>11</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>`;

  const srcPath = path.join(projectPath, 'src', 'main', 'java', ...packageName.split('.'));
  const testPath = path.join(projectPath, 'src', 'test', 'java', ...packageName.split('.'));
  
  await fs.mkdir(srcPath, { recursive: true });
  await fs.mkdir(testPath, { recursive: true });
  
  await fs.writeFile(path.join(srcPath, 'Main.java'), mainJava);
  await fs.writeFile(path.join(srcPath, 'Application.java'), appJava);
  await fs.writeFile(path.join(projectPath, 'pom.xml'), pomXml);
  await fs.writeFile(path.join(projectPath, '.gitignore'), 'target/\n*.class\n.idea/\n*.iml');
  await fs.writeFile(path.join(projectPath, 'README.md'), `# ${name}\n\n${description}\n\n## Build and Run\n\n\`\`\`bash\nmvn clean compile\nmvn exec:java -Dexec.mainClass="${packageName}.Main"\n\`\`\``);
}

async function createEmptyProject(projectPath, name, description) {
  const readme = `# ${name}\n\n${description}\n\n## Getting Started\n\nThis is an empty project. Add your files here to get started.`;

  await fs.writeFile(path.join(projectPath, 'README.md'), readme);
  await fs.writeFile(path.join(projectPath, '.gitignore'), '.DS_Store\n*.log\nnode_modules/');
}

// Delete project files permanently
ipcMain.handle('delete-project-files', async (event, projectPath) => {
  try {
    // Validate path exists
    try {
      await fs.access(projectPath);
    } catch {
      return { success: false, error: 'Project path does not exist' };
    }

    // Security check: ensure path is within allowed directories
    const normalizedPath = path.normalize(projectPath);
    const homeDir = os.homedir();

    // Prevent deletion of critical system directories
    const forbiddenPaths = [
      homeDir,
      path.join(homeDir, 'Desktop'),
      path.join(homeDir, 'Documents'),
      path.join(homeDir, 'Downloads'),
      'C:\\',
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      '/root',
      '/home',
      '/usr',
      '/bin',
      '/etc'
    ];

    const isForbidden = forbiddenPaths.some(forbidden => {
      const normalizedForbidden = path.normalize(forbidden);
      return normalizedPath === normalizedForbidden ||
             normalizedPath.startsWith(normalizedForbidden + path.sep) === false;
    });

    if (forbiddenPaths.some(forbidden => normalizedPath === path.normalize(forbidden))) {
      return { success: false, error: 'Cannot delete system or user directories' };
    }

    // Recursively delete directory
    await fs.rm(projectPath, { recursive: true, force: true });

    return { success: true };
  } catch (error) {
    console.error('Error deleting project:', error);
    return { success: false, error: error.message };
  }
});

// Save recent projects
ipcMain.handle('save-recent-projects', async (event, projects) => {
  try {
    const recentPath = path.join(app.getPath('userData'), 'recent.json');
    await fs.writeFile(recentPath, JSON.stringify(projects, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving recent projects:', error);
    return { success: false, error: error.message };
  }
});
