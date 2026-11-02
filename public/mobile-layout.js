function applyMobileLayout() {
  const app = document.querySelector('.app');
  const main = app?.querySelector('.main');
  const sidebar = app?.querySelector('.sidebar');
  if (!main || !sidebar) return;
  sidebar.id = 'atkNavigation';
  const header = document.createElement('header');
  header.className = 'atk-mobile-header';
  header.innerHTML = '<button type="button" aria-label="Abrir menú" aria-controls="atkNavigation" aria-expanded="false"><span aria-hidden="true">☰</span></button><img src="/brands/atk-peru-wk.png" alt="ATK Altoque Perú WK"><span class="atk-mobile-section"></span>';
  header.querySelector('.atk-mobile-section').textContent = main.querySelector('.page-title')?.textContent || 'Registros ATK';
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'atk-mobile-backdrop';
  backdrop.setAttribute('aria-label', 'Cerrar menú');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'atk-mobile-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Cerrar menú de navegación');
  sidebar.prepend(close);
  app.prepend(header, backdrop);
  const toggle = header.querySelector('button');
  function setOpen(open, restoreFocus = false) {
    app.classList.toggle('atk-mobile-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    if (open) close.focus();
    else if (restoreFocus) toggle.focus();
  }
  toggle.onclick = () => setOpen(!app.classList.contains('atk-mobile-open'));
  backdrop.onclick = close.onclick = () => setOpen(false, true);
  sidebar.addEventListener('click', event => {
    if (event.target.closest('[data-nav]')) setOpen(false);
  });
  app.addEventListener('keydown', event => {
    if (!app.classList.contains('atk-mobile-open')) return;
    if (event.key === 'Escape') { setOpen(false, true); return; }
    if (event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('button,[tabindex="0"],input,select,a[href]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  sidebar.querySelectorAll('[data-nav]').forEach(item => {
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); }
    });
  });
  const salarySplit = main.querySelector('.fx-salary-split');
  if (salarySplit) {
    const rows = [...salarySplit.querySelectorAll('tr[data-salary-detail]')];
    const picker = document.createElement('label');
    picker.className = 'atk-mobile-salary-picker';
    picker.textContent = 'Ver sueldo de';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Colaborador del desglose de sueldo');
    rows.forEach(row => {
      const option = document.createElement('option');
      option.value = row.dataset.salaryDetail;
      option.textContent = row.cells[0]?.textContent.trim().replace(/\s+/g, ' ') || option.value;
      option.selected = row.classList.contains('fx-selected');
      select.append(option);
      row.addEventListener('click', () => {
        if (window.matchMedia('(max-width:900px)').matches) {
          select.value = row.dataset.salaryDetail;
          requestAnimationFrame(() => main.querySelector('.fx-salary-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        }
      });
    });
    select.onchange = () => rows.find(row => row.dataset.salaryDetail === select.value)?.click();
    picker.append(select);
    salarySplit.prepend(picker);
  }
  // Retain the actual cells and buttons: only add labels for narrow screens.
  document.querySelectorAll('.main table, .modal table').forEach(table => {
    if (table.classList.contains('salary-detail-table')) return;
    const headers = [...(table.tHead?.rows[table.tHead.rows.length - 1]?.cells || [])];
    if (!headers.length) return;
    table.classList.add('atk-mobile-table');
    const columns = headers.map(cell => ({ text: cell.textContent.trim(), hidden: getComputedStyle(cell).display === 'none' }));
    [...table.tBodies].forEach(body => [...body.rows].forEach(row => {
      [...row.cells].forEach((cell, index) => {
        if (cell.colSpan > 1) return;
        cell.dataset.mobileLabel = columns[index]?.text || 'Acciones';
        cell.classList.toggle('atk-mobile-omit', !!columns[index]?.hidden);
      });
    }));
  });
}
