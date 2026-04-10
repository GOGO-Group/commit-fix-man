const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const simpleGit = require("simple-git");

const REPO_DIR = path.join(__dirname, "repository");
const FLAGS_FILE = path.join(__dirname, "repo-flags.json");
const PLANS_FILE = path.join(__dirname, "commit-plans.json");
const SETTINGS_FILE = path.join(__dirname, "settings.json");

// Ensure repository directory exists
if (!fs.existsSync(REPO_DIR)) {
  fs.mkdirSync(REPO_DIR, { recursive: true });
}

// Load/save flags (flagged repos are excluded from calendar)
function loadFlags() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      return JSON.parse(fs.readFileSync(FLAGS_FILE, "utf-8"));
    }
  } catch (e) {}
  return {};
}

function saveFlags(flags) {
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(flags, null, 2));
}

// Load/save commit plans (click counts per repo per date)
function loadPlans() {
  try {
    if (fs.existsSync(PLANS_FILE)) {
      return JSON.parse(fs.readFileSync(PLANS_FILE, "utf-8"));
    }
  } catch (e) {}
  return {};
}

function savePlans(plans) {
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
}

// Load/save settings (username, email)
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    }
  } catch (e) {}
  return { username: "", email: "" };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Go directly to main page
  mainWindow.loadFile("pages/main.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC Handlers ---

// Read uploaded .txt file content and return list of repo URLs
ipcMain.handle("read-repo-file", async (event, filePath) => {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
});

// Open file dialog to pick .txt file
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Text Files", extensions: ["txt"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Open directory dialog
ipcMain.handle("open-directory-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Clone a single repository
ipcMain.handle("clone-repo", async (event, repoUrl) => {
  const repoName = repoUrl
    .replace(/\.git$/, "")
    .split(/[/\\]/)
    .pop();
  const targetPath = path.join(REPO_DIR, repoName);

  if (fs.existsSync(targetPath)) {
    return { name: repoName, status: "already exists" };
  }

  try {
    const git = simpleGit();
    await git.clone(repoUrl, targetPath);
    return { name: repoName, status: "cloned" };
  } catch (err) {
    return { name: repoName, status: "error", message: err.message };
  }
});

// Add a local directory as a repo (copy or symlink)
ipcMain.handle("add-local-repo", async (event, dirPath) => {
  const repoName = path.basename(dirPath);
  const targetPath = path.join(REPO_DIR, repoName);

  if (fs.existsSync(targetPath)) {
    return { name: repoName, status: "already exists" };
  }

  // Verify it's a git repository
  const gitDir = path.join(dirPath, ".git");
  if (!fs.existsSync(gitDir)) {
    return { name: repoName, status: "error", message: "Not a git repository" };
  }

  try {
    // Create a symlink to the local directory
    fs.symlinkSync(dirPath, targetPath, "junction");
    return { name: repoName, status: "linked" };
  } catch (err) {
    return { name: repoName, status: "error", message: err.message };
  }
});

// Delete a repository from the repository directory
ipcMain.handle("delete-repo", async (event, repoName) => {
  const targetPath = path.join(REPO_DIR, repoName);
  if (!fs.existsSync(targetPath)) {
    return { success: false, message: "Not found" };
  }

  try {
    // Check if it's a symlink/junction
    const stats = fs.lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    // Remove flag if exists
    const flags = loadFlags();
    delete flags[repoName];
    saveFlags(flags);

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// List all repos in the repository directory
ipcMain.handle("list-repos", async () => {
  if (!fs.existsSync(REPO_DIR)) return [];
  const entries = fs.readdirSync(REPO_DIR, { withFileTypes: true });
  const flags = loadFlags();
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => ({
      name: e.name,
      flagged: !!flags[e.name],
    }));
});

// Toggle flag for a repository
ipcMain.handle("toggle-flag", async (event, repoName) => {
  const flags = loadFlags();
  flags[repoName] = !flags[repoName];
  saveFlags(flags);
  return flags[repoName];
});

// Get commits using raw git log
ipcMain.handle("get-commits-raw", async (event, repoName) => {
  const repoPath = path.join(REPO_DIR, repoName);
  if (!fs.existsSync(repoPath)) return [];

  try {
    const git = simpleGit(repoPath);
    const result = await git.raw(["log", "--all", "--format=%H|%an|%ae|%aI"]);
    if (!result) return [];
    return result
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, author, email, date] = line.split("|");
        return { hash, author, email, date };
      });
  } catch (err) {
    return [];
  }
});

// Get commit plan for a repository
ipcMain.handle("get-commit-plan", async (event, repoName) => {
  const plans = loadPlans();
  return plans[repoName] || {};
});

// Set commit plan value for a specific repo + date
ipcMain.handle("set-commit-plan", async (event, { repoName, date, count }) => {
  const plans = loadPlans();
  if (!plans[repoName]) plans[repoName] = {};
  if (count === 0) {
    delete plans[repoName][date];
    if (Object.keys(plans[repoName]).length === 0) {
      delete plans[repoName];
    }
  } else {
    plans[repoName][date] = count;
  }
  savePlans(plans);
  return count;
});

// Get all plans raw data: { repoName: { date: count, ... }, ... }
ipcMain.handle("get-all-plans", async () => {
  return loadPlans();
});

// Get summary of all plans: { repoName: totalCount, ... }
ipcMain.handle("get-all-plans-summary", async () => {
  const plans = loadPlans();
  const summary = {};
  for (const [repo, dates] of Object.entries(plans)) {
    const total = Object.values(dates).reduce((s, v) => s + v, 0);
    if (total > 0) summary[repo] = total;
  }
  return summary;
});

// Clear commit plan for a specific repo (all dates or by year)
ipcMain.handle("clear-plan-repo", async (event, { repoName, year }) => {
  const plans = loadPlans();
  if (!plans[repoName]) return;

  if (year) {
    const prefix = String(year);
    for (const date of Object.keys(plans[repoName])) {
      if (date.startsWith(prefix)) {
        delete plans[repoName][date];
      }
    }
    if (Object.keys(plans[repoName]).length === 0) {
      delete plans[repoName];
    }
  } else {
    delete plans[repoName];
  }
  savePlans(plans);
});

// Clear commit plans for ALL repos (all dates or by year)
ipcMain.handle("clear-plan-all", async (event, { year }) => {
  const plans = loadPlans();

  if (year) {
    const prefix = String(year);
    for (const repo of Object.keys(plans)) {
      for (const date of Object.keys(plans[repo])) {
        if (date.startsWith(prefix)) {
          delete plans[repo][date];
        }
      }
      if (Object.keys(plans[repo]).length === 0) {
        delete plans[repo];
      }
    }
  } else {
    // Clear everything
    for (const key of Object.keys(plans)) {
      delete plans[key];
    }
  }
  savePlans(plans);
});

// Get settings
ipcMain.handle("get-settings", async () => {
  return loadSettings();
});

// Save settings
ipcMain.handle("save-settings", async (event, settings) => {
  saveSettings(settings);
});

// Make a commit to a repository with given username, email, and date
ipcMain.handle(
  "make-commit",
  async (event, { repoName, username, email, commitDate, message }) => {
    const repoPath = path.join(REPO_DIR, repoName);
    if (!fs.existsSync(repoPath)) {
      return { success: false, message: "Repository not found" };
    }

    try {
      const git = simpleGit(repoPath);

      await git.addConfig("user.name", username);
      await git.addConfig("user.email", email);

      const commitFile = path.join(repoPath, ".commit-log");
      const timestamp = new Date(commitDate).toISOString();
      fs.appendFileSync(commitFile, `Commit at ${timestamp} by ${username}\n`);

      await git.add(".commit-log");

      const commitMsg = message || `Commit by ${username} at ${timestamp}`;
      await git.commit(commitMsg, {
        "--date": commitDate,
      });

      await git.env("GIT_COMMITTER_DATE", commitDate);

      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  },
);
