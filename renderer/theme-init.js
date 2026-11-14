// Runs in <head> before first paint so the saved theme is applied with no flash.
(function applyInitialTheme() {
  var theme = (window.api && window.api.theme && window.api.theme.initial) || 'dark';
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}());
