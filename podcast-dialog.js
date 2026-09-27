(() => {
  const dataNode = document.getElementById('elodin-podcast-data');
  const launcher = document.getElementById('elodin-podcast-launcher');
  const dialog = document.getElementById('elodin-podcast-dialog');
  if (!dataNode || !launcher || !dialog) return;

  let episodes = [];
  try {
    const parsed = JSON.parse(dataNode.textContent || '[]');
    episodes = Array.isArray(parsed)
      ? parsed.filter((episode) => episode && typeof episode.id === 'string' && typeof episode.title === 'string')
      : [];
  } catch (_) {}
  if (!episodes.length) {
    launcher.hidden = true;
    return;
  }

  const STORAGE_KEY = 'elodin-deep-lore-podcast-v1';
  const AUDIO_CACHE = 'elodin-podcast-audio-v1';
  const RECENT_LIMIT = 6;
  const title = dialog.querySelector('[data-podcast-title]');
  const meta = dialog.querySelector('[data-podcast-meta]');
  const frame = dialog.querySelector('[data-podcast-frame]');
  const spotifyLink = dialog.querySelector('[data-podcast-spotify]');
  const differentButton = dialog.querySelector('[data-podcast-different]');
  const closeButton = dialog.querySelector('[data-podcast-close]');
  const actions = dialog.querySelector('.elodin-podcast-actions');

  const audio = document.createElement('audio');
  audio.className = 'elodin-podcast-audio';
  audio.controls = true;
  audio.preload = 'metadata';
  audio.hidden = true;
  frame.insertAdjacentElement('afterend', audio);

  const offlineButton = document.createElement('button');
  offlineButton.type = 'button';
  offlineButton.className = 'elodin-podcast-offline';
  offlineButton.hidden = true;
  actions.insertBefore(offlineButton, spotifyLink);

  let currentIndex = -1;
  let recent = [];
  let offlineState = 'streaming';

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Number.isInteger(saved.currentIndex) && saved.currentIndex >= 0 && saved.currentIndex < episodes.length) currentIndex = saved.currentIndex;
    if (Array.isArray(saved.recent)) {
      recent = saved.recent.filter((index) => Number.isInteger(index) && index >= 0 && index < episodes.length).slice(0, RECENT_LIMIT);
    }
  } catch (_) {}

  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentIndex, recent: recent.slice(0, RECENT_LIMIT) })); } catch (_) {}
  };

  const chooseDifferent = () => {
    const excluded = new Set(recent);
    if (currentIndex >= 0) excluded.add(currentIndex);
    let candidates = episodes.map((_, index) => index).filter((index) => !excluded.has(index));
    if (!candidates.length) candidates = episodes.map((_, index) => index).filter((index) => index !== currentIndex);
    if (!candidates.length) candidates = [0];
    const previous = currentIndex;
    currentIndex = candidates[Math.floor(Math.random() * candidates.length)];
    if (previous >= 0 && previous !== currentIndex) recent = [previous, ...recent.filter((index) => index !== previous)].slice(0, RECENT_LIMIT);
    persist();
    offlineState = 'streaming';
  };

  const renderOfflineButton = () => {
    const episode = episodes[currentIndex];
    if (!episode?.audio) {
      offlineButton.hidden = true;
      return;
    }
    offlineButton.hidden = false;
    offlineButton.disabled = offlineState === 'downloading';
    offlineButton.textContent =
      offlineState === 'saved' ? '✓ Offline saved · tap to remove' :
      offlineState === 'downloading' ? 'Downloading…' :
      offlineState === 'failed' ? 'Retry offline download' :
      '⬇ Download offline';
  };

  const refreshOfflineState = async () => {
    const episode = episodes[currentIndex];
    if (!episode?.audio || !('caches' in window)) {
      offlineState = 'streaming';
      renderOfflineButton();
      return;
    }
    try {
      const cache = await caches.open(AUDIO_CACHE);
      offlineState = (await cache.match(episode.audio, { ignoreVary: true })) ? 'saved' : 'downloadable';
    } catch {
      offlineState = 'downloadable';
    }
    renderOfflineButton();
  };

  const renderEpisode = ({ forceReload = false } = {}) => {
    if (currentIndex < 0 || currentIndex >= episodes.length) chooseDifferent();
    const episode = episodes[currentIndex];
    title.textContent = episode.title;
    meta.textContent = [episode.show, ...(Array.isArray(episode.tags) ? episode.tags : [])].filter(Boolean).join(' · ');

    if (episode.audio) {
      frame.hidden = true;
      audio.hidden = false;
      if (forceReload || audio.dataset.episodeId !== episode.id || !audio.src) {
        audio.src = episode.audio;
        audio.dataset.episodeId = episode.id;
      }
    } else {
      audio.pause();
      audio.hidden = true;
      frame.hidden = false;
      if (forceReload || frame.dataset.episodeId !== episode.id || !frame.getAttribute('src')) {
        frame.src = `https://open.spotify.com/embed/episode/${encodeURIComponent(episode.id)}?theme=0`;
        frame.dataset.episodeId = episode.id;
      }
      frame.title = `Spotify episode: ${episode.title}`;
    }
    spotifyLink.href = `https://open.spotify.com/episode/${encodeURIComponent(episode.id)}`;
    renderOfflineButton();
    refreshOfflineState();
  };

  const toggleOffline = async () => {
    const episode = episodes[currentIndex];
    if (!episode?.audio || !('caches' in window)) return;
    offlineState = 'downloading';
    renderOfflineButton();
    try {
      const cache = await caches.open(AUDIO_CACHE);
      const existing = await cache.match(episode.audio, { ignoreVary: true });
      if (existing) {
        await cache.delete(episode.audio, { ignoreVary: true });
        offlineState = 'downloadable';
        renderOfflineButton();
        return;
      }
      let response;
      try {
        response = await fetch(episode.audio, { cache: 'no-store' });
      } catch {
        response = await fetch(episode.audio, { mode: 'no-cors', cache: 'no-store' });
      }
      if (!response || (response.type !== 'opaque' && !response.ok)) throw new Error('Podcast download failed');
      await cache.put(episode.audio, response.clone());
      offlineState = 'saved';
    } catch (error) {
      console.error(error);
      offlineState = 'failed';
    }
    renderOfflineButton();
  };

  const ensureNonModalDialog = () => {
    if (!dialog.open) {
      if (typeof dialog.show === 'function') dialog.show();
      else dialog.setAttribute('open', '');
    }
  };

  const openPlayer = () => {
    renderEpisode();
    ensureNonModalDialog();
    dialog.classList.remove('is-minimized');
    dialog.setAttribute('aria-hidden', 'false');
    launcher.hidden = true;
    launcher.setAttribute('aria-expanded', 'true');
  };

  const minimizePlayer = () => {
    ensureNonModalDialog();
    dialog.classList.add('is-minimized');
    dialog.setAttribute('aria-hidden', 'true');
    launcher.hidden = false;
    launcher.setAttribute('aria-expanded', 'false');
  };

  launcher.addEventListener('click', openPlayer);
  closeButton.addEventListener('click', minimizePlayer);
  offlineButton.addEventListener('click', toggleOffline);
  differentButton.addEventListener('click', () => {
    chooseDifferent();
    renderEpisode({ forceReload: true });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.open && !dialog.classList.contains('is-minimized')) {
      event.preventDefault();
      minimizePlayer();
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./podcast-sw.js').catch(() => {});
})();
