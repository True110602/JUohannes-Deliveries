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

// Wires up a drag-and-drop / click-to-browse image upload zone.
// dropZoneId: the container div (also the click target)
// fileInputId: the hidden <input type="file"> inside it
// previewImgId: an <img> element used to preview the uploaded picture
// hiddenUrlInputId: a hidden input that stores the resulting URL, so
//   existing form submission code that reads it doesn't need to change
// onUploaded(url): optional callback fired after a successful upload
// Uploads go to /api/merchant/upload-image via authFetch (merchant-only).
function setupImageDropZone({ dropZoneId, fileInputId, previewImgId, hiddenUrlInputId, onUploaded }) {
  const zone = document.getElementById(dropZoneId);
  const input = document.getElementById(fileInputId);
  const preview = previewImgId ? document.getElementById(previewImgId) : null;
  const hiddenInput = hiddenUrlInputId ? document.getElementById(hiddenUrlInputId) : null;
  if (!zone || !input) return;

  function showPreview(url) {
    if (preview && url) {
      preview.src = url;
      preview.classList.add('fx-has-image');
    }
  }

  // If a URL is already set (e.g. loaded from a saved profile), show it.
  if (hiddenInput && hiddenInput.value) showPreview(hiddenInput.value);

  async function uploadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.', 'error');
      return;
    }

    const zoneTextEl = zone.querySelector('.fx-drop-zone-text');
    const originalText = zoneTextEl ? zoneTextEl.innerHTML : null;
    if (zoneTextEl) zoneTextEl.innerHTML = '<span class="inline-spinner fx-spinner-light"></span>Uploading...';

    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await authFetch(`${window.API_BASE}/api/merchant/upload-image`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        const fullUrl = data.url.startsWith('http') ? data.url : `${window.API_BASE}${data.url}`;
        if (hiddenInput) hiddenInput.value = fullUrl;
        showPreview(fullUrl);
        if (onUploaded) onUploaded(fullUrl);
      } else {
        showToast(data.message || 'Upload failed.', 'error');
      }
    } catch (err) {
      showToast('Server error uploading image.', 'error');
    } finally {
      if (zoneTextEl && originalText !== null) zoneTextEl.innerHTML = originalText;
    }
  }

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => uploadFile(input.files[0]));

  ['dragover', 'dragenter'].forEach(evt => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('fx-drop-active');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach(evt => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('fx-drop-active');
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    uploadFile(file);
  });
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
