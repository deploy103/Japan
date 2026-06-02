(function () {
  const STORAGE_KEY = 'dark-mode';

  function readPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function writePreference(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch (error) {
      // Ignore storage failures so the button still changes the current page.
    }
  }

  function syncButtonLabels(enabled) {
    document.querySelectorAll('#dark-mode-button').forEach((button) => {
      button.textContent = enabled ? '라이트모드' : '다크모드';
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    });
  }

  function applyTheme(enabled) {
    document.documentElement.classList.toggle('dark-mode', enabled);
    document.body?.classList.toggle('dark-mode', enabled);
    syncButtonLabels(enabled);
  }

  function currentTheme() {
    return document.documentElement.classList.contains('dark-mode') ||
      document.body?.classList.contains('dark-mode');
  }

  function bindToggleButtons() {
    applyTheme(readPreference());
    document.querySelectorAll('#dark-mode-button').forEach((button) => {
      button.addEventListener('click', () => {
        const enabled = !currentTheme();
        applyTheme(enabled);
        writePreference(enabled);
      });
    });
  }

  applyTheme(readPreference());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToggleButtons);
  } else {
    bindToggleButtons();
  }
})();
