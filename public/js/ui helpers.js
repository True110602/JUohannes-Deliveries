// Shared loading-state helper for buttons across the app.
// Injects a small spinner style once, then exposes setButtonLoading()
// so any page can show "Logging in...", "Submitting...", etc. with a
// spinning icon while a fetch is in flight, and revert automatically.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .btn-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.5);
      border-top-color: #fff;
      border-radius: 50%;
      animation: btn-spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes btn-spin {
      to { transform: rotate(360deg); }
    }
    .inline-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #ccc;
      border-top-color: #007bff;
      border-radius: 50%;
      animation: btn-spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
  `;
  document.head.appendChild(style);

  // Disables a button, swaps its text for a spinner + loadingText, and
  // remembers the original content so it can be restored afterwards.
  window.setButtonLoading = function (button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
      if (button.dataset.originalText === undefined) {
        button.dataset.originalText = button.innerHTML;
      }
      button.disabled = true;
      button.innerHTML = `<span class="btn-spinner"></span>${loadingText || 'Loading...'}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalText !== undefined) {
        button.innerHTML = button.dataset.originalText;
      }
    }
  };
})();
