(() => {
  const header = document.querySelector('[data-site-header]');
  if (!header) return;

  const toggle = header.querySelector('.site-header-toggle');
  const panel = document.getElementById(toggle.getAttribute('aria-controls'));
  const mobile = window.matchMedia('(max-width: 1130px)');

  function setOpen(open) {
    header.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  }

  toggle.addEventListener('click', () => setOpen(!header.hasAttribute('data-open')));
  panel.addEventListener('click', event => {
    if (mobile.matches && event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !header.hasAttribute('data-open')) return;
    setOpen(false);
    toggle.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (!header.contains(event.target)) setOpen(false);
  });
  mobile.addEventListener('change', () => setOpen(false));

  header.setAttribute('data-enhanced', '');
  toggle.hidden = false;
})();
