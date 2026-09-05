// Shared UI helpers used across every page (button loading states,
// lightweight toast notifications). Previously this file didn't
// actually exist under this name — pages loaded "/js/ui-helpers.js"
// (hyphen) while the real file on disk was "ui helpers.js" (space),
// so the request 404'd silently and setButtonLoading() was undefined
// wherever it was called.

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;

  if (isLoading) {
    if (button.dataset.fxOriginalHtml === undefined) {
      button.dataset.fxOriginalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = `<span class="inline-spinner"></span>${loadingText || 'Please wait...'}`;
  } else {
    button.disabled = false;
    if (button.dataset.fxOriginalHtml !== undefined) {
      button.innerHTML = button.dataset.fxOriginalHtml;
      delete button.dataset.fxOriginalHtml;
    }
  }
}

function showToast(message, type) {
  let stack = document.querySelector('.fx-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'fx-toast-stack';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = `fx-toast ${type === 'error' ? 'err' : type === 'success' ? 'ok' : ''}`;
  toast.textContent = message;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}
