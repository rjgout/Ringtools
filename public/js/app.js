document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.getAttribute('data-copy');
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const original = btn.textContent;
      btn.textContent = 'Gekopieerd!';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    })
    .catch(() => {
      const input = document.getElementById('shareLink');
      if (input) {
        input.select();
        document.execCommand('copy');
      }
    });
});
