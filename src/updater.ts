import { check, type Update } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';
import { native } from './native';

// Signed updates from GitHub Releases, the same way every Forme app updates.
// The app checks once at launch (quietly) and again from Help > Check for Updates.
// Installing saves the current draft first, then relaunches into the new version.

let pending: Update | null = null;
let installing = false;

type Notify = (message: string, error?: boolean) => void;

function bar() { return document.getElementById('update-bar') as HTMLElement; }

export async function checkForUpdates(opts: { manual: boolean; notify: Notify; beforeRestart: () => Promise<void> }) {
  if (!native || installing) return;
  try {
    const update = await check();
    if (!update) {
      if (opts.manual) opts.notify('Snapback is up to date.');
      return;
    }
    pending = update;
    showBar(update.version, opts);
  } catch (error) {
    // Launch checks stay silent offline; only a manual check reports a failure.
    if (opts.manual) opts.notify(`Could not check for updates. ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function showBar(version: string, opts: { notify: Notify; beforeRestart: () => Promise<void> }) {
  const root = bar();
  const message = root.querySelector('[data-update-message]') as HTMLElement;
  const install = root.querySelector('[data-update-install]') as HTMLButtonElement;
  const later = root.querySelector('[data-update-later]') as HTMLButtonElement;
  message.textContent = `Snapback ${version} is available.`;
  install.disabled = false;
  install.textContent = 'Install and restart';
  later.hidden = false;
  root.hidden = false;
  later.onclick = () => { root.hidden = true; };
  install.onclick = () => void installAndRestart(message, install, later, opts);
}

async function installAndRestart(message: HTMLElement, install: HTMLButtonElement, later: HTMLButtonElement, opts: { notify: Notify; beforeRestart: () => Promise<void> }) {
  if (!pending || installing) return;
  installing = true;
  install.disabled = true;
  later.hidden = true;
  let total = 0, downloaded = 0;
  try {
    await pending.downloadAndInstall(event => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      if (event.event === 'Progress') downloaded += event.data.chunkLength;
      install.textContent = total ? `Installing… ${Math.min(100, Math.round(downloaded / total * 100))}%` : 'Installing…';
    });
    message.textContent = 'Update installed. Restarting…';
    await opts.beforeRestart();
    await invoke('restart_app');
  } catch (error) {
    installing = false;
    bar().hidden = true;
    opts.notify(`Update failed. ${error instanceof Error ? error.message : String(error)}`, true);
  }
}
