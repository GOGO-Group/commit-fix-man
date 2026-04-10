const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  readRepoFile: (filePath) => ipcRenderer.invoke('read-repo-file', filePath),
  cloneRepo: (repoUrl) => ipcRenderer.invoke('clone-repo', repoUrl),
  addLocalRepo: (dirPath) => ipcRenderer.invoke('add-local-repo', dirPath),
  deleteRepo: (repoName) => ipcRenderer.invoke('delete-repo', repoName),
  listRepos: () => ipcRenderer.invoke('list-repos'),
  getCommitsRaw: (repoName) => ipcRenderer.invoke('get-commits-raw', repoName),
  executePlan: (data) => ipcRenderer.invoke('execute-plan', data),
  toggleFlag: (repoName) => ipcRenderer.invoke('toggle-flag', repoName),
  getCommitPlan: (repoName) => ipcRenderer.invoke('get-commit-plan', repoName),
  setCommitPlan: (data) => ipcRenderer.invoke('set-commit-plan', data),
  getAllPlans: () => ipcRenderer.invoke('get-all-plans'),
  getAllPlansSummary: () => ipcRenderer.invoke('get-all-plans-summary'),
  clearPlanRepo: (data) => ipcRenderer.invoke('clear-plan-repo', data),
  clearPlanAll: (data) => ipcRenderer.invoke('clear-plan-all', data),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  onCommitProgress: (callback) => {
    ipcRenderer.on('commit-progress', (event, data) => callback(data));
  },
  removeCommitProgress: () => {
    ipcRenderer.removeAllListeners('commit-progress');
  },
});
