const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// State management
let currentView = 'dashboard';
let workspacePath = '';
let recentProjects = [];
let currentProject = null;
let appSettings = {};
let searchResults = [];
let gitStatus = null;

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    initializeTitlebar();
    initializeSidebar();
    initializeModals();
    initializeQuickActions();
    initializeTemplates();
    initializeMenuItems();
    initializeSettings();
    initializeGitView();
    initializeExtensions();
    initializeCommandPalette();
    initializeKeyboardShortcuts();
    initializeAboutDialog();
    initializeProjectsView();
    initializeRecentView();
    initializeDeleteProjectModal();

    // Initialize Git modals
    createMergeModal();

    await loadSettings();
    await loadWorkspacePath();
    await loadRecentProjects();
    await checkVSCodeInstallation();

    // Load all projects and update stats for initial display
    await loadAllProjects();

    showNotification('AppManager Pro initialized', 'success');
}

// Titlebar functionality
function initializeTitlebar() {
    // Window controls
    document.getElementById('minimize-btn').addEventListener('click', () => {
        ipcRenderer.invoke('minimize-window');
    });
    
    document.getElementById('maximize-btn').addEventListener('click', () => {
        ipcRenderer.invoke('maximize-window');
    });
    
    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.invoke('close-window');
    });
    
    // Menu items
    const menuItems = document.querySelectorAll('.menu-item');
    const dropdownMenus = document.querySelectorAll('.dropdown-menu');
    let isAnyMenuOpen = false;

    // Helper function to open a specific menu
    const openMenu = (item, menu) => {
        // Close all other menus
        dropdownMenus.forEach(m => {
            if (m !== menu) {
                m.classList.remove('show');
            }
        });

        // Remove active state from all menu items
        menuItems.forEach(i => {
            if (i !== item) {
                i.classList.remove('active');
            }
        });

        // Position menu directly under the clicked item
        const itemRect = item.getBoundingClientRect();
        menu.style.left = `${itemRect.left}px`;
        menu.style.top = `${itemRect.bottom}px`;

        // Open current menu
        menu.classList.add('show');
        item.classList.add('active');
        isAnyMenuOpen = true;
    };

    // Helper function to close all menus
    const closeAllMenus = () => {
        dropdownMenus.forEach(menu => menu.classList.remove('show'));
        menuItems.forEach(item => item.classList.remove('active'));
        isAnyMenuOpen = false;
    };

    menuItems.forEach(item => {
        // Click handler
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const menuName = item.dataset.menu;
            const menu = document.getElementById(`${menuName}-menu`);

            if (menu) {
                // If this menu is already open, close it
                if (menu.classList.contains('show')) {
                    closeAllMenus();
                } else {
                    openMenu(item, menu);
                }
            }
        });

        // Hover handler - only activate if a menu is already open
        item.addEventListener('mouseenter', (e) => {
            if (isAnyMenuOpen) {
                const menuName = item.dataset.menu;
                const menu = document.getElementById(`${menuName}-menu`);

                if (menu) {
                    openMenu(item, menu);
                }
            }
        });
    });

    // Close menus when clicking outside
    document.addEventListener('click', () => {
        closeAllMenus();
    });
}

// Initialize all menu items functionality
function initializeMenuItems() {
    // File Menu
    document.getElementById('new-project-menu')?.addEventListener('click', () => {
        showModal('new-project-modal');
        showNotification('Create a new project', 'info');
    });

    document.getElementById('open-project-menu')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            showNotification('Opening project in VS Code...', 'info');
            ipcRenderer.invoke('open-in-vscode', selectedPath);
        }
    });

    document.getElementById('import-project-menu')?.addEventListener('click', async () => {
        await importProject();
    });

    // Welcome screen import button
    document.getElementById('import-project-btn')?.addEventListener('click', async () => {
        await importProject();
    });

    document.getElementById('save-workspace-menu')?.addEventListener('click', async () => {
        showNotification('Saving workspace...', 'info');
        await saveWorkspace();
        showNotification('Workspace saved successfully', 'success');
    });

    document.getElementById('export-project-menu')?.addEventListener('click', async () => {
        if (currentProject) {
            showNotification('Exporting project...', 'info');
            const result = await ipcRenderer.invoke('export-project', currentProject.path);
            if (result.success) {
                showNotification(`Project exported to ${result.path}`, 'success');
            }
        } else {
            showNotification('Please select a project first', 'error');
        }
    });

    document.getElementById('settings-menu')?.addEventListener('click', () => {
        switchView('settings');
    });

    document.getElementById('exit-menu')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to exit AppManager?')) {
            ipcRenderer.invoke('close-window');
        }
    });
    
    // Edit Menu
    document.getElementById('cut-menu').addEventListener('click', () => {
        document.execCommand('cut');
    });
    
    document.getElementById('copy-menu').addEventListener('click', () => {
        document.execCommand('copy');
    });
    
    document.getElementById('paste-menu').addEventListener('click', async () => {
        const clipboardText = await ipcRenderer.invoke('get-clipboard');
        if (document.activeElement) {
            document.activeElement.value += clipboardText;
        }
    });
    
    document.getElementById('find-menu').addEventListener('click', () => {
        showModal('search-modal');
    });
    
    // View Menu
    document.getElementById('toggle-sidebar-menu')?.addEventListener('click', () => {
        toggleSidebar();
        showNotification('Sidebar toggled', 'info');
    });

    document.getElementById('toggle-statusbar-menu')?.addEventListener('click', () => {
        toggleStatusBar();
        showNotification('Status bar toggled', 'info');
    });

    document.getElementById('theme-menu')?.addEventListener('click', () => {
        switchView('settings');
        setTimeout(() => {
            document.querySelector('[data-category="appearance"]')?.click();
        }, 100);
        showNotification('Opening theme settings...', 'info');
    });

    document.getElementById('zoom-in-menu')?.addEventListener('click', () => {
        document.body.classList.remove('zoom-out');
        document.body.classList.add('zoom-in');
        showNotification('Zoomed in (110%)', 'info');
    });

    document.getElementById('zoom-out-menu')?.addEventListener('click', () => {
        document.body.classList.remove('zoom-in');
        document.body.classList.add('zoom-out');
        showNotification('Zoomed out (90%)', 'info');
    });

    document.getElementById('reset-zoom-menu')?.addEventListener('click', () => {
        document.body.classList.remove('zoom-in', 'zoom-out');
        showNotification('Zoom reset (100%)', 'info');
    });

    document.getElementById('fullscreen-menu')?.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
            showNotification('Exited fullscreen', 'info');
        } else {
            document.documentElement.requestFullscreen();
            showNotification('Entered fullscreen', 'info');
        }
    });
    
    // Project Menu
    document.getElementById('build-project-menu').addEventListener('click', async () => {
        await buildProject();
    });
    
    document.getElementById('run-project-menu').addEventListener('click', async () => {
        await runProject();
    });
    
    document.getElementById('install-deps-menu').addEventListener('click', async () => {
        await installDependencies();
    });
    
    document.getElementById('project-settings-menu').addEventListener('click', () => {
        if (currentProject) {
            showProjectSettings();
        } else {
            showNotification('Please select a project first', 'error');
        }
    });
    
    document.getElementById('delete-project-menu').addEventListener('click', async () => {
        if (currentProject) {
            const result = await ipcRenderer.invoke('delete-project', currentProject.path);
            if (result.success) {
                currentProject = null;
                await loadRecentProjects();
                showNotification('Project deleted successfully', 'success');
            }
        }
    });
    
    // Tools Menu
    document.getElementById('terminal-menu').addEventListener('click', async () => {
        if (currentProject) {
            await ipcRenderer.invoke('open-terminal', currentProject.path);
        } else {
            await ipcRenderer.invoke('open-terminal', workspacePath);
        }
    });
    
    document.getElementById('command-palette-menu').addEventListener('click', () => {
        showModal('command-palette-modal');
    });
    
    document.getElementById('git-init-menu').addEventListener('click', async () => {
        await initializeGit();
    });
    
    document.getElementById('git-commit-menu').addEventListener('click', () => {
        showModal('git-commit-modal');
    });
    
    document.getElementById('npm-install-menu').addEventListener('click', async () => {
        if (currentProject) {
            const result = await ipcRenderer.invoke('run-command', 'npm install', currentProject.path);
            if (result.success) {
                showNotification('NPM packages installed successfully', 'success');
            } else {
                showNotification(`Error: ${result.error}`, 'error');
            }
        }
    });
    
    document.getElementById('pip-install-menu').addEventListener('click', async () => {
        if (currentProject) {
            const result = await ipcRenderer.invoke('run-command', 'pip install -r requirements.txt', currentProject.path);
            if (result.success) {
                showNotification('Python packages installed successfully', 'success');
            } else {
                showNotification(`Error: ${result.error}`, 'error');
            }
        }
    });
    
    document.getElementById('extensions-menu').addEventListener('click', () => {
        switchView('extensions');
    });
    
    // Help Menu
    document.getElementById('documentation-menu')?.addEventListener('click', () => {
        ipcRenderer.invoke('open-external', 'https://github.com/yourusername/appmanager-pro');
        showNotification('Opening documentation in browser...', 'info');
    });

    document.getElementById('keyboard-shortcuts-menu')?.addEventListener('click', () => {
        showModal('shortcuts-modal');
    });

    document.getElementById('check-updates-menu')?.addEventListener('click', async () => {
        showNotification('Checking for updates...', 'info');
        // Simulate update check
        setTimeout(() => {
            showNotification('You are using the latest version', 'success');
        }, 2000);
    });

    document.getElementById('report-issue-menu')?.addEventListener('click', () => {
        ipcRenderer.invoke('open-external', 'https://github.com/yourusername/appmanager-pro/issues');
        showNotification('Opening GitHub Issues...', 'info');
    });

    document.getElementById('about-menu')?.addEventListener('click', () => {
        showAboutDialog();
    });
}

// Show About Dialog
function showAboutDialog() {
    showModal('about-modal');

    // Populate version information
    if (process && process.versions) {
        document.getElementById('electron-version').textContent = process.versions.electron || 'N/A';
        document.getElementById('node-version').textContent = process.versions.node || 'N/A';
    }

    // Platform information
    const platform = process.platform || 'unknown';
    const arch = process.arch || 'unknown';
    document.getElementById('platform-info').textContent = `${platform} (${arch})`;
}

// Initialize About dialog buttons
function initializeAboutDialog() {
    document.getElementById('open-github')?.addEventListener('click', () => {
        ipcRenderer.invoke('open-external', 'https://github.com/yourusername/appmanager-pro');
        showNotification('Opening GitHub repository...', 'info');
    });

    document.getElementById('open-docs')?.addEventListener('click', () => {
        ipcRenderer.invoke('open-external', 'https://github.com/yourusername/appmanager-pro/wiki');
        showNotification('Opening documentation...', 'info');
    });

    document.getElementById('open-license')?.addEventListener('click', () => {
        ipcRenderer.invoke('open-external', 'https://github.com/yourusername/appmanager-pro/blob/main/LICENSE');
        showNotification('Opening license...', 'info');
    });

    document.getElementById('check-updates')?.addEventListener('click', () => {
        hideModal('about-modal');
        showNotification('Checking for updates...', 'info');

        setTimeout(() => {
            showNotification('You are using the latest version (1.0.0)', 'success');
        }, 2000);
    });
}

// Sidebar navigation
function initializeSidebar() {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view) {
                switchView(view);
            }
        });
    });
}

// View switching
function switchView(viewName) {
    // Update sidebar
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === viewName) {
            item.classList.add('active');
        }
    });
    
    // Update content
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) {
        targetView.classList.add('active');
        currentView = viewName;
        
        // Load view-specific data
        if (viewName === 'projects') {
            loadAllProjects();
        } else if (viewName === 'git') {
            refreshGitStatus();
        }
    }
}

// Settings functionality
function initializeSettings() {
    // Settings categories
    document.querySelectorAll('.settings-category').forEach(category => {
        category.addEventListener('click', () => {
            switchSettingsCategory(category.dataset.category);
        });
    });

    // Settings search functionality
    const settingsSearch = document.getElementById('settings-search');
    const clearSearchBtn = document.getElementById('clear-settings-search');

    if (settingsSearch) {
        settingsSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            filterSettings(query);

            // Show/hide clear button
            if (clearSearchBtn) {
                clearSearchBtn.style.display = query ? 'block' : 'none';
            }
        });

        settingsSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                settingsSearch.value = '';
                filterSettings('');
                if (clearSearchBtn) clearSearchBtn.style.display = 'none';
            }
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (settingsSearch) {
                settingsSearch.value = '';
                settingsSearch.focus();
                filterSettings('');
                clearSearchBtn.style.display = 'none';
            }
        });
    }

    // Save settings button
    document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
        await saveSettings();
    });

    // Browse buttons
    document.getElementById('browse-default-path')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            document.getElementById('default-project-path').value = selectedPath;
        }
    });

    document.getElementById('browse-editor-path')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-file', {
            filters: [{ name: 'Executables', extensions: ['exe'] }]
        });
        if (selectedPath) {
            document.getElementById('editor-path').value = selectedPath;
        }
    });

    document.getElementById('browse-terminal-path')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-file', {
            filters: [{ name: 'Executables', extensions: ['exe'] }]
        });
        if (selectedPath) {
            document.getElementById('terminal-path').value = selectedPath;
        }
    });

    document.getElementById('browse-git-path')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-file', {
            filters: [{ name: 'Executables', extensions: ['exe'] }]
        });
        if (selectedPath) {
            document.getElementById('git-path').value = selectedPath;
        }
    });

    // Theme selection
    document.getElementById('theme-select')?.addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });

    // Accent color
    document.getElementById('accent-color')?.addEventListener('change', (e) => {
        document.documentElement.style.setProperty('--accent-primary', e.target.value);
        showNotification('Accent color changed. Save settings to persist.', 'info');
    });

    // Font family
    document.getElementById('font-family')?.addEventListener('change', (e) => {
        if (e.target.value === 'system') {
            document.body.style.fontFamily = '';
        } else {
            document.body.style.fontFamily = e.target.value;
        }
    });

    // Font size slider
    document.getElementById('font-size')?.addEventListener('input', (e) => {
        document.getElementById('font-size-value').textContent = `${e.target.value}px`;
        document.documentElement.style.fontSize = `${e.target.value}px`;
    });

    // UI scale slider
    document.getElementById('ui-scale')?.addEventListener('input', (e) => {
        document.getElementById('ui-scale-value').textContent = `${e.target.value}%`;
        document.body.style.zoom = `${e.target.value}%`;
    });

    // Clear cache button
    document.getElementById('clear-cache-btn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all cache? This cannot be undone.')) {
            showNotification('Cache cleared successfully', 'success');
        }
    });

    // Reset settings button
    document.getElementById('reset-settings-btn')?.addEventListener('click', async () => {
        const confirmed = confirm('⚠️ Reset all settings to default?\n\nThis will:\n• Clear all your custom settings\n• Restore factory defaults\n• Reload the application\n\nThis action cannot be undone.');

        if (confirmed) {
            try {
                localStorage.clear();
                showNotification('Resetting settings...', 'info');
                await ipcRenderer.invoke('reload-window');
            } catch (error) {
                console.error('Failed to reset settings:', error);
                showNotification('Failed to reset settings', 'error');
            }
        }
    });

    // Smooth scrolling toggle
    document.getElementById('smooth-scrolling')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.documentElement.style.scrollBehavior = 'smooth';
        } else {
            document.documentElement.style.scrollBehavior = 'auto';
        }
    });

    // Animations toggle
    document.getElementById('animations-enabled')?.addEventListener('change', (e) => {
        if (!e.target.checked) {
            document.body.classList.add('no-animations');
        } else {
            document.body.classList.remove('no-animations');
        }
    });

    // Import settings button
    document.getElementById('import-settings-btn')?.addEventListener('click', async () => {
        await importSettings();
    });

    // Export settings button
    document.getElementById('export-settings-btn')?.addEventListener('click', async () => {
        await exportSettings();
    });

    // Keyboard shortcuts for settings
    document.addEventListener('keydown', (e) => {
        const settingsView = document.getElementById('settings-view');
        if (!settingsView || !settingsView.classList.contains('active')) return;

        // Ctrl/Cmd + F to focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            document.getElementById('settings-search')?.focus();
        }

        // Ctrl/Cmd + S to save settings
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveSettings();
        }

        // Arrow keys for category navigation
        const activeCategory = document.querySelector('.settings-category.active');
        if (activeCategory && !e.target.matches('input, select, textarea')) {
            let nextCategory = null;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                nextCategory = activeCategory.nextElementSibling;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                nextCategory = activeCategory.previousElementSibling;
            }

            if (nextCategory && nextCategory.classList.contains('settings-category')) {
                switchSettingsCategory(nextCategory.dataset.category);
            }
        }
    });

    // Add ARIA labels and roles for accessibility
    addAccessibilityAttributes();
}

// Add accessibility attributes
function addAccessibilityAttributes() {
    // Settings categories
    document.querySelectorAll('.settings-category').forEach((category) => {
        category.setAttribute('role', 'tab');
        category.setAttribute('tabindex', category.classList.contains('active') ? '0' : '-1');
        category.setAttribute('aria-selected', category.classList.contains('active') ? 'true' : 'false');
        category.setAttribute('aria-label', `${category.textContent.trim()} settings`);
    });

    // Settings panels
    document.querySelectorAll('.settings-panel').forEach((panel) => {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-hidden', panel.classList.contains('active') ? 'false' : 'true');
    });

    // Form inputs
    document.querySelectorAll('.setting-item input, .setting-item select').forEach(input => {
        const label = input.closest('.setting-item')?.querySelector('label');
        if (label && !input.id) {
            const id = 'setting-' + Math.random().toString(36).substring(2, 11);
            input.id = id;
            label.setAttribute('for', id);
        }
    });
}

// Switch settings category with animation
function switchSettingsCategory(categoryName) {
    document.querySelectorAll('.settings-category').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-selected', 'false');
        c.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('.settings-panel').forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-hidden', 'true');
    });

    const category = document.querySelector(`.settings-category[data-category="${categoryName}"]`);
    const panel = document.getElementById(`${categoryName}-settings`);

    if (category) {
        category.classList.add('active');
        category.setAttribute('aria-selected', 'true');
        category.setAttribute('tabindex', '0');
        category.focus();
    }
    if (panel) {
        panel.classList.add('active');
        panel.setAttribute('aria-hidden', 'false');
    }

    // Update breadcrumb
    updateSettingsBreadcrumb(categoryName);
}

// Update settings breadcrumb
function updateSettingsBreadcrumb(categoryName) {
    const breadcrumb = document.getElementById('settings-breadcrumb');
    if (!breadcrumb) return;

    const categoryNames = {
        'general': 'General',
        'appearance': 'Appearance',
        'editor': 'Editor',
        'terminal': 'Terminal',
        'git': 'Git',
        'extensions': 'Extensions',
        'advanced': 'Advanced'
    };

    breadcrumb.innerHTML = `<span class="breadcrumb-item active">${categoryNames[categoryName] || 'Settings'}</span>`;
}

// Filter settings based on search query
function filterSettings(query) {
    if (!query) {
        // Show all settings
        document.querySelectorAll('.setting-item').forEach(item => {
            item.style.display = '';
            item.classList.remove('highlight-search');
        });
        document.querySelectorAll('.setting-group').forEach(group => {
            group.style.display = '';
        });
        document.querySelectorAll('.settings-category').forEach(cat => {
            cat.style.display = '';
        });
        return;
    }

    let hasResults = false;
    const categories = new Set();

    // Search through all setting items
    document.querySelectorAll('.setting-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        const matches = text.includes(query);

        if (matches) {
            item.style.display = '';
            item.classList.add('highlight-search');
            hasResults = true;

            // Track which category this belongs to
            const panel = item.closest('.settings-panel');
            if (panel) {
                const categoryName = panel.id.replace('-settings', '');
                categories.add(categoryName);
            }
        } else {
            item.style.display = 'none';
            item.classList.remove('highlight-search');
        }
    });

    // Hide/show groups based on whether they have visible items
    document.querySelectorAll('.setting-group').forEach(group => {
        const visibleItems = Array.from(group.querySelectorAll('.setting-item')).some(
            item => item.style.display !== 'none'
        );
        group.style.display = visibleItems ? '' : 'none';
    });

    // Show only matching categories in sidebar
    document.querySelectorAll('.settings-category').forEach(cat => {
        if (categories.has(cat.dataset.category)) {
            cat.style.display = '';
        } else {
            cat.style.display = 'none';
        }
    });

    // If we have results, show all panels to display filtered results
    if (hasResults) {
        document.querySelectorAll('.settings-panel').forEach(panel => {
            const categoryName = panel.id.replace('-settings', '');
            if (categories.has(categoryName)) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });
    }
}

// Import settings from file
async function importSettings() {
    try {
        const filePath = await ipcRenderer.invoke('select-file', {
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
            properties: ['openFile']
        });

        if (filePath) {
            const fs = require('fs');
            const importedSettings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            // Validate and merge settings
            appSettings = { ...appSettings, ...importedSettings };

            // Save to storage
            await ipcRenderer.invoke('save-settings', appSettings);

            // Reload UI
            await loadSettings();

            showNotification('Settings imported successfully', 'success');
        }
    } catch (error) {
        console.error('Failed to import settings:', error);
        showNotification('Failed to import settings', 'error');
    }
}

// Export settings to file
async function exportSettings() {
    try {
        const filePath = await ipcRenderer.invoke('save-dialog', {
            defaultPath: 'appmanager-settings.json',
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });

        if (filePath) {
            const fs = require('fs');
            fs.writeFileSync(filePath, JSON.stringify(appSettings, null, 2));
            showNotification('Settings exported successfully', 'success');
        }
    } catch (error) {
        console.error('Failed to export settings:', error);
        showNotification('Failed to export settings', 'error');
    }
}

// Git functionality
function initializeGitView() {
    // Initialize Git Tabs
    initializeGitTabs();

    document.getElementById('clone-repo')?.addEventListener('click', () => {
        showModal('clone-modal');
    });

    document.getElementById('git-refresh')?.addEventListener('click', async () => {
        await refreshGitStatus();
    });

    document.getElementById('git-stage-all')?.addEventListener('click', async () => {
        await stageAll();
    });

    document.getElementById('git-discard-all')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to discard all changes? This cannot be undone.')) {
            await discardAll();
        }
    });

    document.getElementById('git-select-repo')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            // Check if it's a valid project
            const projectName = path.basename(selectedPath);
            currentProject = {
                name: projectName,
                path: selectedPath,
                type: 'unknown'
            };
            await refreshGitStatus();
            showNotification(`Selected repository: ${projectName}`, 'success');
        }
    });

    document.getElementById('git-init-btn')?.addEventListener('click', async () => {
        await initializeGit();
    });

    document.getElementById('git-commit-btn')?.addEventListener('click', () => {
        showModal('git-commit-modal');
    });
    
    document.getElementById('confirm-commit-btn')?.addEventListener('click', async () => {
        const message = document.getElementById('commit-message').value;
        if (!message) {
            showNotification('Please enter a commit message', 'error');
            return;
        }
        
        if (currentProject) {
            const result = await ipcRenderer.invoke('git-commit', currentProject.path, message);
            if (result.success) {
                showNotification('Changes committed successfully', 'success');
                hideModal('git-commit-modal');
                document.getElementById('commit-message').value = '';
                await refreshGitStatus();
            } else {
                showNotification(`Commit failed: ${result.error}`, 'error');
            }
        }
    });
    
    // Clone repository
    document.getElementById('clone-btn')?.addEventListener('click', async () => {
        const repoUrl = document.getElementById('repo-url').value;
        const cloneLocation = document.getElementById('clone-location').value;
        
        if (!repoUrl) {
            showNotification('Please enter repository URL', 'error');
            return;
        }
        
        const result = await ipcRenderer.invoke('clone-repository', repoUrl, cloneLocation);
        if (result.success) {
            showNotification('Repository cloned successfully', 'success');
            hideModal('clone-modal');
            
            if (document.getElementById('open-after-clone').checked) {
                const repoName = repoUrl.split('/').pop().replace('.git', '');
                const repoPath = path.join(cloneLocation || workspacePath, repoName);
                await ipcRenderer.invoke('open-in-vscode', repoPath);
            }
        } else {
            showNotification(`Clone failed: ${result.error}`, 'error');
        }
    });
    
    document.getElementById('browse-clone-location')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            document.getElementById('clone-location').value = selectedPath;
        }
    });

    // Pull/Push/Fetch/Sync operations
    document.getElementById('git-pull-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showNotification('Pulling changes...', 'info');
        const result = await ipcRenderer.invoke('git-pull', currentProject.path);
        if (result.success) {
            showNotification('Pull completed successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Pull failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-push-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showNotification('Pushing changes...', 'info');
        const result = await ipcRenderer.invoke('git-push', currentProject.path);
        if (result.success) {
            showNotification('Push completed successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Push failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-fetch-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showNotification('Fetching from remote...', 'info');
        const result = await ipcRenderer.invoke('git-fetch', currentProject.path);
        if (result.success) {
            showNotification('Fetch completed successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Fetch failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-sync-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showNotification('Syncing repository...', 'info');
        const result = await ipcRenderer.invoke('git-sync', currentProject.path);
        if (result.success) {
            showNotification('Sync completed successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Sync failed: ${result.error}`, 'error');
        }
    });

    // Stash operations
    document.getElementById('git-stash-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        const message = prompt('Enter stash message (optional):');
        const result = await ipcRenderer.invoke('git-stash', currentProject.path, message || '');
        if (result.success) {
            showNotification('Changes stashed successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Stash failed: ${result.error}`, 'error');
        }
    });

    // Merge operations
    document.getElementById('git-merge-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('git-merge-modal');
        await loadBranchesForMerge();
    });

    // Commit and push combined
    document.getElementById('git-commit-push-btn')?.addEventListener('click', async () => {
        const message = document.getElementById('git-commit-message-input')?.value;
        if (!message || !message.trim()) {
            showNotification('Please enter a commit message', 'error');
            return;
        }

        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }

        showNotification('Committing changes...', 'info');
        const commitResult = await ipcRenderer.invoke('git-commit', currentProject.path, message);
        if (commitResult.success) {
            showNotification('Pushing to remote...', 'info');
            const pushResult = await ipcRenderer.invoke('git-push', currentProject.path);
            if (pushResult.success) {
                showNotification('Committed and pushed successfully', 'success');
                document.getElementById('git-commit-message-input').value = '';
                await refreshGitStatus();
            } else {
                showNotification(`Commit succeeded but push failed: ${pushResult.error}`, 'warning');
            }
        } else {
            showNotification(`Commit failed: ${commitResult.error}`, 'error');
        }
    });

    // Project dropdown
    document.getElementById('git-project-dropdown-btn')?.addEventListener('click', () => {
        const menu = document.getElementById('git-projects-menu');
        const btn = document.getElementById('git-project-dropdown-btn');
        menu.classList.toggle('show');
        btn.classList.toggle('active');
        if (menu.classList.contains('show')) {
            loadProjectsIntoDropdown();
        }
    });

    document.getElementById('git-projects-search')?.addEventListener('input', (e) => {
        filterProjectsInDropdown(e.target.value);
    });

    document.getElementById('git-open-folder-btn')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            const projectName = selectedPath.split('\\').pop();
            currentProject = { name: projectName, path: selectedPath };
            updateSelectedProject();
            await refreshGitStatus();
            document.getElementById('git-projects-menu').classList.remove('show');
            document.getElementById('git-project-dropdown-btn').classList.remove('active');
        }
    });

    document.getElementById('git-new-project-btn')?.addEventListener('click', () => {
        document.getElementById('git-projects-menu').classList.remove('show');
        document.getElementById('git-project-dropdown-btn').classList.remove('active');
        showModal('new-project-modal');
    });

    // GitHub Integration
    document.getElementById('github-upload-btn')?.addEventListener('click', () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('github-upload-modal');
        document.getElementById('github-repo-name').value = currentProject.name;
    });

    document.getElementById('github-connect-btn')?.addEventListener('click', () => {
        showModal('github-auth-modal');
    });

    document.getElementById('confirm-github-auth-btn')?.addEventListener('click', async () => {
        const token = document.getElementById('github-token').value;
        if (!token) {
            showNotification('Please enter a GitHub token', 'error');
            return;
        }

        const result = await ipcRenderer.invoke('github-save-token', token);
        if (result.success) {
            showNotification('GitHub account connected successfully', 'success');
            hideModal('github-auth-modal');
            await updateGitHubStatus();
        } else {
            showNotification(`Failed to connect: ${result.error}`, 'error');
        }
    });

    document.getElementById('github-token-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        require('electron').shell.openExternal('https://github.com/settings/tokens');
    });

    document.getElementById('confirm-github-upload-btn')?.addEventListener('click', async () => {
        const repoName = document.getElementById('github-repo-name').value;
        const description = document.getElementById('github-repo-description').value;
        const isPrivate = document.querySelector('input[name="github-visibility"]:checked').value === 'private';

        if (!repoName) {
            showNotification('Please enter a repository name', 'error');
            return;
        }

        if (!currentProject) {
            showNotification('No project selected', 'error');
            return;
        }

        showNotification('Creating repository and uploading...', 'info');

        const result = await ipcRenderer.invoke('github-upload-project', currentProject.path, {
            name: repoName,
            description,
            isPrivate
        });

        if (result.success) {
            showNotification('Project uploaded to GitHub successfully!', 'success');
            hideModal('github-upload-modal');
            await refreshGitStatus();
        } else {
            showNotification(`Upload failed: ${result.error}`, 'error');
        }
    });

    // GitHub sidebar action buttons
    document.getElementById('github-create-repo-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('github-upload-modal');
        document.getElementById('github-repo-name').value = currentProject.name;
    });

    document.getElementById('github-publish-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }

        showNotification('Publishing branch to GitHub...', 'info');
        const result = await ipcRenderer.invoke('git-push', currentProject.path);
        if (result.success) {
            showNotification('Branch published successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Publish failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('github-pr-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }

        // Get the remote URL from git config
        const remoteResult = await ipcRenderer.invoke('git-remote-list', currentProject.path);
        if (remoteResult.success && remoteResult.output) {
            // Parse the remote URL to get the GitHub repository
            const match = remoteResult.output.match(/github\.com[:/](.+?)\.git/);
            if (match) {
                const repoPath = match[1];
                const prUrl = `https://github.com/${repoPath}/compare`;
                require('electron').shell.openExternal(prUrl);
                showNotification('Opening GitHub PR creation page...', 'info');
            } else {
                showNotification('No GitHub remote found for this repository', 'error');
            }
        } else {
            showNotification('Could not get remote information', 'error');
        }
    });

    document.getElementById('github-issues-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }

        // Get the remote URL from git config
        const remoteResult = await ipcRenderer.invoke('git-remote-list', currentProject.path);
        if (remoteResult.success && remoteResult.output) {
            // Parse the remote URL to get the GitHub repository
            const match = remoteResult.output.match(/github\.com[:/](.+?)\.git/);
            if (match) {
                const repoPath = match[1];
                const issuesUrl = `https://github.com/${repoPath}/issues`;
                require('electron').shell.openExternal(issuesUrl);
                showNotification('Opening GitHub issues page...', 'info');
            } else {
                showNotification('No GitHub remote found for this repository', 'error');
            }
        } else {
            showNotification('Could not get remote information', 'error');
        }
    });

    document.getElementById('github-disconnect-btn')?.addEventListener('click', async () => {
        const confirmed = confirm('Are you sure you want to disconnect your GitHub account?');
        if (confirmed) {
            await ipcRenderer.invoke('github-disconnect');
            await updateGitHubStatus();
            showNotification('GitHub account disconnected', 'success');
        }
    });

    // Advanced Git Operations
    document.getElementById('git-rebase-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('git-rebase-modal');
        await loadBranchesForRebase();
    });

    document.getElementById('confirm-rebase-btn')?.addEventListener('click', async () => {
        const targetBranch = document.getElementById('rebase-branch-select').value;
        if (!targetBranch) {
            showNotification('Please select a branch', 'error');
            return;
        }

        showNotification('Rebasing...', 'info');
        const result = await ipcRenderer.invoke('git-rebase', currentProject.path, targetBranch);
        if (result.success) {
            showNotification('Rebase completed successfully', 'success');
            hideModal('git-rebase-modal');
            await refreshGitStatus();
        } else {
            showNotification(`Rebase failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-cherry-pick-btn')?.addEventListener('click', () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('git-cherry-pick-modal');
    });

    document.getElementById('confirm-cherry-pick-btn')?.addEventListener('click', async () => {
        const commitHash = document.getElementById('cherry-pick-commit').value;
        const noCommit = document.getElementById('cherry-pick-no-commit').checked;

        if (!commitHash) {
            showNotification('Please enter a commit hash', 'error');
            return;
        }

        showNotification('Cherry picking commit...', 'info');
        const result = await ipcRenderer.invoke('git-cherry-pick', currentProject.path, commitHash, noCommit);
        if (result.success) {
            showNotification('Commit cherry-picked successfully', 'success');
            hideModal('git-cherry-pick-modal');
            await refreshGitStatus();
        } else {
            showNotification(`Cherry pick failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-tags-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('git-tags-modal');
        await loadGitTags();
    });

    document.getElementById('create-tag-btn')?.addEventListener('click', () => {
        document.getElementById('create-tag-form').style.display = 'block';
    });

    document.getElementById('cancel-tag-btn')?.addEventListener('click', () => {
        document.getElementById('create-tag-form').style.display = 'none';
        document.getElementById('new-tag-name').value = '';
        document.getElementById('new-tag-message').value = '';
    });

    document.getElementById('confirm-tag-btn')?.addEventListener('click', async () => {
        const tagName = document.getElementById('new-tag-name').value;
        const message = document.getElementById('new-tag-message').value;
        const pushToRemote = document.getElementById('tag-push-remote').checked;

        if (!tagName) {
            showNotification('Please enter a tag name', 'error');
            return;
        }

        showNotification('Creating tag...', 'info');
        const result = await ipcRenderer.invoke('git-tag-create', currentProject.path, tagName, message, pushToRemote);
        if (result.success) {
            showNotification('Tag created successfully', 'success');
            document.getElementById('create-tag-form').style.display = 'none';
            await loadGitTags();
        } else {
            showNotification(`Tag creation failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-reset-btn')?.addEventListener('click', () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        showModal('git-reset-modal');
    });

    document.getElementById('confirm-reset-btn')?.addEventListener('click', async () => {
        const target = document.getElementById('reset-target').value;
        const mode = document.querySelector('input[name="reset-mode"]:checked').value;

        if (!target) {
            showNotification('Please enter a reset target', 'error');
            return;
        }

        if (mode === 'hard') {
            const confirmed = confirm('Hard reset will permanently discard all changes. Are you sure?');
            if (!confirmed) return;
        }

        showNotification('Resetting...', 'info');
        const result = await ipcRenderer.invoke('git-reset', currentProject.path, target, mode);
        if (result.success) {
            showNotification('Reset completed successfully', 'success');
            hideModal('git-reset-modal');
            await refreshGitStatus();
        } else {
            showNotification(`Reset failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-revert-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }
        const commitHash = prompt('Enter commit hash to revert:');
        if (!commitHash) return;

        showNotification('Reverting commit...', 'info');
        const result = await ipcRenderer.invoke('git-revert', currentProject.path, commitHash);
        if (result.success) {
            showNotification('Commit reverted successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Revert failed: ${result.error}`, 'error');
        }
    });

    document.getElementById('git-clean-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('Please select a project first', 'error');
            return;
        }

        const confirmed = confirm('This will remove all untracked files. Are you sure?');
        if (!confirmed) return;

        showNotification('Cleaning repository...', 'info');
        const result = await ipcRenderer.invoke('git-clean', currentProject.path, true, true);
        if (result.success) {
            showNotification('Repository cleaned successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Clean failed: ${result.error}`, 'error');
        }
    });

    // Initialize GitHub status on load
    updateGitHubStatus();

    // Listen for file watcher updates
    ipcRenderer.on('git-status-changed', async (event, projectPath) => {
        if (currentProject && currentProject.path === projectPath) {
            await refreshGitStatus();
        }
    });

    // Listen for git history updates
    ipcRenderer.on('git-history-updated', (event, history) => {
        // Update undo button state based on history
        const undoBtn = document.getElementById('git-undo-btn');
        if (undoBtn) {
            undoBtn.disabled = history.length === 0;
            undoBtn.title = history.length > 0
                ? `Undo: ${history[0].type} - ${history[0].message}`
                : 'No operations to undo';
        }
    });

    // Undo button handler
    document.getElementById('git-undo-btn')?.addEventListener('click', async () => {
        if (!currentProject) {
            showNotification('No project selected', 'error');
            return;
        }

        const result = await ipcRenderer.invoke('undo-last-operation');
        if (result.success) {
            showNotification('Operation undone successfully', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Undo failed: ${result.error}`, 'error');
        }
    });
}

// Git Helper Functions

async function loadProjectsIntoDropdown() {
    const projects = await ipcRenderer.invoke('get-projects');
    const menuBody = document.getElementById('git-projects-menu-body');

    if (!projects || projects.length === 0) {
        menuBody.innerHTML = `
            <div class="git-projects-menu-empty">
                <i class="fas fa-folder-open"></i>
                <p>No projects found</p>
                <small>Create a project or clone a repository to get started</small>
            </div>
        `;
        return;
    }

    menuBody.innerHTML = projects.map(project => {
        const isActive = currentProject && currentProject.path === project.path;
        return `
            <div class="git-projects-menu-item ${isActive ? 'active' : ''}" data-path="${project.path}" data-name="${project.name}">
                <i class="fas fa-folder"></i>
                <div class="git-projects-menu-item-content">
                    <span class="git-projects-menu-item-name">${project.name}</span>
                    <span class="git-projects-menu-item-path">${project.path}</span>
                </div>
                ${project.type ? `<span class="git-projects-menu-item-badge">${project.type}</span>` : ''}
            </div>
        `;
    }).join('');

    // Add click handlers
    document.querySelectorAll('.git-projects-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
            const path = item.dataset.path;
            const name = item.dataset.name;
            currentProject = { name, path };
            updateSelectedProject();

            // Start file watcher for real-time updates
            await ipcRenderer.invoke('start-file-watcher', path);

            await refreshGitStatus();
            document.getElementById('git-projects-menu').classList.remove('show');
            document.getElementById('git-project-dropdown-btn').classList.remove('active');
        });
    });
}

function filterProjectsInDropdown(query) {
    const items = document.querySelectorAll('.git-projects-menu-item');
    const lowerQuery = query.toLowerCase();

    items.forEach(item => {
        const name = item.dataset.name.toLowerCase();
        const path = item.dataset.path.toLowerCase();

        if (name.includes(lowerQuery) || path.includes(lowerQuery)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function updateSelectedProject() {
    if (!currentProject) {
        document.getElementById('git-selected-project-name').textContent = 'No repository selected';
        document.getElementById('git-selected-project-path').textContent = 'Select a project to manage';

        // Clear status badges
        const badgesContainer = document.getElementById('git-repo-status-badges');
        if (badgesContainer) {
            badgesContainer.innerHTML = '';
        }
        return;
    }

    document.getElementById('git-selected-project-name').textContent = currentProject.name;
    document.getElementById('git-selected-project-path').textContent = currentProject.path;

    // Add file watcher badge
    const badgesContainer = document.getElementById('git-repo-status-badges');
    if (badgesContainer) {
        badgesContainer.innerHTML = `
            <div class="git-status-badge watching" title="Real-time file monitoring active">
                <i class="fas fa-eye"></i>
                <span>Watching</span>
            </div>
        `;
    }
}

async function updateGitHubStatus() {
    const result = await ipcRenderer.invoke('github-get-user');
    const statusDiv = document.getElementById('github-status');
    const actionsDiv = document.getElementById('github-actions');

    if (result.success && result.user) {
        statusDiv.innerHTML = `
            <div class="github-connected">
                <i class="fab fa-github"></i>
                <div class="github-user-info">
                    <div class="github-username">${result.user.login}</div>
                    <div class="github-email">${result.user.email || 'No email'}</div>
                </div>
                <button class="github-disconnect-btn" id="github-disconnect-btn-inline">
                    <i class="fas fa-unlink"></i> Disconnect
                </button>
            </div>
        `;
        actionsDiv.style.display = 'grid';

        // Add disconnect handler
        document.getElementById('github-disconnect-btn-inline')?.addEventListener('click', async () => {
            const confirmed = confirm('Are you sure you want to disconnect your GitHub account?');
            if (confirmed) {
                await ipcRenderer.invoke('github-disconnect');
                await updateGitHubStatus();
                showNotification('GitHub account disconnected', 'success');
            }
        });
    } else {
        statusDiv.innerHTML = `
            <div class="github-not-connected">
                <i class="fab fa-github"></i>
                <p>Not connected to GitHub</p>
                <button class="btn-secondary" id="github-connect-btn-inline">
                    <i class="fas fa-link"></i> Connect Account
                </button>
            </div>
        `;
        actionsDiv.style.display = 'none';

        // Add connect handler
        document.getElementById('github-connect-btn-inline')?.addEventListener('click', () => {
            showModal('github-auth-modal');
        });
    }
}

async function loadBranchesForRebase() {
    if (!currentProject) return;

    const result = await ipcRenderer.invoke('git-branches', currentProject.path);
    const select = document.getElementById('rebase-branch-select');

    if (result.success && result.branches) {
        select.innerHTML = '<option value="">Select a branch...</option>' +
            result.branches.map(branch =>
                `<option value="${branch.name}">${branch.name}</option>`
            ).join('');
    }
}

async function loadGitTags() {
    if (!currentProject) return;

    const result = await ipcRenderer.invoke('git-tag-list', currentProject.path);
    const tagsList = document.getElementById('git-tags-list');

    if (!result.success || !result.output || result.output.trim() === '') {
        tagsList.innerHTML = `
            <div class="tags-empty">
                <i class="fas fa-tag"></i>
                <p>No tags found</p>
            </div>
        `;
        return;
    }

    const tags = result.output.split('\n').filter(line => line.trim());
    tagsList.innerHTML = tags.map(tag => {
        const parts = tag.split(/\s+/);
        const tagName = parts[0];
        const tagMessage = parts.slice(1).join(' ') || 'No message';

        return `
            <div class="tag-item">
                <div class="tag-item-info">
                    <div class="tag-item-name">${tagName}</div>
                    <div class="tag-item-message">${tagMessage}</div>
                </div>
                <div class="tag-item-actions">
                    <button class="btn-icon" onclick="deleteTag('${tagName}')" title="Delete tag">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteTag(tagName) {
    const confirmed = confirm(`Delete tag "${tagName}"?`);
    if (!confirmed) return;

    const deleteRemote = confirm('Also delete from remote?');
    const result = await ipcRenderer.invoke('git-tag-delete', currentProject.path, tagName, deleteRemote);

    if (result.success) {
        showNotification('Tag deleted successfully', 'success');
        await loadGitTags();
    } else {
        showNotification(`Failed to delete tag: ${result.error}`, 'error');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('git-projects-menu');
    const btn = document.getElementById('git-project-dropdown-btn');

    if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.remove('show');
        btn.classList.remove('active');
    }
});

// Git Tabs Functionality
let gitStatusNeedsRefresh = false;
let currentGitTab = 'overview';

function initializeGitTabs() {
    const tabs = document.querySelectorAll('.git-tab');
    const panels = document.querySelectorAll('.git-tab-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            currentGitTab = targetTab;

            // Remove active class from all tabs and panels
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            // Add active class to clicked tab and corresponding panel
            tab.classList.add('active');
            const targetPanel = document.getElementById(`git-tab-${targetTab}`);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }

            // If switching to changes tab and refresh is pending, do it now
            if (targetTab === 'changes' && gitStatusNeedsRefresh) {
                requestAnimationFrame(() => {
                    refreshGitStatusNow();
                });
            }
        });
    });
}

// Extensions functionality
function initializeExtensions() {
    // Extension tabs
    document.querySelectorAll('.extensions-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.extensions-tabs .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const content = document.getElementById(`${tab.dataset.tab}-extensions`);
            if (content) content.classList.add('active');
        });
    });

    // Extension search
    document.getElementById('extension-search')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.extension-card').forEach(card => {
            const name = card.querySelector('h4')?.textContent.toLowerCase() || '';
            const description = card.querySelector('p')?.textContent.toLowerCase() || '';

            if (name.includes(query) || description.includes(query)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    });

    // Extension action buttons
    document.querySelectorAll('.extension-actions button').forEach(button => {
        button.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const extensionCard = e.currentTarget.closest('.extension-card');
            const extensionName = extensionCard.querySelector('h4')?.textContent.split(/\s+/)[0] || 'Extension';

            handleExtensionAction(action, extensionCard, extensionName);
        });
    });

    // Category cards
    document.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const category = e.currentTarget.querySelector('h4')?.textContent || '';
            filterExtensionsByCategory(category);
        });
    });

    // Refresh extensions button
    document.getElementById('refresh-extensions')?.addEventListener('click', () => {
        refreshExtensions();
    });

    document.getElementById('browse-extensions')?.addEventListener('click', () => {
        ipcRenderer.invoke('open-external', 'https://marketplace.visualstudio.com/');
    });

    // Update installed extensions count
    updateExtensionCounts();
}

// Handle extension actions (enable, disable, install, uninstall)
function handleExtensionAction(action, extensionCard, extensionName) {
    switch(action) {
        case 'disable':
            disableExtension(extensionCard, extensionName);
            break;
        case 'enable':
            enableExtension(extensionCard, extensionName);
            break;
        case 'uninstall':
            uninstallExtension(extensionCard, extensionName);
            break;
        case 'install':
            installExtension(extensionCard, extensionName);
            break;
        case 'settings':
            openExtensionSettings(extensionName);
            break;
        default:
            console.log(`Unknown action: ${action}`);
    }
}

// Disable extension
function disableExtension(extensionCard, extensionName) {
    extensionCard.classList.remove('enabled');
    extensionCard.classList.add('disabled');

    const statusBadge = extensionCard.querySelector('.extension-status');
    if (statusBadge) {
        statusBadge.classList.remove('enabled');
        statusBadge.classList.add('disabled');
        statusBadge.textContent = 'Disabled';
    }

    const actionButton = extensionCard.querySelector('[data-action="disable"]');
    if (actionButton) {
        actionButton.dataset.action = 'enable';
        actionButton.innerHTML = '<i class="fas fa-play"></i> Enable';
    }

    showNotification(`${extensionName} disabled`, 'success');
    updateExtensionCounts();
}

// Enable extension
function enableExtension(extensionCard, extensionName) {
    extensionCard.classList.remove('disabled');
    extensionCard.classList.add('enabled');

    const statusBadge = extensionCard.querySelector('.extension-status');
    if (statusBadge) {
        statusBadge.classList.remove('disabled');
        statusBadge.classList.add('enabled');
        statusBadge.textContent = 'Enabled';
    }

    const actionButton = extensionCard.querySelector('[data-action="enable"]');
    if (actionButton) {
        actionButton.dataset.action = 'disable';
        actionButton.innerHTML = '<i class="fas fa-pause"></i> Disable';
    }

    showNotification(`${extensionName} enabled`, 'success');
    updateExtensionCounts();
}

// Uninstall extension
function uninstallExtension(extensionCard, extensionName) {
    if (confirm(`Are you sure you want to uninstall ${extensionName}?`)) {
        extensionCard.style.transition = 'all 0.3s ease';
        extensionCard.style.opacity = '0';
        extensionCard.style.transform = 'translateX(-20px)';

        setTimeout(() => {
            extensionCard.remove();
            showNotification(`${extensionName} uninstalled`, 'success');
            updateExtensionCounts();
        }, 300);
    }
}

// Install extension
function installExtension(extensionCard, extensionName) {
    const installButton = extensionCard.querySelector('[data-action="install"]');
    if (installButton) {
        installButton.disabled = true;
        installButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';

        // Simulate installation
        setTimeout(() => {
            installButton.innerHTML = '<i class="fas fa-check"></i> Installed';
            showNotification(`${extensionName} installed successfully`, 'success');

            // Move to installed tab
            setTimeout(() => {
                moveToInstalledTab(extensionCard, extensionName);
            }, 1000);
        }, 2000);
    }
}

// Move extension to installed tab
function moveToInstalledTab(extensionCard, extensionName) {
    const installedContent = document.getElementById('installed-extensions');
    if (installedContent) {
        const newCard = extensionCard.cloneNode(true);
        newCard.classList.add('enabled');

        // Update buttons for installed extension
        const actionsDiv = newCard.querySelector('.extension-actions');
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <button class="btn-small btn-secondary" data-action="disable">
                    <i class="fas fa-pause"></i> Disable
                </button>
                <button class="btn-small" data-action="settings">
                    <i class="fas fa-cog"></i>
                </button>
            `;

            // Reattach event listeners
            actionsDiv.querySelectorAll('button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const action = e.currentTarget.dataset.action;
                    handleExtensionAction(action, newCard, extensionName);
                });
            });
        }

        // Add status badge
        const titleElement = newCard.querySelector('h4');
        if (titleElement && !titleElement.querySelector('.extension-status')) {
            titleElement.innerHTML += '<span class="extension-status enabled">Enabled</span>';
        }

        installedContent.insertBefore(newCard, installedContent.firstChild);
        extensionCard.remove();
        updateExtensionCounts();
    }
}

// Open extension settings
function openExtensionSettings(extensionName) {
    showNotification(`Opening settings for ${extensionName}`, 'info');
    // Could open a settings modal here
}

// Filter extensions by category
function filterExtensionsByCategory(category) {
    // Switch to popular or recommended tab and filter
    const popularTab = document.querySelector('.tab[data-tab="popular"]');
    if (popularTab) {
        popularTab.click();

        // Filter extensions by category
        setTimeout(() => {
            document.querySelectorAll('.extension-card').forEach(card => {
                const tags = card.querySelectorAll('.tag');
                let hasCategory = false;

                tags.forEach(tag => {
                    if (tag.textContent.toLowerCase().includes(category.toLowerCase())) {
                        hasCategory = true;
                    }
                });

                card.style.display = hasCategory ? 'flex' : 'none';
            });

            showNotification(`Showing ${category} extensions`, 'info');
        }, 100);
    }
}

// Refresh extensions list
function refreshExtensions() {
    const refreshButton = document.getElementById('refresh-extensions');
    if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.innerHTML = '<i class="fas fa-sync fa-spin"></i> Refreshing...';

        setTimeout(() => {
            refreshButton.disabled = false;
            refreshButton.innerHTML = '<i class="fas fa-sync"></i> Refresh';
            showNotification('Extensions refreshed', 'success');
            updateExtensionCounts();
        }, 1500);
    }
}

// Update extension counts in tabs
function updateExtensionCounts() {
    const installedTab = document.querySelector('.tab[data-tab="installed"]');
    if (installedTab) {
        const installedContent = document.getElementById('installed-extensions');
        const enabledCount = installedContent?.querySelectorAll('.extension-card.enabled').length || 0;
        const totalCount = installedContent?.querySelectorAll('.extension-card').length || 0;

        const badge = installedTab.querySelector('.tab-badge');
        if (badge) {
            badge.textContent = totalCount;
        }
    }
}

// Command palette
function initializeCommandPalette() {
    const input = document.getElementById('command-palette-input');
    const commandList = document.getElementById('command-list');
    
    input?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const items = commandList.querySelectorAll('.command-item');
        
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            if (text.includes(query)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    });
    
    document.querySelectorAll('.command-item').forEach(item => {
        item.addEventListener('click', () => {
            executeCommand(item.dataset.command);
            hideModal('command-palette-modal');
        });
    });
    
    // Handle Enter key in command palette
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const visibleItems = commandList.querySelectorAll('.command-item:not([style*="display: none"])');
            if (visibleItems.length > 0) {
                executeCommand(visibleItems[0].dataset.command);
                hideModal('command-palette-modal');
            }
        }
    });
}

// Execute command from command palette
function executeCommand(command) {
    switch(command) {
        case 'new-project':
            showModal('new-project-modal');
            break;
        case 'open-project':
            document.getElementById('open-project-menu').click();
            break;
        case 'search-projects':
            showModal('search-modal');
            break;
        case 'open-terminal':
            document.getElementById('terminal-menu').click();
            break;
        case 'toggle-sidebar':
            toggleSidebar();
            break;
        case 'settings':
            switchView('settings');
            break;
    }
}

// Modal functionality
function initializeModals() {
    // Close buttons for all modals
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) {
                hideModal(modal.id);
            }
        });
    });
    
    // Close modal on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideModal(modal.id);
            }
        });
    });
    
    // New project modal
    const cancelBtn = document.getElementById('cancel-project');
    const createBtn = document.getElementById('create-project-btn');
    const browseBtn = document.getElementById('browse-location');
    
    cancelBtn?.addEventListener('click', () => hideModal('new-project-modal'));
    createBtn?.addEventListener('click', async () => await createProject());
    
    browseBtn?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            document.getElementById('project-location').value = selectedPath;
        }
    });
    
    // Search modal
    document.getElementById('search-input')?.addEventListener('input', async (e) => {
        const query = e.target.value;
        if (query.length > 2) {
            await searchProjects(query);
        }
    });
}

// Quick actions
function initializeQuickActions() {
    document.getElementById('new-project-btn')?.addEventListener('click', () => {
        showModal('new-project-modal');
    });
    
    document.getElementById('open-folder-btn')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            ipcRenderer.invoke('open-in-vscode', selectedPath);
        }
    });
    
    document.getElementById('clone-repo-btn')?.addEventListener('click', () => {
        showModal('clone-modal');
    });
    
    document.getElementById('create-project')?.addEventListener('click', () => {
        showModal('new-project-modal');
    });
    
    document.getElementById('change-workspace')?.addEventListener('click', async () => {
        const selectedPath = await ipcRenderer.invoke('select-folder');
        if (selectedPath) {
            workspacePath = selectedPath;
            document.getElementById('workspace-path').textContent = selectedPath;
            updateStatusMessage('Workspace changed');
        }
    });
}

// Templates
function initializeTemplates() {
    const templateCards = document.querySelectorAll('.template-card');
    
    templateCards.forEach(card => {
        card.addEventListener('click', () => {
            const template = card.dataset.template;
            showModal('new-project-modal');
            document.getElementById('project-type').value = template;
        });
    });
}

// Keyboard shortcuts
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', async (e) => {
        // Ctrl+N - New project
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            showModal('new-project-modal');
        }
        
        // Ctrl+O - Open project
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            document.getElementById('open-project-menu').click();
        }
        
        // Ctrl+F - Find projects
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            showModal('search-modal');
        }
        
        // Ctrl+S - Save workspace
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            await saveWorkspace();
        }
        
        // Ctrl+, - Settings
        if (e.ctrlKey && e.key === ',') {
            e.preventDefault();
            switchView('settings');
        }
        
        // Ctrl+B - Toggle sidebar
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
        
        // Ctrl+Shift+P - Command palette
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            showModal('command-palette-modal');
        }
        
        // Ctrl+` - Terminal
        if (e.ctrlKey && e.key === '`') {
            e.preventDefault();
            document.getElementById('terminal-menu').click();
        }
        
        // F5 - Run project
        if (e.key === 'F5') {
            e.preventDefault();
            await runProject();
        }
        
        // F11 - Fullscreen
        if (e.key === 'F11') {
            e.preventDefault();
            document.getElementById('fullscreen-menu').click();
        }
        
        // Escape - Close modal
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.modal.show');
            modals.forEach(modal => {
                modal.classList.remove('show');
            });
        }
    });
}

// Create project
async function createProject() {
    const name = document.getElementById('project-name').value.trim();
    const type = document.getElementById('project-type').value;
    const description = document.getElementById('project-description').value.trim();
    const location = document.getElementById('project-location').value || workspacePath;
    const initGit = document.getElementById('init-git').checked;

    if (!name) {
        showNotification('Please enter a project name', 'error');
        return;
    }

    if (!type) {
        showNotification('Please select a project type', 'error');
        return;
    }

    // Show loading state
    const createBtn = document.getElementById('create-project-btn');
    const originalText = createBtn.innerHTML;
    createBtn.innerHTML = '<span class="spinner"></span> Creating...';
    createBtn.disabled = true;

    try {
        let result;

        // Check if it's one of the new advanced templates
        const advancedTemplates = ['react-app', 'node-api', 'python-app'];
        if (advancedTemplates.includes(type)) {
            // Use the new template system
            result = await ipcRenderer.invoke('create-from-template', type, name, location);
        } else {
            // Use the old project creation system
            result = await ipcRenderer.invoke('create-project', {
                name,
                type,
                description,
                path: location
            });

            // Initialize Git if requested (old system doesn't auto-init)
            if (result.success && initGit) {
                await ipcRenderer.invoke('init-git', result.path);
            }
        }

        if (result.success) {
            // Add to recent projects
            const project = {
                name,
                type,
                description,
                path: result.path,
                createdAt: new Date().toISOString()
            };

            await addToRecentProjects(project);

            showNotification(`Project "${name}" created successfully!`, 'success');
            hideModal('new-project-modal');

            // Clear form
            document.getElementById('project-name').value = '';
            document.getElementById('project-type').value = '';
            document.getElementById('project-description').value = '';
            document.getElementById('project-location').value = '';

            // Reload recent projects
            await loadRecentProjects();

            // Set as current project
            currentProject = project;

            // Reload projects dropdown
            await loadProjectsIntoDropdown();
        } else {
            showNotification(`Failed to create project: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error creating project: ${error.message}`, 'error');
    } finally {
        createBtn.innerHTML = originalText;
        createBtn.disabled = false;
    }
}

// Load settings
async function loadSettings() {
    appSettings = await ipcRenderer.invoke('get-settings');
    
    // Apply settings
    if (appSettings.theme) {
        applyTheme(appSettings.theme);
        if (document.getElementById('theme-select')) {
            document.getElementById('theme-select').value = appSettings.theme;
        }
    }
    
    if (appSettings.fontSize) {
        document.documentElement.style.setProperty('font-size', `${appSettings.fontSize}px`);
        if (document.getElementById('font-size')) {
            document.getElementById('font-size').value = appSettings.fontSize;
            document.getElementById('font-size-value').textContent = `${appSettings.fontSize}px`;
        }
    }
    
    // Load other settings into UI
    if (document.getElementById('default-project-path')) {
        document.getElementById('default-project-path').value = appSettings.defaultProjectPath || '';
    }
    if (document.getElementById('auto-save')) {
        document.getElementById('auto-save').checked = appSettings.autoSave;
    }
    if (document.getElementById('open-in-vscode')) {
        document.getElementById('open-in-vscode').checked = appSettings.openInVSCode;
    }
    if (document.getElementById('terminal-app')) {
        document.getElementById('terminal-app').value = appSettings.terminalApp || 'cmd';
    }
}

// Save settings with validation
async function saveSettings() {
    // Show loading state
    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
        saveBtn.classList.add('saving');
        saveBtn.disabled = true;
    }

    // Clear previous errors
    document.querySelectorAll('.setting-item').forEach(item => {
        item.classList.remove('has-error', 'has-success');
        const errorMsg = item.querySelector('.setting-error-message');
        if (errorMsg) errorMsg.remove();
    });

    const errors = [];

    // Validate and collect settings
    const settings = {
        theme: document.getElementById('theme-select')?.value || 'dark',
        fontSize: parseInt(document.getElementById('font-size')?.value || 13),
        defaultProjectPath: document.getElementById('default-project-path')?.value || workspacePath,
        autoSave: document.getElementById('auto-save')?.checked,
        openInVSCode: document.getElementById('open-in-vscode')?.checked,
        terminalApp: document.getElementById('terminal-app')?.value || 'cmd',
        showWelcome: document.getElementById('show-welcome')?.checked,
        gitUsername: document.getElementById('git-username')?.value || '',
        gitEmail: document.getElementById('git-email')?.value || '',
        recentProjectsLimit: parseInt(document.getElementById('recent-projects-limit')?.value || 10)
    };

    // Validate email if provided
    const gitEmailInput = document.getElementById('git-email');
    if (gitEmailInput && settings.gitEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(settings.gitEmail)) {
            errors.push({
                element: gitEmailInput,
                message: 'Invalid email format'
            });
        }
    }

    // Validate recent projects limit
    const recentLimitInput = document.getElementById('recent-projects-limit');
    if (recentLimitInput) {
        const limit = settings.recentProjectsLimit;
        if (limit < 5 || limit > 50) {
            errors.push({
                element: recentLimitInput,
                message: 'Must be between 5 and 50'
            });
        }
    }

    // Validate font size
    const fontSizeInput = document.getElementById('font-size');
    if (fontSizeInput) {
        const fontSize = settings.fontSize;
        if (fontSize < 10 || fontSize > 20) {
            errors.push({
                element: fontSizeInput,
                message: 'Font size must be between 10 and 20'
            });
        }
    }

    // Display errors if any
    if (errors.length > 0) {
        errors.forEach(error => {
            const settingItem = error.element.closest('.setting-item');
            if (settingItem) {
                settingItem.classList.add('has-error');
                const errorMsg = document.createElement('div');
                errorMsg.className = 'setting-error-message';
                errorMsg.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.message}`;
                settingItem.appendChild(errorMsg);
            }
        });
        showNotification('Please fix validation errors', 'error');

        // Remove loading state
        if (saveBtn) {
            saveBtn.classList.remove('saving');
            saveBtn.disabled = false;
        }
        return;
    }

    // Save settings
    try {
        const success = await ipcRenderer.invoke('save-settings', settings);
        if (success) {
            appSettings = settings;

            // Show success feedback
            document.querySelectorAll('.setting-item').forEach(item => {
                if (item.querySelector('input, select')) {
                    item.classList.add('has-success');
                    setTimeout(() => item.classList.remove('has-success'), 2000);
                }
            });

            showNotification('Settings saved successfully', 'success');
        } else {
            showNotification('Failed to save settings', 'error');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('An error occurred while saving settings', 'error');
    } finally {
        // Remove loading state
        if (saveBtn) {
            saveBtn.classList.remove('saving');
            saveBtn.disabled = false;
        }
    }
}

// Apply theme
function applyTheme(theme) {
    document.body.classList.remove('light-theme', 'high-contrast');
    
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else if (theme === 'high-contrast') {
        document.body.classList.add('high-contrast');
    }
}

// Load workspace path
async function loadWorkspacePath() {
    workspacePath = await ipcRenderer.invoke('get-projects-path');
    document.getElementById('workspace-path').textContent = workspacePath;
    document.getElementById('project-location').value = workspacePath;
}

// Load recent projects
async function importProject() {
    showNotification('Importing project...', 'info');
    const result = await ipcRenderer.invoke('import-project');
    if (result.success) {
        await addToRecentProjects(result.project);
        await loadAllProjects(); // Refresh projects view
        showNotification(`Project "${result.project.name}" imported successfully!`, 'success');

        // Switch to projects view to show the imported project
        if (document.getElementById('welcome-view')?.classList.contains('active')) {
            switchView('projects');
        }
    }
}

async function loadRecentProjects() {
    const fs = require('fs');
    const path = require('path');
    let projects = await ipcRenderer.invoke('get-recent-projects');

    console.log('📦 Raw projects from storage:', projects.length);

    // Normalize and filter projects with aggressive deduplication
    const seenPaths = new Set();
    const validProjects = [];

    for (const project of projects) {
        if (!project || !project.path) {
            console.log('⚠️ Skipping invalid project:', project);
            continue;
        }

        // Super aggressive path normalization
        let normalizedPath = path.resolve(project.path);
        normalizedPath = normalizedPath.toLowerCase();
        normalizedPath = normalizedPath.replace(/\\/g, '/');
        normalizedPath = normalizedPath.replace(/\/$/, '');

        // Check if path exists
        try {
            fs.accessSync(project.path);

            // Check for duplicates
            if (seenPaths.has(normalizedPath)) {
                console.log('🔄 Duplicate detected:', project.name, normalizedPath);
                continue;
            }

            seenPaths.add(normalizedPath);
            validProjects.push({
                ...project,
                lastAccessed: project.lastAccessed || Date.now()
            });
            console.log('✅ Added:', project.name);

        } catch (error) {
            console.log(`❌ Skipping deleted project: ${project.path}`);
        }
    }

    console.log('📊 Valid projects:', validProjects.length, 'Removed:', projects.length - validProjects.length);

    // Sort by last accessed (most recent first)
    validProjects.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

    // Always save the cleaned list to persist deduplication
    console.log('💾 Saving cleaned projects list...');
    console.log('Projects to save:', validProjects.map(p => ({ name: p.name, path: p.path })));

    // Save using IPC (now fixed to use correct file)
    await ipcRenderer.invoke('save-recent-projects', validProjects);

    // Verify the save by reading it back
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
    const verifyProjects = await ipcRenderer.invoke('get-recent-projects');
    console.log('🔍 Verification - Projects after save:', verifyProjects.length);
    console.log('Verified projects:', verifyProjects.map(p => ({ name: p.name, path: p.path })));

    if (verifyProjects.length !== validProjects.length) {
        console.error('⚠️ WARNING: Save verification mismatch! Expected', validProjects.length, 'but got', verifyProjects.length);
    } else {
        console.log('✅ Save verified successfully - duplicates removed permanently');
    }

    recentProjects = validProjects;
    displayRecentProjects();
}

// Display recent projects
function displayRecentProjects() {
    const container = document.getElementById('recent-projects-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (recentProjects.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
                <i class="fas fa-folder-open" style="font-size: 48px; margin-bottom: 10px;"></i>
                <p>No recent projects</p>
                <p style="font-size: 12px; margin-top: 10px;">Create your first project to get started</p>
            </div>
        `;
        return;
    }
    
    recentProjects.slice(0, 6).forEach(project => {
        const projectCard = createProjectCard(project);
        container.appendChild(projectCard);
    });
}

// Create project card element
function createProjectCard(project) {
    const fs = require('fs');
    const path = require('path');
    const card = document.createElement('div');
    card.className = 'project-card-modern';

    // Check if project has Git
    const hasGit = fs.existsSync(path.join(project.path, '.git'));

    // Get last accessed time
    const lastAccessed = project.lastAccessed || Date.now();
    const timeAgo = getTimeAgo(lastAccessed);

    // Icon and color mapping
    const typeConfig = {
        electron: { icon: 'fab fa-react', color: '#61dafb', label: 'Electron' },
        python: { icon: 'fab fa-python', color: '#3776ab', label: 'Python' },
        web: { icon: 'fab fa-html5', color: '#e34f26', label: 'Web' },
        nodejs: { icon: 'fab fa-node-js', color: '#339933', label: 'Node.js' },
        react: { icon: 'fab fa-react', color: '#61dafb', label: 'React' },
        vue: { icon: 'fab fa-vuejs', color: '#4fc08d', label: 'Vue.js' },
        cpp: { icon: 'fas fa-code', color: '#00599c', label: 'C++' },
        java: { icon: 'fab fa-java', color: '#007396', label: 'Java' },
        empty: { icon: 'fas fa-folder', color: '#dcb67a', label: 'Empty' }
    };

    const config = typeConfig[project.type] || typeConfig.empty;

    // Create a safe project object for passing to functions
    const safeProject = {
        name: project.name,
        path: project.path,
        type: project.type
    };

    card.innerHTML = `
        <div class="project-card-accent" style="background: ${config.color}"></div>
        <div class="project-card-content">
            <div class="project-card-top">
                <div class="project-icon-modern" style="background: ${config.color}15; color: ${config.color}">
                    <i class="${config.icon}"></i>
                </div>
                <div class="project-badges">
                    ${hasGit ? '<span class="project-badge git-badge"><i class="fab fa-git-alt"></i></span>' : ''}
                </div>
            </div>
            <div class="project-details">
                <h3 class="project-name" title="${project.name}">${project.name}</h3>
                <div class="project-meta">
                    <span class="project-type-badge" style="background: ${config.color}20; color: ${config.color}">
                        ${config.label}
                    </span>
                    <span class="project-time">
                        <i class="far fa-clock"></i> ${timeAgo}
                    </span>
                </div>
                <div class="project-path-modern" title="${project.path}">
                    <i class="fas fa-folder-open"></i>
                    ${truncatePath(project.path, 35)}
                </div>
            </div>
            <div class="project-actions-modern">
                <button class="project-btn project-btn-primary" data-open-vscode>
                    <i class="fas fa-code"></i>
                    <span>Open</span>
                </button>
                <button class="project-btn project-btn-secondary" data-open-explorer>
                    <i class="fas fa-external-link-alt"></i>
                </button>
                <button class="project-btn project-btn-danger" data-delete-project>
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        </div>
    `;

    // Add click handler to open in VS Code
    card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
            openInVscode(project.path);
            updateProjectAccessTime(project.path);
        }
    });

    // Add button handlers
    const openBtn = card.querySelector('[data-open-vscode]');
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInVscode(project.path);
        updateProjectAccessTime(project.path);
    });

    const explorerBtn = card.querySelector('[data-open-explorer]');
    explorerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInExplorer(project.path);
    });

    const deleteBtn = card.querySelector('[data-delete-project]');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteProjectModal(safeProject);
    });

    // Add context menu handler
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showProjectContextMenu(e, project);
    });

    return card;
}

// Show context menu for project card
function showProjectContextMenu(event, project) {
    // Remove existing context menu if any
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="open">
            <i class="fas fa-code"></i>
            <span>Open in VS Code</span>
        </div>
        <div class="context-menu-item" data-action="explorer">
            <i class="fas fa-folder-open"></i>
            <span>Open in File Explorer</span>
        </div>
        <div class="context-menu-item" data-action="terminal">
            <i class="fas fa-terminal"></i>
            <span>Open in Terminal</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="copy-path">
            <i class="fas fa-copy"></i>
            <span>Copy Path</span>
        </div>
        <div class="context-menu-item" data-action="copy-name">
            <i class="fas fa-file-signature"></i>
            <span>Copy Name</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="remove">
            <i class="fas fa-times"></i>
            <span>Remove from Recent</span>
        </div>
        <div class="context-menu-item context-menu-danger" data-action="delete">
            <i class="fas fa-trash-alt"></i>
            <span>Delete Project</span>
        </div>
    `;

    // Position menu
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }

    // Handle menu item clicks
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.getAttribute('data-action');
            handleContextMenuAction(action, project);
            menu.remove();
        });
    });

    // Close menu on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

// Handle context menu actions
async function handleContextMenuAction(action, project) {
    switch (action) {
        case 'open':
            openInVscode(project.path);
            updateProjectAccessTime(project.path);
            break;
        case 'explorer':
            openInExplorer(project.path);
            break;
        case 'terminal':
            await ipcRenderer.invoke('open-terminal', project.path);
            showNotification('Opening terminal...', 'info');
            break;
        case 'copy-path':
            navigator.clipboard.writeText(project.path);
            showNotification('Path copied to clipboard', 'success');
            break;
        case 'copy-name':
            navigator.clipboard.writeText(project.name);
            showNotification('Name copied to clipboard', 'success');
            break;
        case 'remove':
            await removeFromRecent(project.path);
            break;
        case 'delete':
            showDeleteProjectModal(project);
            break;
    }
}

// Remove project from recent list
async function removeFromRecent(projectPath) {
    const index = recentProjects.findIndex(p => p.path === projectPath);
    if (index !== -1) {
        recentProjects.splice(index, 1);
        await ipcRenderer.invoke('save-recent-projects', recentProjects);
        displayRecentProjects();
        showNotification('Removed from recent projects', 'success');
    }
}

// Helper function to get time ago string
function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
}

// Helper function to truncate path
function truncatePath(fullPath, maxLength) {
    if (fullPath.length <= maxLength) return fullPath;

    const parts = fullPath.split(path.sep);
    if (parts.length <= 2) return fullPath;

    return '...' + path.sep + parts.slice(-2).join(path.sep);
}

// Update project access time
async function updateProjectAccessTime(projectPath) {
    const projectIndex = recentProjects.findIndex(p => p.path === projectPath);
    if (projectIndex !== -1) {
        recentProjects[projectIndex].lastAccessed = Date.now();
        // Move to front
        const [project] = recentProjects.splice(projectIndex, 1);
        recentProjects.unshift(project);
        await ipcRenderer.invoke('save-recent-projects', recentProjects);
        displayRecentProjects();
    }
}

// Add project to recent (avoiding duplicates)
async function addToRecentProjects(project) {
    const path = require('path');

    // Use same aggressive normalization
    let normalizedPath = path.resolve(project.path);
    normalizedPath = normalizedPath.toLowerCase();
    normalizedPath = normalizedPath.replace(/\\/g, '/');
    normalizedPath = normalizedPath.replace(/\/$/, '');

    console.log('➕ Adding project:', project.name, '|', normalizedPath);

    // Remove any existing entry with the same normalized path
    const beforeLength = recentProjects.length;
    recentProjects = recentProjects.filter(p => {
        let existingPath = path.resolve(p.path);
        existingPath = existingPath.toLowerCase();
        existingPath = existingPath.replace(/\\/g, '/');
        existingPath = existingPath.replace(/\/$/, '');

        if (existingPath === normalizedPath) {
            console.log('🗑️ Removing existing entry:', p.name);
            return false;
        }
        return true;
    });

    if (beforeLength !== recentProjects.length) {
        console.log('✅ Removed existing duplicate before adding');
    }

    // Add to front with lastAccessed timestamp
    recentProjects.unshift({
        ...project,
        lastAccessed: Date.now()
    });

    // Keep only last 50 projects
    recentProjects = recentProjects.slice(0, 50);

    console.log('💾 Saving', recentProjects.length, 'projects...');
    // Save and refresh
    await ipcRenderer.invoke('save-recent-projects', recentProjects);
    displayRecentProjects();
}

// Load all projects
async function loadAllProjects() {
    const projectsList = document.getElementById('all-projects-list');
    if (!projectsList) return;

    projectsList.innerHTML = '<div class="loading"><span class="spinner"></span><span class="loading-text">Loading projects...</span></div>';

    const projects = await ipcRenderer.invoke('search-projects', workspacePath, '');

    if (projects.length === 0) {
        projectsList.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                <i class="fas fa-folder-open" style="font-size: 48px; margin-bottom: 10px;"></i>
                <p>No projects found in workspace</p>
                <p style="font-size: 12px; margin-top: 10px;">Create a new project or change workspace location</p>
            </div>
        `;
    } else {
        projectsList.innerHTML = '';
        projectsList.className = 'projects-list';
        projects.forEach(project => {
            const card = createProjectCard(project);
            projectsList.appendChild(card);
        });
    }

    // Update project stats after loading projects
    await updateProjectStats();
}

// Search projects
async function searchProjects(query) {
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    
    const results = await ipcRenderer.invoke('search-projects', workspacePath, query);
    
    resultsContainer.innerHTML = '';
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No projects found</p>';
    } else {
        results.forEach(project => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `
                <h4>${project.name}</h4>
                <p>${project.path}</p>
            `;
            item.addEventListener('click', () => {
                ipcRenderer.invoke('open-in-vscode', project.path);
                hideModal('search-modal');
            });
            resultsContainer.appendChild(item);
        });
    }
}

// Git operations
async function initializeGit() {
    if (!currentProject) {
        showNotification('Please select a project first', 'error');
        return;
    }
    
    const result = await ipcRenderer.invoke('init-git', currentProject.path);
    if (result.success) {
        showNotification('Git repository initialized', 'success');
        await refreshGitStatus();
    } else {
        showNotification(`Failed to initialize Git: ${result.error}`, 'error');
    }
}

// Debounced refresh with lazy rendering
let gitRefreshTimeout = null;
async function refreshGitStatus() {
    // If changes tab is not active, mark for later refresh
    if (currentGitTab !== 'changes') {
        gitStatusNeedsRefresh = true;
        return;
    }

    // Debounce rapid refresh calls
    if (gitRefreshTimeout) {
        clearTimeout(gitRefreshTimeout);
    }

    gitRefreshTimeout = setTimeout(() => {
        refreshGitStatusNow();
    }, 150);
}

async function refreshGitStatusNow() {
    gitStatusNeedsRefresh = false;

    const statusContainer = document.getElementById('git-status');

    if (!statusContainer) {
        console.error('[GIT] git-status element not found in DOM');
        return;
    }

    if (!currentProject) {
        statusContainer.innerHTML = `
            <div class="git-empty-state">
                <i class="fab fa-git-alt" style="font-size: 48px; color: var(--text-secondary); opacity: 0.3;"></i>
                <p>No repository loaded</p>
                <p class="git-hint">Select a project to view git status</p>
            </div>
        `;
        return;
    }

    const result = await ipcRenderer.invoke('git-status', currentProject.path);

    if (!result.success) {
        statusContainer.innerHTML = `
            <div class="git-not-initialized">
                <i class="fab fa-git-alt" style="font-size: 48px; color: var(--warning); opacity: 0.5;"></i>
                <p style="color: var(--text-primary); margin: 16px 0 8px 0; font-weight: 500;">Not a git repository</p>
                <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px;">Initialize git to start version control</p>
                <button class="btn-primary" onclick="initializeGit()">
                    <i class="fas fa-play"></i> Initialize Git
                </button>
            </div>
        `;
        return;
    }

    if (!result.output || result.output.trim() === '') {
        statusContainer.innerHTML = `
            <div class="git-clean-state">
                <i class="fas fa-check-circle" style="font-size: 48px; color: var(--success); opacity: 0.6;"></i>
                <p style="color: var(--text-primary); margin: 16px 0 4px 0; font-weight: 500;">Working tree clean</p>
                <p style="color: var(--text-secondary); font-size: 13px;">No changes to commit</p>
            </div>
        `;

        // Update file counts
        document.getElementById('git-modified').textContent = '0';

        // Load branches even when clean
        await loadBranches();
        return;
    }

    // Parse git status output
    const files = result.output.split('\n').filter(line => line.trim());
    const stagedFiles = [];
    const unstagedFiles = [];
    const untrackedFiles = [];

    files.forEach(file => {
        const statusCode = file.substring(0, 2);
        const filename = file.substring(3).trim();

        const fileInfo = {
            filename,
            statusCode,
            status: '',
            icon: '',
            color: ''
        };

        // Parse status codes (XY format: X = staged, Y = unstaged)
        const staged = statusCode[0];
        const unstaged = statusCode[1];

        if (staged !== ' ' && staged !== '?') {
            // File is staged
            if (staged === 'M') {
                fileInfo.status = 'Modified';
                fileInfo.icon = 'fa-edit';
                fileInfo.color = '#ce9178';
            } else if (staged === 'A') {
                fileInfo.status = 'Added';
                fileInfo.icon = 'fa-plus';
                fileInfo.color = '#4ec9b0';
            } else if (staged === 'D') {
                fileInfo.status = 'Deleted';
                fileInfo.icon = 'fa-trash';
                fileInfo.color = '#f48771';
            } else if (staged === 'R') {
                fileInfo.status = 'Renamed';
                fileInfo.icon = 'fa-exchange-alt';
                fileInfo.color = '#dcdcaa';
            }
            stagedFiles.push({...fileInfo});
        }

        if (unstaged !== ' ') {
            // File has unstaged changes
            if (unstaged === 'M') {
                fileInfo.status = 'Modified';
                fileInfo.icon = 'fa-edit';
                fileInfo.color = '#ce9178';
            } else if (unstaged === 'D') {
                fileInfo.status = 'Deleted';
                fileInfo.icon = 'fa-trash';
                fileInfo.color = '#f48771';
            }

            if (statusCode === '??') {
                // Untracked file
                fileInfo.status = 'Untracked';
                fileInfo.icon = 'fa-file';
                fileInfo.color = '#858585';
                untrackedFiles.push({...fileInfo});
            } else {
                unstagedFiles.push({...fileInfo});
            }
        }
    });

    // Helper function to group files by folder (root level only)
    function groupFilesByFolder(files) {
        const grouped = {};
        files.forEach(file => {
            const parts = file.filename.split('/');
            let folder = 'Root';

            if (parts.length > 1) {
                // Only use the FIRST folder in the path (root level)
                folder = parts[0];
            }

            if (!grouped[folder]) {
                grouped[folder] = [];
            }
            grouped[folder].push(file);
        });
        return grouped;
    }

    // Helper function to render files with optional grouping
    function renderFileList(files, type, groupByFolder = false) {
        if (files.length === 0) return '';

        let html = '';

        if (groupByFolder) {
            // Group by folder
            const grouped = groupFilesByFolder(files);
            const folders = Object.keys(grouped).sort();

            // Separate root files from folder files
            const rootFiles = grouped['Root'] || [];
            const actualFolders = folders.filter(f => f !== 'Root');

            // Render actual folders FIRST as collapsible groups
            actualFolders.forEach(folder => {
                const folderFiles = grouped[folder];
                const folderId = `folder-${type}-${folder.replace(/[^a-zA-Z0-9]/g, '-')}`;

                html += `
                    <div class="git-folder-group">
                        <div class="git-folder-header">
                            <i class="fas fa-chevron-right git-folder-icon" id="${folderId}-icon" onclick="toggleFolder('${folderId}')"></i>
                            <input type="checkbox" class="git-folder-checkbox"
                                   data-folder-id="${folderId}"
                                   data-type="${type}"
                                   onchange="toggleFolderSelection('${folderId}', '${type}', this.checked)"
                                   onclick="event.stopPropagation()"
                                   title="Select all files in this folder">
                            <i class="fas fa-folder" style="color: #dcb67a;" onclick="toggleFolder('${folderId}')"></i>
                            <span class="git-folder-name" onclick="toggleFolder('${folderId}')">${folder}</span>
                            <span class="git-count-badge" onclick="toggleFolder('${folderId}')">${folderFiles.length}</span>
                        </div>
                        <div class="git-folder-files" id="${folderId}" style="display: none;">
                `;

                folderFiles.forEach(file => {
                    html += renderFileItem(file, type);
                });

                html += `
                        </div>
                    </div>
                `;
            });

            // Render root files AFTER folders (without folder wrapper)
            rootFiles.forEach(file => {
                html += renderFileItem(file, type);
            });
        } else {
            // Flat list when grouping disabled
            files.forEach(file => {
                html += renderFileItem(file, type);
            });
        }

        return html;
    }

    // Helper function to render a single file item
    function renderFileItem(file, type) {
        const checkboxClass = type === 'staged' ? 'staged-checkbox' : 'unstaged-checkbox';
        const stageButton = type === 'staged'
            ? `<button class="btn-icon-sm" onclick="event.stopPropagation(); unstageFile('${file.filename}')" title="Unstage">
                   <i class="fas fa-minus"></i>
               </button>`
            : `<button class="btn-icon-sm" onclick="event.stopPropagation(); stageFile('${file.filename}')" title="Stage">
                   <i class="fas fa-plus"></i>
               </button>
               <button class="btn-icon-sm" onclick="event.stopPropagation(); discardFile('${file.filename}')" title="Discard">
                   <i class="fas fa-undo"></i>
               </button>`;

        return `
            <div class="git-file-item ${type}" data-filename="${file.filename}">
                <input type="checkbox" class="git-file-checkbox ${checkboxClass}"
                       onchange="update${type === 'staged' ? 'Staged' : 'Unstaged'}SelectionState()"
                       onclick="event.stopPropagation()">
                <div class="git-file-info" onclick="viewFileDiff('${file.filename}')">
                    <i class="fas ${file.icon}" style="color: ${file.color};"></i>
                    <span class="git-file-name">${file.filename.split('/').pop()}</span>
                    ${file.filename.includes('/') ? `<span class="git-file-path">${file.filename.split('/').slice(0, -1).join('/')}/</span>` : ''}
                    <span class="git-file-status" style="color: ${file.color};">${file.status}</span>
                </div>
                <div class="git-file-actions">
                    ${stageButton}
                </div>
            </div>
        `;
    }

    // Build improved UI
    let html = '';

    // Staged changes section
    html += `
        <div class="git-changes-group">
            <div class="git-changes-group-header">
                <div class="git-group-title">
                    ${stagedFiles.length > 0 ? '<input type="checkbox" class="git-select-all" onchange="toggleSelectAllStaged(this)" title="Select All">' : ''}
                    <i class="fas fa-circle" style="color: #4ec9b0;"></i>
                    <span>Staged Changes</span>
                    <span class="git-count-badge">${stagedFiles.length}</span>
                </div>
                <div class="git-group-actions">
                    ${stagedFiles.length > 0 ? '<button class="btn-icon" onclick="unstageSelected()" title="Unstage Selected"><i class="fas fa-minus"></i></button>' : ''}
                    ${stagedFiles.length > 0 ? '<button class="btn-icon" onclick="unstageAll()" title="Unstage All"><i class="fas fa-minus-circle"></i></button>' : ''}
                </div>
            </div>
            <div class="git-files-list">
    `;

    if (stagedFiles.length === 0) {
        html += '<div class="git-changes-empty">No staged changes</div>';
    } else {
        html += renderFileList(stagedFiles, 'staged', true);
    }

    html += `
            </div>
        </div>
    `;

    // Unstaged changes section
    html += `
        <div class="git-changes-group">
            <div class="git-changes-group-header">
                <div class="git-group-title">
                    ${(unstagedFiles.length + untrackedFiles.length) > 0 ? '<input type="checkbox" class="git-select-all" onchange="toggleSelectAllUnstaged(this)" title="Select All">' : ''}
                    <i class="fas fa-circle" style="color: #ce9178;"></i>
                    <span>Changes</span>
                    <span class="git-count-badge">${unstagedFiles.length + untrackedFiles.length}</span>
                </div>
                <div class="git-group-actions">
                    ${(unstagedFiles.length + untrackedFiles.length) > 0 ? '<button class="btn-icon" onclick="stageSelected()" title="Stage Selected"><i class="fas fa-plus"></i></button>' : ''}
                    ${(unstagedFiles.length + untrackedFiles.length) > 0 ? '<button class="btn-icon" onclick="stageAll()" title="Stage All"><i class="fas fa-plus-circle"></i></button>' : ''}
                </div>
            </div>
            <div class="git-files-list">
    `;

    if (unstagedFiles.length === 0 && untrackedFiles.length === 0) {
        html += '<div class="git-changes-empty">No unstaged changes</div>';
    } else {
        html += renderFileList([...unstagedFiles, ...untrackedFiles], 'unstaged', true);
    }

    html += `
            </div>
        </div>
    `;

    // Use requestAnimationFrame for smoother rendering
    requestAnimationFrame(() => {
        statusContainer.innerHTML = html;

        // Update modified files count
        const modifiedEl = document.getElementById('git-modified');
        if (modifiedEl) {
            modifiedEl.textContent = files.length;
        }
    });

    // Load branches asynchronously
    loadBranches();
}

// Project operations
async function buildProject() {
    if (!currentProject) {
        showNotification('Please select a project first', 'error');
        return;
    }
    
    let command = '';
    switch(currentProject.type) {
        case 'nodejs':
        case 'react':
        case 'vue':
        case 'electron':
            command = 'npm run build';
            break;
        case 'python':
            command = 'python setup.py build';
            break;
        case 'cpp':
            command = 'make build';
            break;
        case 'java':
            command = 'mvn compile';
            break;
        default:
            showNotification('Build not configured for this project type', 'error');
            return;
    }
    
    showNotification('Building project...', 'success');
    const result = await ipcRenderer.invoke('run-command', command, currentProject.path);
    
    if (result.success) {
        showNotification('Build completed successfully', 'success');
    } else {
        showNotification(`Build failed: ${result.error}`, 'error');
    }
}

async function runProject() {
    if (!currentProject) {
        showNotification('Please select a project first', 'error');
        return;
    }
    
    let command = '';
    switch(currentProject.type) {
        case 'nodejs':
        case 'react':
        case 'vue':
        case 'electron':
            command = 'npm start';
            break;
        case 'python':
            command = 'python main.py';
            break;
        case 'cpp':
            command = './main';
            break;
        case 'java':
            command = 'java Main';
            break;
        case 'web':
            // Open in browser
            await ipcRenderer.invoke('open-external', `file://${currentProject.path}/index.html`);
            return;
        default:
            showNotification('Run not configured for this project type', 'error');
            return;
    }
    
    showNotification('Running project...', 'success');
    await ipcRenderer.invoke('open-terminal', currentProject.path);
    await ipcRenderer.invoke('run-command', command, currentProject.path);
}

async function installDependencies() {
    if (!currentProject) {
        showNotification('Please select a project first', 'error');
        return;
    }
    
    let command = '';
    switch(currentProject.type) {
        case 'nodejs':
        case 'react':
        case 'vue':
        case 'electron':
            command = 'npm install';
            break;
        case 'python':
            command = 'pip install -r requirements.txt';
            break;
        case 'java':
            command = 'mvn install';
            break;
        default:
            showNotification('Dependency installation not configured for this project type', 'error');
            return;
    }
    
    showNotification('Installing dependencies...', 'success');
    const result = await ipcRenderer.invoke('run-command', command, currentProject.path);
    
    if (result.success) {
        showNotification('Dependencies installed successfully', 'success');
    } else {
        showNotification(`Installation failed: ${result.error}`, 'error');
    }
}

// Utility functions
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const contentArea = document.querySelector('.content-area');
    
    if (sidebar.style.display === 'none') {
        sidebar.style.display = 'flex';
        contentArea.style.marginLeft = '60px';
    } else {
        sidebar.style.display = 'none';
        contentArea.style.marginLeft = '0';
    }
}

function toggleStatusBar() {
    const statusBar = document.querySelector('.status-bar');
    
    if (statusBar.style.display === 'none') {
        statusBar.style.display = 'flex';
    } else {
        statusBar.style.display = 'none';
    }
}

async function saveWorkspace() {
    // Save current workspace configuration
    const workspace = {
        path: workspacePath,
        recentProjects: recentProjects,
        currentProject: currentProject
    };
    
    // In a real app, this would save to a file
    localStorage.setItem('workspace', JSON.stringify(workspace));
    showNotification('Workspace saved', 'success');
}

function showProjectSettings() {
    // Show project-specific settings
    switchView('settings');
    showNotification(`Settings for ${currentProject.name}`, 'success');
}

async function checkVSCodeInstallation() {
    const isInstalled = await ipcRenderer.invoke('check-vscode');
    if (!isInstalled) {
        showNotification('VS Code not found. Please install it for the best experience.', 'warning');
    }
}

// Format project type
function formatProjectType(type) {
    const types = {
        electron: 'Electron Application',
        python: 'Python Project',
        web: 'Web Project',
        nodejs: 'Node.js Application',
        react: 'React Application',
        vue: 'Vue.js Application',
        cpp: 'C++ Project',
        java: 'Java Project',
        empty: 'Empty Project'
    };
    return types[type] || type;
}

// Global functions for onclick handlers
window.openInVscode = async (projectPath) => {
    await ipcRenderer.invoke('open-in-vscode', projectPath);
    showNotification('Opening in VS Code...', 'success');
};

window.openInExplorer = async (projectPath) => {
    await ipcRenderer.invoke('open-in-explorer', projectPath);
};

window.setCurrentProject = (path, name, type) => {
    currentProject = { path, name, type };
    document.getElementById('git-current-repo').innerHTML = `
        <p><strong>Project:</strong> ${name}</p>
        <p><strong>Path:</strong> ${path}</p>
    `;
    showNotification(`Selected project: ${name}`, 'success');
    
    // Refresh git status if on git view
    if (currentView === 'git') {
        refreshGitStatus();
    }
};

// Modal functions
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        
        // Focus first input or the command palette input
        setTimeout(() => {
            const input = modal.querySelector('input[type="text"]:not([readonly]), textarea') ||
                          modal.querySelector('#command-palette-input');
            if (input) {
                input.focus();
                if (modalId === 'command-palette-modal') {
                    input.value = '';
                    // Show all commands
                    document.querySelectorAll('.command-item').forEach(item => {
                        item.style.display = 'flex';
                    });
                }
            }
        }, 100);
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

// Notifications
function showNotification(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = toast.querySelector('i');
    
    toastMessage.textContent = message;
    
    // Update icon based on type
    if (type === 'error') {
        toastIcon.className = 'fas fa-exclamation-circle';
        toastIcon.style.color = 'var(--error)';
    } else if (type === 'warning') {
        toastIcon.className = 'fas fa-exclamation-triangle';
        toastIcon.style.color = 'var(--warning)';
    } else {
        toastIcon.className = 'fas fa-check-circle';
        toastIcon.style.color = 'var(--success)';
    }
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Update status message
function updateStatusMessage(message) {
    document.getElementById('status-message').textContent = message;
    
    setTimeout(() => {
        document.getElementById('status-message').textContent = 'Ready';
    }, 3000);
}

// Auto-update workspace path in project location
document.getElementById('project-name')?.addEventListener('input', (e) => {
    const projectName = e.target.value;
    const locationInput = document.getElementById('project-location');
    
    if (!locationInput.dataset.customPath) {
        locationInput.value = path.join(workspacePath, projectName);
    }
});

document.getElementById('project-location')?.addEventListener('input', (e) => {
    e.target.dataset.customPath = 'true';
});

// Clear recent projects
document.getElementById('clear-recent')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all recent projects?')) {
        recentProjects = [];
        await ipcRenderer.invoke('save-recent-project', []); // Clear the saved list
        displayRecentProjects();
        updateActivityStats();
        showNotification('Recent projects cleared', 'success');
    }
});

// Enhanced Projects View Logic
function initializeProjectsView() {
    // Project search
    document.getElementById('project-search')?.addEventListener('input', (e) => {
        filterProjects(e.target.value);
    });

    // Project sorting
    document.getElementById('project-sort')?.addEventListener('change', (e) => {
        sortProjects(e.target.value);
    });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterProjectsByType(tab.dataset.filter);
        });
    });

    // View toggle (grid/list)
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            toggleProjectsView(btn.dataset.view);
        });
    });

    // Update stats when view loads
    updateProjectStats();
}

function filterProjects(query) {
    const projectCards = document.querySelectorAll('#all-projects-list .project-card');
    const lowerQuery = query.toLowerCase();

    projectCards.forEach(card => {
        const name = card.querySelector('h3')?.textContent.toLowerCase() || '';
        const path = card.querySelector('.project-path')?.textContent.toLowerCase() || '';

        if (name.includes(lowerQuery) || path.includes(lowerQuery)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

function sortProjects(sortBy) {
    const projectsList = document.getElementById('all-projects-list');
    const projects = Array.from(projectsList.querySelectorAll('.project-card'));

    projects.sort((a, b) => {
        switch(sortBy) {
            case 'name':
                const nameA = a.querySelector('h3')?.textContent || '';
                const nameB = b.querySelector('h3')?.textContent || '';
                return nameA.localeCompare(nameB);
            case 'date':
                const dateA = a.dataset.modified || '0';
                const dateB = b.dataset.modified || '0';
                return parseInt(dateB) - parseInt(dateA);
            case 'type':
                const typeA = a.dataset.type || '';
                const typeB = b.dataset.type || '';
                return typeA.localeCompare(typeB);
            default:
                return 0;
        }
    });

    projects.forEach(project => projectsList.appendChild(project));
    showNotification(`Projects sorted by ${sortBy}`, 'info');
}

function filterProjectsByType(type) {
    const projectCards = document.querySelectorAll('#all-projects-list .project-card');

    projectCards.forEach(card => {
        if (type === 'all' || card.dataset.type === type) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });

    showNotification(`Filtered by: ${type}`, 'info');
}

function toggleProjectsView(viewType) {
    const projectsList = document.getElementById('all-projects-list');

    if (viewType === 'list') {
        projectsList.classList.remove('grid-view');
        projectsList.classList.add('list-view');
    } else {
        projectsList.classList.remove('list-view');
        projectsList.classList.add('grid-view');
    }
}

async function updateProjectStats() {
    try {
        const projectCards = document.querySelectorAll('#all-projects-list .project-card');
        const totalProjects = projectCards.length;

        // Count active projects (modified in last 7 days)
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        let activeProjects = 0;
        let gitProjects = 0;

        projectCards.forEach(card => {
            const modified = parseInt(card.dataset.modified || '0');
            if (modified > weekAgo) activeProjects++;
            if (card.dataset.hasGit === 'true') gitProjects++;
        });

        // Update stat displays in projects view
        const totalProjectsEl = document.getElementById('total-projects');
        const activeProjectsEl = document.getElementById('active-projects');
        const gitProjectsEl = document.getElementById('git-projects');

        if (totalProjectsEl) totalProjectsEl.textContent = totalProjects;
        if (activeProjectsEl) activeProjectsEl.textContent = activeProjects;
        if (gitProjectsEl) gitProjectsEl.textContent = gitProjects;

        // Update hero section stats
        const heroTotalProjects = document.getElementById('hero-total-projects');
        if (heroTotalProjects) heroTotalProjects.textContent = totalProjects;

        // Calculate total size (mock data for now)
        const estimatedSize = totalProjects * 50; // Rough estimate
        const totalSizeEl = document.getElementById('total-size');
        if (totalSizeEl) {
            totalSizeEl.textContent = estimatedSize >= 1024
                ? `${(estimatedSize / 1024).toFixed(1)} GB`
                : `${estimatedSize} MB`;
        }

        // Fetch and update GitHub repositories count if user is authenticated
        await updateGitHubReposCount();
    } catch (error) {
        console.error('Error updating project stats:', error);
    }
}

// Fetch GitHub repositories count using stored token
async function updateGitHubReposCount() {
    try {
        const token = localStorage.getItem('github_token');
        if (!token) {
            // No token, show 0
            const heroGitRepos = document.getElementById('hero-git-repos');
            if (heroGitRepos) heroGitRepos.textContent = '0';
            return;
        }

        // Fetch user data from GitHub API to get public_repos count
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (response.ok) {
            const userData = await response.json();
            const reposCount = userData.public_repos || 0;

            // Update hero section
            const heroGitRepos = document.getElementById('hero-git-repos');
            if (heroGitRepos) {
                heroGitRepos.textContent = reposCount;
            }

            // Update stored user data
            if (githubUserData) {
                githubUserData.public_repos = reposCount;
                localStorage.setItem('github_user', JSON.stringify(userData));
            }
        } else {
            // Token might be invalid, clear it
            if (response.status === 401) {
                localStorage.removeItem('github_token');
                localStorage.removeItem('github_user');
                githubUserData = null;
                updateGitHubAvatar();
            }

            const heroGitRepos = document.getElementById('hero-git-repos');
            if (heroGitRepos) heroGitRepos.textContent = '0';
        }
    } catch (error) {
        console.error('Error fetching GitHub repos count:', error);
        const heroGitRepos = document.getElementById('hero-git-repos');
        if (heroGitRepos) heroGitRepos.textContent = '0';
    }
}

// Enhanced Recent Activity View Logic
let activityLog = [];

function initializeRecentView() {
    // Activity filter
    document.getElementById('activity-filter')?.addEventListener('change', (e) => {
        filterActivities(e.target.value);
    });

    // Timeline period buttons
    document.querySelectorAll('.timeline-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.timeline-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterActivitiesByPeriod(btn.dataset.period);
        });
    });

    // Export activity
    document.getElementById('export-activity')?.addEventListener('click', () => {
        exportActivityLog();
    });

    // Load and display activities
    loadActivityLog();
    updateActivityStats();
}

function loadActivityLog() {
    // Initialize with some sample activities
    if (activityLog.length === 0) {
        activityLog = [
            {
                type: 'project',
                title: 'Opened Project',
                description: 'AppManager project opened in VS Code',
                timestamp: Date.now() - 1000 * 60 * 30, // 30 min ago
                meta: { project: 'AppManager' }
            },
            {
                type: 'git',
                title: 'Git Commit',
                description: 'Committed changes: "Enhanced UI components"',
                timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
                meta: { files: 5 }
            },
            {
                type: 'extension',
                title: 'Extension Installed',
                description: 'Code Formatter extension installed',
                timestamp: Date.now() - 1000 * 60 * 60 * 4, // 4 hours ago
                meta: { extension: 'Code Formatter' }
            },
            {
                type: 'settings',
                title: 'Settings Changed',
                description: 'Updated theme and appearance settings',
                timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
                meta: { category: 'Appearance' }
            }
        ];
    }

    displayActivities(activityLog);
}

function displayActivities(activities) {
    const container = document.getElementById('recent-activity-list');
    if (!container) return;

    if (activities.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No activities to display</p>';
        return;
    }

    container.innerHTML = activities.map(activity => {
        const timeAgo = formatTimeAgo(activity.timestamp);
        const icon = getActivityIcon(activity.type);

        return `
            <div class="timeline-item activity-type-${activity.type}">
                <div class="timeline-icon">
                    <i class="fas fa-${icon}"></i>
                </div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <span class="timeline-title">${activity.title}</span>
                        <span class="timeline-time">${timeAgo}</span>
                    </div>
                    <div class="timeline-description">${activity.description}</div>
                    ${activity.meta ? `
                        <div class="timeline-meta">
                            ${Object.entries(activity.meta).map(([key, value]) =>
                                `<span><i class="fas fa-tag"></i> ${key}: ${value}</span>`
                            ).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function getActivityIcon(type) {
    const icons = {
        project: 'folder-open',
        git: 'code-branch',
        extension: 'puzzle-piece',
        settings: 'cog'
    };
    return icons[type] || 'circle';
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days ago`;
    return `${Math.floor(seconds / 2592000)} months ago`;
}

function filterActivities(type) {
    if (type === 'all') {
        displayActivities(activityLog);
    } else {
        const filtered = activityLog.filter(activity => activity.type === type);
        displayActivities(filtered);
    }
}

function filterActivitiesByPeriod(period) {
    const now = Date.now();
    let cutoff;

    switch(period) {
        case 'today':
            cutoff = now - (24 * 60 * 60 * 1000);
            break;
        case 'week':
            cutoff = now - (7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            cutoff = now - (30 * 24 * 60 * 60 * 1000);
            break;
        case 'all':
        default:
            displayActivities(activityLog);
            return;
    }

    const filtered = activityLog.filter(activity => activity.timestamp >= cutoff);
    displayActivities(filtered);
    showNotification(`Showing activities from ${period}`, 'info');
}

function updateActivityStats() {
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

    const activitiesToday = activityLog.filter(a => a.timestamp >= dayAgo).length;
    const activitiesWeek = activityLog.filter(a => a.timestamp >= weekAgo).length;
    const projectsOpened = activityLog.filter(a => a.type === 'project').length;
    const gitOperations = activityLog.filter(a => a.type === 'git').length;

    document.getElementById('activities-today').textContent = activitiesToday;
    document.getElementById('activities-week').textContent = activitiesWeek;
    document.getElementById('projects-opened').textContent = projectsOpened;
    document.getElementById('git-operations').textContent = gitOperations;
}

function logActivity(type, title, description, meta = {}) {
    const activity = {
        type,
        title,
        description,
        timestamp: Date.now(),
        meta
    };

    activityLog.unshift(activity); // Add to beginning

    // Keep only last 100 activities
    if (activityLog.length > 100) {
        activityLog = activityLog.slice(0, 100);
    }

    // Update displays if on recent view
    if (currentView === 'recent') {
        displayActivities(activityLog);
        updateActivityStats();
    }
}

function exportActivityLog() {
    try {
        const exportData = {
            exported: new Date().toISOString(),
            totalActivities: activityLog.length,
            activities: activityLog
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `appmanager-activity-${Date.now()}.json`;
        link.click();

        showNotification('Activity log exported successfully', 'success');
    } catch (error) {
        console.error('Export failed:', error);
        showNotification('Failed to export activity log', 'error');
    }
}

// Delete Project Functionality
let projectToDelete = null;

function initializeDeleteProjectModal() {
    const deleteTypeRadios = document.querySelectorAll('input[name="delete-type"]');
    const confirmationSection = document.getElementById('delete-confirmation-section');
    const confirmInput = document.getElementById('delete-confirm-input');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const deleteBtnText = document.getElementById('delete-btn-text');

    // Handle delete type change
    deleteTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const deleteType = e.target.value;

            if (deleteType === 'delete') {
                // Show confirmation input for permanent deletion
                confirmationSection.style.display = 'block';
                deleteBtnText.textContent = 'Delete Permanently';
                confirmBtn.disabled = true;
                confirmInput.value = '';
            } else {
                // Hide confirmation for remove from app
                confirmationSection.style.display = 'none';
                deleteBtnText.textContent = 'Remove from App';
                confirmBtn.disabled = false;
            }
        });
    });

    // Handle confirmation input
    confirmInput?.addEventListener('input', (e) => {
        const deleteType = document.querySelector('input[name="delete-type"]:checked')?.value;

        if (deleteType === 'delete' && projectToDelete) {
            const inputValue = e.target.value.trim();
            const projectName = projectToDelete.name;

            // Enable button only if project name matches exactly
            confirmBtn.disabled = inputValue !== projectName;
        }
    });

    // Handle confirm delete button
    confirmBtn?.addEventListener('click', async () => {
        const deleteType = document.querySelector('input[name="delete-type"]:checked')?.value;

        if (!projectToDelete) {
            showNotification('No project selected for deletion', 'error');
            return;
        }

        if (deleteType === 'delete') {
            // Permanent deletion
            await deleteProjectPermanently(projectToDelete);
        } else {
            // Remove from app only
            await removeProjectFromApp(projectToDelete);
        }

        hideModal('delete-project-modal');
        resetDeleteModal();
    });
}

function showDeleteProjectModal(project) {
    projectToDelete = project;

    // Populate project info
    document.getElementById('delete-project-name').textContent = project.name;
    document.getElementById('delete-project-path').textContent = project.path;

    // Set confirmation name
    const confirmNameEl = document.getElementById('delete-confirm-name');
    if (confirmNameEl) {
        confirmNameEl.textContent = project.name;
    }

    // Reset modal state
    resetDeleteModal();

    // Show modal
    showModal('delete-project-modal');
}

function resetDeleteModal() {
    // Reset radio buttons
    const removeRadio = document.querySelector('input[name="delete-type"][value="remove"]');
    if (removeRadio) removeRadio.checked = true;

    // Hide confirmation section
    document.getElementById('delete-confirmation-section').style.display = 'none';

    // Reset confirmation input
    document.getElementById('delete-confirm-input').value = '';

    // Reset button
    document.getElementById('confirm-delete-btn').disabled = false;
    document.getElementById('delete-btn-text').textContent = 'Remove from App';
}

async function removeProjectFromApp(project) {
    try {
        // Remove from recent projects array
        recentProjects = recentProjects.filter(p => p.path !== project.path);

        // Save updated list
        await ipcRenderer.invoke('save-recent-projects', recentProjects);

        // Update UI
        displayRecentProjects();
        updateProjectStats();
        updateActivityStats();

        // Refresh all projects list if currently viewing projects
        if (currentView === 'projects') {
            await loadAllProjects();
        }

        // Log activity
        logActivity('project', 'Project Removed', `Removed ${project.name} from app`, {
            project: project.name
        });

        showNotification(`${project.name} removed from app`, 'success');
    } catch (error) {
        handleError(error, 'Remove Project');
    }
}

async function deleteProjectPermanently(project) {
    try {
        // Call IPC to delete files from disk
        const result = await ipcRenderer.invoke('delete-project-files', project.path);

        if (result.success) {
            // Remove from recent projects
            recentProjects = recentProjects.filter(p => p.path !== project.path);
            await ipcRenderer.invoke('save-recent-projects', recentProjects);

            // Update UI
            displayRecentProjects();
            updateProjectStats();
            updateActivityStats();

            // Refresh all projects list if currently viewing projects
            if (currentView === 'projects') {
                await loadAllProjects();
            }

            // Log activity
            logActivity('project', 'Project Deleted', `Permanently deleted ${project.name}`, {
                project: project.name,
                path: project.path
            });

            showNotification(`${project.name} permanently deleted`, 'success');
        } else {
            throw new Error(result.error || 'Failed to delete project files');
        }
    } catch (error) {
        handleError(error, 'Delete Project');
    }
}

// Enhanced error handling and validation
function validateProjectName(name) {
    if (!name || name.trim().length === 0) {
        return { valid: false, error: 'Project name cannot be empty' };
    }

    if (!/^[a-zA-Z0-9-_\s]+$/.test(name)) {
        return { valid: false, error: 'Project name contains invalid characters' };
    }

    if (name.length > 50) {
        return { valid: false, error: 'Project name is too long (max 50 characters)' };
    }

    return { valid: true };
}

function handleError(error, context = 'Operation') {
    console.error(`${context} error:`, error);

    const errorMessage = error.message || 'An unknown error occurred';
    showNotification(`${context} failed: ${errorMessage}`, 'error');

    // Log error activity
    logActivity('error', `${context} Failed`, errorMessage, {
        stack: error.stack?.split('\n')[0]
    });
}

// Wrap critical functions with error handling
const originalShowModal = showModal;
showModal = function(modalId) {
    try {
        originalShowModal(modalId);
        logActivity('ui', 'Modal Opened', `Opened ${modalId} modal`);
    } catch (error) {
        handleError(error, 'Show Modal');
    }
};

// IPC event listeners
ipcRenderer.on('theme-changed', (event, theme) => {
    applyTheme(theme);
});

ipcRenderer.on('show-command-palette', () => {
    showModal('command-palette-modal');
});

// =========================
// GitHub Authentication
// =========================
let githubUserData = null;

// Load saved GitHub token on startup
async function loadGitHubToken() {
    try {
        const savedToken = localStorage.getItem('github_token');
        if (savedToken) {
            await authenticateGitHub(savedToken, false);
        }
    } catch (error) {
        console.error('Failed to load GitHub token:', error);
    }
}

// GitHub account button click
document.getElementById('github-account-btn')?.addEventListener('click', () => {
    if (githubUserData) {
        // Show account info modal or context menu
        showGitHubAccountInfo();
    } else {
        showModal('github-login-modal');
    }
});

// Toggle token visibility
document.getElementById('toggle-token-visibility')?.addEventListener('click', function() {
    const tokenInput = document.getElementById('github-token-input');
    const icon = this.querySelector('i');

    if (tokenInput.type === 'password') {
        tokenInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        tokenInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
});

// GitHub login connect button
document.getElementById('github-connect-btn')?.addEventListener('click', async () => {
    const token = document.getElementById('github-token-input').value.trim();

    if (!token) {
        showNotification('Please enter your GitHub personal access token', 'error');
        return;
    }

    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        showNotification('Invalid token format. GitHub tokens start with "ghp_" or "github_pat_"', 'error');
        return;
    }

    await authenticateGitHub(token, true);
});

// GitHub login cancel button
document.querySelector('#github-login-modal .btn-github-cancel')?.addEventListener('click', () => {
    hideModal('github-login-modal');
    document.getElementById('github-token-input').value = '';
});

// Authenticate with GitHub
async function authenticateGitHub(token, showMessages = true) {
    try {
        if (showMessages) {
            showNotification('Connecting to GitHub...', 'info');
        }

        // Fetch user data from GitHub API
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid token. Please check your GitHub personal access token.');
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const userData = await response.json();

        // Save user data and token
        githubUserData = userData;
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_user', JSON.stringify(userData));

        // Update UI
        updateGitHubAvatar();

        // Update welcome screen stats with GitHub repos count
        await updateGitHubReposCount();

        // Close modal
        hideModal('github-login-modal');
        document.getElementById('github-token-input').value = '';

        if (showMessages) {
            showNotification(`Connected as ${userData.login}`, 'success');
            logActivity('github', 'GitHub Connected', `Authenticated as ${userData.login}`, {
                username: userData.login,
                name: userData.name
            });
        }
    } catch (error) {
        console.error('GitHub authentication error:', error);

        // Clear saved data on error
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_user');
        githubUserData = null;

        if (showMessages) {
            showNotification(error.message, 'error');
        }
    }
}

// Update GitHub avatar in sidebar
function updateGitHubAvatar() {
    const accountBtn = document.getElementById('github-account-btn');
    const avatar = document.getElementById('account-avatar');

    if (!accountBtn || !avatar) return;

    if (githubUserData && githubUserData.avatar_url) {
        accountBtn.classList.add('logged-in');
        avatar.innerHTML = `<img src="${githubUserData.avatar_url}" alt="${githubUserData.login}" />`;

        // Update tooltip
        const tooltip = accountBtn.querySelector('.tooltip');
        if (tooltip) {
            tooltip.textContent = `${githubUserData.login}`;
        }
    } else {
        accountBtn.classList.remove('logged-in');
        avatar.innerHTML = '<i class="fab fa-github"></i>';

        // Reset tooltip
        const tooltip = accountBtn.querySelector('.tooltip');
        if (tooltip) {
            tooltip.textContent = 'GitHub Account';
        }
    }
}

// Show GitHub account info (context menu or modal)
// Show GitHub Account Dashboard
function showGitHubAccountInfo() {
    if (!githubUserData) return;

    // Populate dashboard with user data
    document.getElementById('github-username-display').textContent = githubUserData.login || 'Username';
    document.getElementById('github-name-display').textContent = githubUserData.name || 'No name provided';

    // Update avatar
    const avatarLarge = document.getElementById('github-avatar-large');
    if (avatarLarge && githubUserData.avatar_url) {
        avatarLarge.querySelector('img').src = githubUserData.avatar_url;
    }

    // Update stats
    document.getElementById('github-repos-count').textContent = githubUserData.public_repos || 0;
    document.getElementById('github-followers-count').textContent = githubUserData.followers || 0;
    document.getElementById('github-stars-count').textContent = githubUserData.public_gists || 0;

    // Update details
    document.getElementById('github-email-display').textContent = githubUserData.email || 'Not public';
    document.getElementById('github-company-display').textContent = githubUserData.company || '-';
    document.getElementById('github-location-display').textContent = githubUserData.location || '-';

    // Format created date
    if (githubUserData.created_at) {
        const createdDate = new Date(githubUserData.created_at);
        document.getElementById('github-created-display').textContent = createdDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long'
        });
    }

    // Show bio if available
    const bioSection = document.getElementById('github-bio-section');
    if (githubUserData.bio) {
        document.getElementById('github-bio-text').textContent = githubUserData.bio;
        bioSection.style.display = 'block';
    } else {
        bioSection.style.display = 'none';
    }

    // Setup button handlers
    document.getElementById('view-profile-btn').onclick = () => {
        if (githubUserData.html_url) {
            require('electron').shell.openExternal(githubUserData.html_url);
        }
    };

    document.getElementById('sync-repos-btn').onclick = () => {
        showNotification('Syncing repositories...', 'info');
        // Add sync logic here
    };

    document.getElementById('refresh-data-btn').onclick = async () => {
        const token = localStorage.getItem('github_token');
        if (token) {
            await authenticateGitHub(token, true);
            showGitHubAccountInfo(); // Refresh dashboard
        }
    };

    document.getElementById('github-disconnect-btn').onclick = () => {
        const confirmed = confirm('Are you sure you want to disconnect your GitHub account?');
        if (confirmed) {
            disconnectGitHub();
            hideModal('github-account-modal');
        }
    };

    // Show modal
    showModal('github-account-modal');
}

// Disconnect GitHub account
function disconnectGitHub() {
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_user');
    githubUserData = null;
    updateGitHubAvatar();

    // Reset GitHub repos count in hero section
    const heroGitRepos = document.getElementById('hero-git-repos');
    if (heroGitRepos) heroGitRepos.textContent = '0';

    showNotification('Disconnected from GitHub', 'info');
    logActivity('github', 'GitHub Disconnected', 'User disconnected GitHub account');
}

// Initialize GitHub on startup
loadGitHubToken();

// =========================
// Premium Delete Dialog
// =========================

// Initialize premium delete dialog interactions
function initializePremiumDeleteDialog() {
    const deleteModal = document.getElementById('delete-project-modal');
    const deleteTypeRadios = document.querySelectorAll('input[name="delete-type"]');
    const confirmationSection = document.getElementById('delete-confirmation-section');
    const confirmInput = document.getElementById('delete-confirm-input');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const cancelBtn = deleteModal?.querySelector('.btn-delete-cancel');
    const closeBtn = deleteModal?.querySelector('.delete-close-btn');

    // Handle delete type radio changes
    deleteTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'delete') {
                confirmationSection.style.display = 'block';
                confirmBtn.disabled = true;
                confirmInput.value = '';
            } else {
                confirmationSection.style.display = 'none';
                confirmBtn.disabled = false;
            }
        });
    });

    // Handle confirmation input
    confirmInput?.addEventListener('input', (e) => {
        const deleteType = document.querySelector('input[name="delete-type"]:checked')?.value;
        if (deleteType === 'delete' && projectToDelete) {
            confirmBtn.disabled = e.target.value.trim() !== projectToDelete.name;
        }
    });

    // Cancel button
    cancelBtn?.addEventListener('click', () => {
        hideModal('delete-project-modal');
        resetDeleteDialog();
    });

    // Close button
    closeBtn?.addEventListener('click', () => {
        hideModal('delete-project-modal');
        resetDeleteDialog();
    });

    // Confirm delete button
    confirmBtn?.addEventListener('click', async () => {
        if (!projectToDelete) return;

        const deleteType = document.querySelector('input[name="delete-type"]:checked')?.value;

        if (deleteType === 'remove') {
            // Just remove from app
            removeProjectFromApp(projectToDelete);
        } else if (deleteType === 'delete') {
            // Permanently delete
            const confirmation = confirmInput.value.trim();
            if (confirmation !== projectToDelete.name) {
                showNotification('Project name does not match', 'error');
                return;
            }
            await deleteProjectPermanently(projectToDelete);
        }

        hideModal('delete-project-modal');
        resetDeleteDialog();
    });
}

// Reset delete dialog to default state
function resetDeleteDialog() {
    const removeRadio = document.getElementById('delete-type-remove');
    const confirmationSection = document.getElementById('delete-confirmation-section');
    const confirmInput = document.getElementById('delete-confirm-input');
    const confirmBtn = document.getElementById('confirm-delete-btn');

    if (removeRadio) removeRadio.checked = true;
    if (confirmationSection) confirmationSection.style.display = 'none';
    if (confirmInput) confirmInput.value = '';
    if (confirmBtn) confirmBtn.disabled = false;

    projectToDelete = null;
}

// Initialize premium delete dialog
initializePremiumDeleteDialog();

// Git staging and file operations
async function stageFile(filename) {
    if (!currentProject) return;

    try {
        const result = await ipcRenderer.invoke('run-command', `git add "${filename}"`, currentProject.path);
        if (result.success) {
            showNotification(`Staged ${filename}`, 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Failed to stage file: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error staging file: ${error.message}`, 'error');
    }
}

async function unstageFile(filename) {
    if (!currentProject) return;

    try {
        const result = await ipcRenderer.invoke('run-command', `git reset HEAD "${filename}"`, currentProject.path);
        if (result.success) {
            showNotification(`Unstaged ${filename}`, 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Failed to unstage file: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error unstaging file: ${error.message}`, 'error');
    }
}

async function discardFile(filename) {
    if (!currentProject) return;

    const confirmed = confirm(`Are you sure you want to discard changes to ${filename}? This cannot be undone.`);
    if (!confirmed) return;

    try {
        const result = await ipcRenderer.invoke('run-command', `git checkout -- "${filename}"`, currentProject.path);
        if (result.success) {
            showNotification(`Discarded changes to ${filename}`, 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Failed to discard changes: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error discarding changes: ${error.message}`, 'error');
    }
}

async function stageAll() {
    if (!currentProject) return;

    try {
        const result = await ipcRenderer.invoke('run-command', 'git add .', currentProject.path);
        if (result.success) {
            showNotification('Staged all changes', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Failed to stage all: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error staging all: ${error.message}`, 'error');
    }
}

async function unstageAll() {
    if (!currentProject) return;

    try {
        const result = await ipcRenderer.invoke('run-command', 'git reset HEAD', currentProject.path);
        if (result.success) {
            showNotification('Unstaged all changes', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Failed to unstage all: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error unstaging all: ${error.message}`, 'error');
    }
}

async function discardAll() {
    if (!currentProject) return;

    try {
        const result = await ipcRenderer.invoke('run-command', 'git checkout -- .', currentProject.path);
        if (result.success) {
            showNotification('Discarded all changes', 'success');
            await refreshGitStatus();
        } else {
            showNotification(`Failed to discard all: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error discarding all: ${error.message}`, 'error');
    }
}

// Folder toggle function
function toggleFolder(folderId) {
    const folderContent = document.getElementById(folderId);
    const folderIcon = document.getElementById(`${folderId}-icon`);

    if (folderContent && folderIcon) {
        // Find the folder icon (not the chevron)
        const folderIconElement = folderIcon.parentElement.querySelector('.fa-folder, .fa-folder-open');

        // Check if currently visible (check both inline style and computed style)
        const computedDisplay = window.getComputedStyle(folderContent).display;
        const isVisible = computedDisplay !== 'none';

        if (isVisible) {
            // Collapse the folder
            folderContent.style.display = 'none';
            folderIcon.className = 'fas fa-chevron-right git-folder-icon';
            if (folderIconElement) {
                folderIconElement.className = 'fas fa-folder';
                folderIconElement.style.color = '#dcb67a';
            }
        } else {
            // Expand the folder
            folderContent.style.display = 'block';
            folderIcon.className = 'fas fa-chevron-down git-folder-icon';
            if (folderIconElement) {
                folderIconElement.className = 'fas fa-folder-open';
                folderIconElement.style.color = '#dcb67a';
            }
        }
    }
}

// Selection management functions
function toggleSelectAllStaged(checkbox) {
    const checkboxes = document.querySelectorAll('.staged-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updateStagedSelectionState();
}

function toggleSelectAllUnstaged(checkbox) {
    const checkboxes = document.querySelectorAll('.unstaged-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updateUnstagedSelectionState();
}

function toggleFolderSelection(folderId, type, checked) {
    // Get all checkboxes within this folder
    const folderElement = document.getElementById(folderId);
    if (!folderElement) return;

    const checkboxClass = type === 'staged' ? 'staged-checkbox' : 'unstaged-checkbox';
    const checkboxes = folderElement.querySelectorAll(`.${checkboxClass}`);

    checkboxes.forEach(cb => {
        cb.checked = checked;
    });

    // Update the overall selection state
    if (type === 'staged') {
        updateStagedSelectionState();
    } else {
        updateUnstagedSelectionState();
    }
}

function updateStagedSelectionState() {
    const checkboxes = document.querySelectorAll('.staged-checkbox');
    const selectAllCheckbox = document.querySelector('.git-changes-group:nth-child(1) .git-select-all');

    if (selectAllCheckbox) {
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        const anyChecked = Array.from(checkboxes).some(cb => cb.checked);

        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = anyChecked && !allChecked;
    }
}

function updateUnstagedSelectionState() {
    const checkboxes = document.querySelectorAll('.unstaged-checkbox');
    const selectAllCheckbox = document.querySelector('.git-changes-group:nth-child(2) .git-select-all');

    if (selectAllCheckbox) {
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        const anyChecked = Array.from(checkboxes).some(cb => cb.checked);

        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = anyChecked && !allChecked;
    }
}

function getSelectedFiles(checkboxClass) {
    const selectedFiles = [];
    const checkboxes = document.querySelectorAll(`.${checkboxClass}:checked`);

    checkboxes.forEach(checkbox => {
        const fileItem = checkbox.closest('.git-file-item');
        if (fileItem) {
            const filename = fileItem.getAttribute('data-filename');
            if (filename) {
                selectedFiles.push(filename);
            }
        }
    });

    return selectedFiles;
}

async function stageSelected() {
    const selectedFiles = getSelectedFiles('unstaged-checkbox');

    if (selectedFiles.length === 0) {
        showNotification('No files selected', 'warning');
        return;
    }

    if (!currentProject) return;

    try {
        let successCount = 0;
        let errorCount = 0;

        for (const filename of selectedFiles) {
            const result = await ipcRenderer.invoke('run-command', `git add "${filename}"`, currentProject.path);
            if (result.success) {
                successCount++;
            } else {
                errorCount++;
            }
        }

        if (successCount > 0) {
            showNotification(`Staged ${successCount} file(s)`, 'success');
        }
        if (errorCount > 0) {
            showNotification(`Failed to stage ${errorCount} file(s)`, 'error');
        }

        await refreshGitStatus();
    } catch (error) {
        showNotification(`Error staging files: ${error.message}`, 'error');
    }
}

async function unstageSelected() {
    const selectedFiles = getSelectedFiles('staged-checkbox');

    if (selectedFiles.length === 0) {
        showNotification('No files selected', 'warning');
        return;
    }

    if (!currentProject) return;

    try {
        let successCount = 0;
        let errorCount = 0;

        for (const filename of selectedFiles) {
            const result = await ipcRenderer.invoke('run-command', `git reset HEAD "${filename}"`, currentProject.path);
            if (result.success) {
                successCount++;
            } else {
                errorCount++;
            }
        }

        if (successCount > 0) {
            showNotification(`Unstaged ${successCount} file(s)`, 'success');
        }
        if (errorCount > 0) {
            showNotification(`Failed to unstage ${errorCount} file(s)`, 'error');
        }

        await refreshGitStatus();
    } catch (error) {
        showNotification(`Error unstaging files: ${error.message}`, 'error');
    }
}

async function viewFileDiff(filename) {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }

    const result = await ipcRenderer.invoke('git-diff', currentProject.path, filename);
    if (result.success) {
        showDiffModal(filename, result.output);
    } else {
        showNotification(`Failed to get diff: ${result.error}`, 'error');
    }
}

// Show diff in a modal
function showDiffModal(filename, diffOutput) {
    const modal = document.getElementById('git-diff-modal');
    if (!modal) {
        createDiffModal();
        showDiffModal(filename, diffOutput);
        return;
    }

    document.getElementById('diff-filename').textContent = filename;
    const diffContent = document.getElementById('diff-content');

    // Parse and format diff output
    if (!diffOutput || diffOutput.trim() === '') {
        diffContent.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No changes to display</div>';
    } else {
        const lines = diffOutput.split('\n');
        let html = '<pre class="diff-pre">';
        lines.forEach(line => {
            let className = '';
            if (line.startsWith('+') && !line.startsWith('+++')) {
                className = 'diff-added';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                className = 'diff-removed';
            } else if (line.startsWith('@@')) {
                className = 'diff-info';
            }
            html += `<div class="${className}">${escapeHtml(line)}</div>`;
        });
        html += '</pre>';
        diffContent.innerHTML = html;
    }

    showModal('git-diff-modal');
}

// Create diff modal dynamically if it doesn't exist
function createDiffModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'git-diff-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px;">
            <div class="modal-header">
                <h2><i class="fas fa-code-branch"></i> File Diff: <span id="diff-filename"></span></h2>
                <button class="modal-close-btn" onclick="hideModal('git-diff-modal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div id="diff-content" style="max-height: 600px; overflow-y: auto; background: var(--bg-tertiary); border-radius: 4px;"></div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary modal-close">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Load branches for display
async function loadBranches() {
    if (!currentProject) return;

    const result = await ipcRenderer.invoke('git-branches', currentProject.path);
    if (!result.success) return;

    const branches = result.output.split('\n').filter(b => b.trim());
    const branchList = document.getElementById('git-branch-list');

    if (!branchList) return;

    let html = `
        <div class="git-card-header">
            <h3><i class="fas fa-code-branch"></i> Branches</h3>
            <button class="btn-icon" onclick="showCreateBranchModal()" title="New Branch">
                <i class="fas fa-plus"></i>
            </button>
        </div>
        <div class="git-card-body">
    `;

    branches.forEach(branch => {
        const isActive = branch.trim().startsWith('*');
        const branchName = branch.replace('*', '').trim().replace(/^remotes\//, '');
        const isRemote = branch.includes('remotes/');

        html += `
            <div class="git-branch-item ${isActive ? 'active' : ''}" onclick="${!isActive && !isRemote ? `switchBranch('${branchName}')` : ''}">
                <i class="fas fa-code-branch" style="color: ${isActive ? 'var(--accent-primary)' : 'var(--text-secondary)'}"></i>
                <span style="flex: 1;">${branchName}</span>
                ${isActive ? '<i class="fas fa-check" style="color: var(--success);"></i>' : ''}
                ${!isActive && !isRemote ? `<button class="btn-icon-small" onclick="event.stopPropagation(); deleteBranch('${branchName}')" title="Delete Branch"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        `;
    });

    html += '</div>';
    branchList.innerHTML = html;
}

// Switch to a different branch
async function switchBranch(branchName) {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }

    showNotification(`Switching to branch ${branchName}...`, 'info');
    const result = await ipcRenderer.invoke('git-checkout', currentProject.path, branchName);

    if (result.success) {
        showNotification(`Switched to branch ${branchName}`, 'success');
        await refreshGitStatus();
        await loadBranches();
    } else {
        showNotification(`Failed to switch branch: ${result.error}`, 'error');
    }
}

// Delete a branch
async function deleteBranch(branchName) {
    if (!confirm(`Are you sure you want to delete branch "${branchName}"?`)) {
        return;
    }

    const result = await ipcRenderer.invoke('git-delete-branch', currentProject.path, branchName);

    if (result.success) {
        showNotification(`Branch ${branchName} deleted`, 'success');
        await loadBranches();
    } else {
        showNotification(`Failed to delete branch: ${result.error}`, 'error');
    }
}

// Show create branch modal
function showCreateBranchModal() {
    const branchName = prompt('Enter new branch name:');
    if (!branchName || !branchName.trim()) {
        return;
    }

    createBranch(branchName.trim());
}

// Create a new branch
async function createBranch(branchName) {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }

    showNotification(`Creating branch ${branchName}...`, 'info');
    const result = await ipcRenderer.invoke('git-create-branch', currentProject.path, branchName);

    if (result.success) {
        showNotification(`Branch ${branchName} created and checked out`, 'success');
        await refreshGitStatus();
        await loadBranches();
    } else {
        showNotification(`Failed to create branch: ${result.error}`, 'error');
    }
}

// Load branches for merge modal
async function loadBranchesForMerge() {
    if (!currentProject) return;

    const result = await ipcRenderer.invoke('git-branches', currentProject.path);
    if (!result.success) return;

    const branches = result.output.split('\n')
        .filter(b => b.trim() && !b.trim().startsWith('*'))
        .map(b => b.replace('*', '').trim().replace(/^remotes\//, ''));

    const select = document.getElementById('merge-branch-select');
    if (!select) return;

    select.innerHTML = branches.map(b => `<option value="${b}">${b}</option>`).join('');
}

// Perform merge
async function performMerge() {
    const branchName = document.getElementById('merge-branch-select')?.value;
    if (!branchName) {
        showNotification('Please select a branch to merge', 'error');
        return;
    }

    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }

    showNotification(`Merging ${branchName}...`, 'info');
    const result = await ipcRenderer.invoke('git-merge', currentProject.path, branchName);

    if (result.success) {
        showNotification(`Successfully merged ${branchName}`, 'success');
        hideModal('git-merge-modal');
        await refreshGitStatus();
    } else {
        showNotification(`Merge failed: ${result.error}`, 'error');
    }
}

// Load commit history
async function loadCommitHistory() {
    if (!currentProject) return;

    const result = await ipcRenderer.invoke('git-log', currentProject.path, 50);
    if (!result.success) {
        showNotification('Failed to load commit history', 'error');
        return;
    }

    showCommitHistoryModal(result.output);
}

// Show commit history in modal
function showCommitHistoryModal(logOutput) {
    const modal = document.getElementById('git-history-modal');
    if (!modal) {
        createHistoryModal();
        showCommitHistoryModal(logOutput);
        return;
    }

    const historyList = document.getElementById('commit-history-list');
    const commits = logOutput.split('\n').filter(line => line.trim());

    let html = '';
    commits.forEach(commit => {
        const [hash, author, email, date, ...messageParts] = commit.split('|');
        const message = messageParts.join('|');
        const shortHash = hash.substring(0, 7);

        html += `
            <div class="commit-item">
                <div class="commit-header">
                    <code class="commit-hash">${shortHash}</code>
                    <span class="commit-author">${author}</span>
                    <span class="commit-date">${new Date(date).toLocaleDateString()}</span>
                </div>
                <div class="commit-message">${escapeHtml(message)}</div>
            </div>
        `;
    });

    historyList.innerHTML = html;
    showModal('git-history-modal');
}

// Create history modal
function createHistoryModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'git-history-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h2><i class="fas fa-history"></i> Commit History</h2>
                <button class="modal-close-btn" onclick="hideModal('git-history-modal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div id="commit-history-list" style="max-height: 600px; overflow-y: auto;"></div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary modal-close">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Create merge modal
function createMergeModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'git-merge-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2><i class="fas fa-code-merge"></i> Merge Branch</h2>
                <button class="modal-close-btn" onclick="hideModal('git-merge-modal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="merge-branch-select">Select branch to merge into current branch:</label>
                    <select id="merge-branch-select" class="input">
                        <option value="">-- Select a branch --</option>
                    </select>
                </div>
                <div class="git-info-box">
                    <i class="fas fa-info-circle"></i>
                    <span>This will merge the selected branch into your current branch</span>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary modal-close">Cancel</button>
                <button class="btn-primary" onclick="performMerge()">Merge</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Remote repository management
async function showRemotesModal() {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }

    const modal = document.getElementById('git-remotes-modal');
    if (!modal) {
        createRemotesModal();
        await showRemotesModal();
        return;
    }

    await loadRemotes();
    showModal('git-remotes-modal');
}

// Load and display remotes
async function loadRemotes() {
    if (!currentProject) return;

    const result = await ipcRenderer.invoke('git-remote-list', currentProject.path);
    const remotesList = document.getElementById('remotes-list');

    if (!result.success || !result.output.trim()) {
        remotesList.innerHTML = `
            <div class="git-changes-empty">
                <p>No remotes configured</p>
                <p style="font-size: 12px; margin-top: 8px;">Add a remote to push/pull from repositories</p>
            </div>
        `;
        return;
    }

    const remotes = result.output.split('\n').filter(line => line.trim());
    const remoteMap = {};

    // Parse remotes (format: name url (fetch/push))
    remotes.forEach(line => {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
        if (match) {
            const [, name, url, type] = match;
            if (!remoteMap[name]) {
                remoteMap[name] = { name, url, fetch: '', push: '' };
            }
            if (type === 'fetch') {
                remoteMap[name].fetch = url;
            } else if (type === 'push') {
                remoteMap[name].push = url;
            }
        }
    });

    let html = '';
    Object.values(remoteMap).forEach(remote => {
        html += `
            <div class="remote-item">
                <div class="remote-header">
                    <i class="fas fa-globe"></i>
                    <span class="remote-name">${remote.name}</span>
                    <button class="btn-icon-small" onclick="deleteRemote('${remote.name}')" title="Remove Remote">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="remote-url">${remote.url}</div>
            </div>
        `;
    });

    remotesList.innerHTML = html;
}

// Delete a remote
async function deleteRemote(remoteName) {
    if (!confirm(`Are you sure you want to remove remote "${remoteName}"?`)) {
        return;
    }

    const result = await ipcRenderer.invoke('git-remove-remote', currentProject.path, remoteName);
    if (result.success) {
        showNotification(`Remote ${remoteName} removed`, 'success');
        await loadRemotes();
    } else {
        showNotification(`Failed to remove remote: ${result.error}`, 'error');
    }
}

// Add a new remote
async function addRemote() {
    const name = document.getElementById('remote-name-input')?.value?.trim();
    const url = document.getElementById('remote-url-input')?.value?.trim();

    if (!name || !url) {
        showNotification('Please enter both name and URL', 'error');
        return;
    }

    const result = await ipcRenderer.invoke('git-add-remote', currentProject.path, name, url);
    if (result.success) {
        showNotification(`Remote ${name} added successfully`, 'success');
        document.getElementById('remote-name-input').value = '';
        document.getElementById('remote-url-input').value = '';
        await loadRemotes();
    } else {
        showNotification(`Failed to add remote: ${result.error}`, 'error');
    }
}

// Create remotes modal
function createRemotesModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'git-remotes-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px;">
            <div class="modal-header">
                <h2><i class="fas fa-globe"></i> Manage Remotes</h2>
                <button class="modal-close-btn" onclick="hideModal('git-remotes-modal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Configured Remotes</label>
                    <div id="remotes-list" style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
                        <!-- Remotes will be listed here -->
                    </div>
                </div>

                <div class="git-info-box">
                    <i class="fas fa-info-circle"></i>
                    <span>Add a new remote repository</span>
                </div>

                <div class="form-group">
                    <label for="remote-name-input">Remote Name</label>
                    <input type="text" id="remote-name-input" class="input" placeholder="origin" />
                </div>

                <div class="form-group">
                    <label for="remote-url-input">Remote URL</label>
                    <input type="text" id="remote-url-input" class="input"
                        placeholder="https://github.com/user/repo.git" />
                </div>

                <button class="btn-primary" onclick="addRemote()" style="width: 100%;">
                    <i class="fas fa-plus"></i> Add Remote
                </button>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary modal-close">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        switchView,
        showNotification,
        formatProjectType,
        logActivity,
        validateProjectName,
        stageFile,
        unstageFile,
        discardFile,
        stageAll,
        unstageAll
    };
}

// ==========================================
// Tips & Resources Auto-Rotation
// ==========================================

const tipsDatabase = [
    {
        icon: 'fas fa-keyboard',
        title: 'Keyboard Shortcuts',
        description: 'Use Ctrl+N to create a new project quickly, or Ctrl+O to open an existing one'
    },
    {
        icon: 'fas fa-code-branch',
        title: 'Git Integration',
        description: 'Seamlessly manage your repositories with built-in Git support and visualization'
    },
    {
        icon: 'fab fa-github',
        title: 'GitHub Sync',
        description: 'Connect your GitHub account to create repositories and push changes directly from the app'
    },
    {
        icon: 'fas fa-history',
        title: 'Commit History',
        description: 'Track all your changes with detailed commit history and visual branch diagrams'
    },
    {
        icon: 'fas fa-folder-tree',
        title: 'Project Organization',
        description: 'Keep your projects organized with folders, tags, and custom metadata'
    },
    {
        icon: 'fas fa-file-code',
        title: 'File Changes',
        description: 'Review file changes with inline diffs and stage only the changes you need'
    },
    {
        icon: 'fas fa-save',
        title: 'Auto-Save',
        description: 'Your work is automatically saved - never lose your project configuration again'
    },
    {
        icon: 'fas fa-search',
        title: 'Quick Search',
        description: 'Use the search feature to quickly find projects, files, or commits across all repositories'
    },
    {
        icon: 'fas fa-palette',
        title: 'Customization',
        description: 'Personalize your workspace with themes and custom settings in the Settings view'
    },
    {
        icon: 'fas fa-cloud-upload-alt',
        title: 'Push & Pull',
        description: 'Keep your remote repositories in sync with one-click push and pull operations'
    },
    {
        icon: 'fas fa-undo',
        title: 'Undo Operations',
        description: 'Made a mistake? Use the Undo button in Git view to revert your last operation'
    },
    {
        icon: 'fas fa-layer-group',
        title: 'Batch Operations',
        description: 'Stage or unstage multiple files at once with the Select All feature'
    }
];

let tipsRotationInterval = null;
let currentTipsPage = 0;
let tipsPages = [];

// Create tip pages (groups of 3 tips)
function createTipsPages() {
    tipsPages = [];
    const tipsCopy = [...tipsDatabase];

    // Shuffle tips
    for (let i = tipsCopy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tipsCopy[i], tipsCopy[j]] = [tipsCopy[j], tipsCopy[i]];
    }

    // Group into pages of 3
    for (let i = 0; i < tipsCopy.length; i += 3) {
        tipsPages.push(tipsCopy.slice(i, i + 3));
    }
}

function renderNavigationDots() {
    const navContainer = document.getElementById('tips-navigation');
    if (!navContainer || tipsPages.length === 0) return;

    navContainer.innerHTML = tipsPages.map((_, index) => `
        <button class="tip-dot ${index === currentTipsPage ? 'active' : ''}"
                data-page="${index}"
                aria-label="View tips page ${index + 1}"></button>
    `).join('');

    // Add click handlers
    navContainer.querySelectorAll('.tip-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const page = parseInt(dot.getAttribute('data-page'));
            goToTipsPage(page);
        });
    });

    // Start progress animation on active dot
    setTimeout(() => {
        const activeDot = navContainer.querySelector('.tip-dot.active');
        if (activeDot) {
            // Force animation restart by removing and re-adding class
            activeDot.classList.remove('animating');
            void activeDot.offsetWidth; // Trigger reflow
            activeDot.classList.add('animating');
        }
    }, 50);
}

function renderTips(withAnimation = true) {
    const tipsContainer = document.getElementById('tips-container');
    if (!tipsContainer || tipsPages.length === 0) return;

    const tipsToShow = tipsPages[currentTipsPage];

    if (withAnimation) {
        // Animate out
        tipsContainer.classList.add('animating-out');

        setTimeout(() => {
            // Update content
            tipsContainer.innerHTML = tipsToShow.map(tip => `
                <div class="tip-card">
                    <div class="tip-icon">
                        <i class="${tip.icon}"></i>
                    </div>
                    <h4>${tip.title}</h4>
                    <p>${tip.description}</p>
                </div>
            `).join('');

            // Animate in
            tipsContainer.classList.remove('animating-out');
            tipsContainer.classList.add('animating-in');

            setTimeout(() => {
                tipsContainer.classList.remove('animating-in');
            }, 600);
        }, 300);
    } else {
        // No animation, just render
        tipsContainer.innerHTML = tipsToShow.map(tip => `
            <div class="tip-card">
                <div class="tip-icon">
                    <i class="${tip.icon}"></i>
                </div>
                <h4>${tip.title}</h4>
                <p>${tip.description}</p>
            </div>
        `).join('');
    }

    // Update navigation dots
    renderNavigationDots();
}

function goToTipsPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= tipsPages.length) return;

    currentTipsPage = pageIndex;
    renderTips(true);

    // Reset auto-rotation timer
    if (tipsRotationInterval) {
        clearInterval(tipsRotationInterval);
        startAutoRotation();
    }
}

function nextTipsPage() {
    currentTipsPage = (currentTipsPage + 1) % tipsPages.length;
    renderTips(true);
}

function startAutoRotation() {
    tipsRotationInterval = setInterval(() => {
        nextTipsPage();
    }, 30000); // 30 seconds
}

function startTipsRotation() {
    // Create pages
    createTipsPages();

    if (tipsPages.length === 0) return;

    // Render initial tips without animation
    currentTipsPage = 0;
    renderTips(false);

    // Start auto-rotation
    if (tipsRotationInterval) {
        clearInterval(tipsRotationInterval);
    }
    startAutoRotation();
}

// Initialize tips after a short delay
setTimeout(() => {
    startTipsRotation();
}, 1000);