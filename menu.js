/* Nusvara — customer menu for table QR ordering.
 * Link format: <page>#s=<store slug>&m=<table>&t=<table token>
 * The menu is a public file written by the store's cashier; orders go to the
 * store's server and wait for the cashier to accept them. */
(function () {
  'use strict';
  const PROJECT = 'https://fycnvhkeuwyqjcymjgdi.supabase.co';
  const API = PROJECT + '/functions/v1/api';
  const MENU_FILE = PROJECT + '/storage/v1/object/public/public-menus/';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupiah = value => 'Rp ' + Math.round(Number(value) || 0).toLocaleString('id-ID');

  const params = new URLSearchParams(location.hash.slice(1));
  const ctx = { store: params.get('s') || '', table: params.get('m') || '', token: params.get('t') || '' };
  const ORDER_KEY = `nv_menu_order_${ctx.store}_${ctx.table}`;
  const NAME_KEY = 'nv_menu_name';
  const state = { menu: null, cart: [], item: null, qty: 1, polling: null };
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
  };

  function notice(text) { const box = $('notice'); box.textContent = text; box.hidden = !text; }

  async function api(path, options = {}) {
    const response = await fetch(API + path, { ...options, headers: { 'Content-Type': 'application/json' } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || 'Koneksi bermasalah. Coba lagi.');
    return body;
  }

  /* ── Menu ── */
  async function loadMenu() {
    if (!/^[a-z0-9]{12}$/.test(ctx.store) || !ctx.table || !ctx.token) {
      $('menu').innerHTML = '<p class="empty">Pindai QR yang ada di meja untuk melihat menu dan memesan.</p>';
      return;
    }
    $('table-label').textContent = `Meja ${ctx.table}`;
    try {
      // A new URL every 30 s so a changed menu is not served from an old cache.
      const response = await fetch(`${MENU_FILE}${ctx.store}.json?v=${Math.floor(Date.now() / 30000)}`);
      if (!response.ok) throw new Error('missing');
      state.menu = await response.json();
    } catch {
      $('menu').innerHTML = '<p class="empty">Menu belum tersedia. Silakan pesan langsung ke kasir.</p>';
      return;
    }
    const menu = state.menu;
    document.title = `Menu ${menu.store?.name || ''}`.trim();
    $('store-name').textContent = menu.store?.name || 'Menu';
    if (/^#[0-9a-fA-F]{6}$/.test(menu.store?.accent || '')) document.documentElement.style.setProperty('--accent', menu.store.accent);
    if (!menu.enabled) notice('Pemesanan lewat HP sedang ditutup. Menu tetap bisa dilihat; silakan pesan ke kasir.');
    renderMenu();
  }

  function itemPrice(item) {
    return item.variants?.length ? Math.min(...item.variants.map(v => v.price)) : item.price;
  }
  function renderMenu() {
    const { categories = [], items = [] } = state.menu;
    const used = categories.filter(c => items.some(i => i.category === c.id));
    const others = items.filter(i => !used.some(c => c.id === i.category));
    const sections = [...used.map(c => ({ id: c.id, label: c.label, items: items.filter(i => i.category === c.id) })),
      ...(others.length ? [{ id: 'lainnya', label: used.length ? 'Lainnya' : 'Menu', items: others }] : [])];
    $('cats').innerHTML = sections.length > 1 ? sections.map((s, i) => `<button type="button" data-cat="${esc(s.id)}" class="${i === 0 ? 'on' : ''}">${esc(s.label)}</button>`).join('') : '';
    $('menu').innerHTML = sections.map(s => `<section id="cat-${esc(s.id)}"><h2 class="cat-title">${esc(s.label)}</h2>${s.items.map(item => `
      <button type="button" class="item ${item.soldOut ? 'out' : ''}" data-item="${esc(item.id)}" ${item.soldOut ? 'aria-disabled="true"' : ''}>
        ${item.photo ? `<img class="thumb" src="${esc(item.photo)}" alt="">` : `<span class="thumb" aria-hidden="true">${esc(item.name.slice(0, 1).toUpperCase())}</span>`}
        <span><h3>${esc(item.name)}</h3>${item.description ? `<p>${esc(item.description)}</p>` : ''}
          <span class="price">${item.variants?.length ? 'mulai ' : ''}${rupiah(itemPrice(item))}</span>
          ${item.soldOut ? '<span class="badge">Habis</span>' : ''}</span>
        ${item.soldOut ? '' : '<span class="add" aria-hidden="true">+</span>'}
      </button>`).join('')}</section>`).join('') || '<p class="empty">Belum ada menu.</p>';
  }

  /* ── Item sheet ── */
  function openItem(id) {
    const item = state.menu.items.find(i => i.id === id);
    if (!item || item.soldOut) return;
    state.item = item; state.qty = 1;
    $('item-title').textContent = item.name;
    $('item-desc').textContent = item.description || '';
    const photo = $('item-photo');
    photo.hidden = !item.photo; if (item.photo) photo.src = item.photo;
    $('item-note').value = '';
    $('item-error').textContent = '';
    const variants = item.variants?.length ? `<div class="group"><h3>Pilih ukuran/varian <small>(wajib)</small></h3>${item.variants.map((v, i) => `
      <label class="opt"><input type="radio" name="variant" value="${esc(v.id)}" ${i === 0 ? 'checked' : ''}><span>${esc(v.label)}</span><em>${rupiah(v.price)}</em></label>`).join('')}</div>` : '';
    const groups = (item.groups || []).map(g => `<div class="group" data-group="${esc(g.id)}" data-max="${g.max}" data-required="${g.required}">
      <h3>${esc(g.name)} <small>(${g.required ? 'wajib' : 'opsional'}${g.max > 1 ? `, maks ${g.max}` : ''})</small></h3>
      ${g.options.map(o => `<label class="opt"><input type="${g.max === 1 ? 'radio' : 'checkbox'}" name="g-${esc(g.id)}" value="${esc(o.id)}"><span>${esc(o.name)}</span><em>${o.price ? '+' + rupiah(o.price) : 'gratis'}</em></label>`).join('')}</div>`).join('');
    $('item-options').innerHTML = variants + groups;
    updateItem();
    $('item-sheet').showModal();
  }
  function itemChoice() {
    const item = state.item;
    const variantId = item.variants?.length ? (document.querySelector('input[name="variant"]:checked')?.value || '') : '';
    const options = [...document.querySelectorAll('#item-options [data-group] input:checked')].map(i => i.value);
    let unit = item.variants?.length ? (item.variants.find(v => v.id === variantId)?.price || 0) : item.price;
    (item.groups || []).forEach(g => g.options.forEach(o => { if (options.includes(o.id)) unit += o.price; }));
    return { variantId, options, unit };
  }
  function updateItem() {
    const { unit } = itemChoice();
    $('item-qty').textContent = String(state.qty);
    $('item-add').textContent = `Tambah · ${rupiah(unit * state.qty)}`;
  }
  function addItem(event) {
    event.preventDefault();
    const item = state.item;
    for (const box of document.querySelectorAll('#item-options [data-group]')) {
      const picked = box.querySelectorAll('input:checked').length;
      const name = box.querySelector('h3').firstChild.textContent.trim();
      if (box.dataset.required === 'true' && !picked) { $('item-error').textContent = `Pilih ${name} dulu.`; return; }
      if (picked > Number(box.dataset.max)) { $('item-error').textContent = `${name} maksimal ${box.dataset.max}.`; return; }
    }
    const { variantId, options, unit } = itemChoice();
    const note = $('item-note').value.trim().slice(0, 120);
    const variant = item.variants?.find(v => v.id === variantId);
    const extras = (item.groups || []).flatMap(g => g.options.filter(o => options.includes(o.id)).map(o => o.name));
    const key = [item.id, variantId, [...options].sort().join('-'), note].join('|');
    const same = state.cart.find(line => line.key === key);
    if (same) same.qty = Math.min(50, same.qty + state.qty);
    else state.cart.push({ key, id: item.id, variantId, options, note, qty: state.qty, unit, name: variant ? `${item.name} (${variant.label})` : item.name, extras });
    $('item-sheet').close();
    renderCart();
  }

  /* ── Cart ── */
  function renderCart() {
    const count = state.cart.reduce((s, l) => s + l.qty, 0);
    const total = state.cart.reduce((s, l) => s + l.qty * l.unit, 0);
    $('cart-bar').hidden = !count || !$('status').hidden;
    $('cart-count').textContent = String(count);
    $('cart-total').textContent = rupiah(total);
    $('cart-sum').textContent = rupiah(total);
    $('cart-lines').innerHTML = state.cart.map((line, i) => `<li><span>${esc(line.name)}${line.extras.length ? `<small>+ ${esc(line.extras.join(', '))}</small>` : ''}${line.note ? `<small>Catatan: ${esc(line.note)}</small>` : ''}<small>${rupiah(line.unit * line.qty)}</small></span>
      <span class="line-qty"><button type="button" data-line="${i}" data-step="-1" aria-label="Kurangi">−</button><b>${line.qty}</b><button type="button" data-line="${i}" data-step="1" aria-label="Tambah">+</button></span></li>`).join('');
    if (!count && $('cart-sheet').open) $('cart-sheet').close();
  }
  async function send() {
    const button = $('cart-send');
    $('cart-error').textContent = '';
    if (!state.menu?.enabled) { $('cart-error').textContent = 'Pemesanan lewat HP sedang ditutup. Silakan pesan ke kasir.'; return; }
    button.disabled = true; button.textContent = 'Mengirim…';
    const name = $('cart-name').value.trim().slice(0, 40);
    store.set(NAME_KEY, name);
    try {
      const { order } = await api('/public/order', { method: 'POST', body: JSON.stringify({
        store: ctx.store, table: ctx.table, token: ctx.token, name, note: $('cart-note').value.trim().slice(0, 200),
        items: state.cart.map(l => ({ id: l.id, variantId: l.variantId, options: l.options, qty: l.qty, note: l.note })),
      }) });
      store.set(ORDER_KEY, { id: order.id, at: Date.now(), total: order.total, lines: state.cart.map(l => ({ name: l.name, qty: l.qty, extras: l.extras })) });
      state.cart = [];
      $('cart-note').value = '';
      $('cart-sheet').close();
      renderCart();
      showStatus({ status: 'pending' });
    } catch (error) {
      $('cart-error').textContent = error.message;
    } finally {
      button.disabled = false; button.textContent = 'Kirim pesanan ke kasir';
    }
  }

  /* ── Order status ── */
  const STATUS = {
    pending: ['⏳', 'Menunggu kasir…', 'Pesanan Anda sudah terkirim. Kasir akan memeriksanya sebentar lagi; halaman ini berubah sendiri.'],
    accepted: ['✅', 'Pesanan diterima!', 'Pesanan sedang disiapkan. Silakan bayar di kasir.'],
    rejected: ['⚠️', 'Pesanan tidak bisa diproses', ''],
    expired: ['⌛', 'Pesanan belum dijawab', 'Kasir belum sempat menjawab. Silakan panggil pelayan atau pesan langsung ke kasir.'],
  };
  function showStatus(order) {
    const saved = store.get(ORDER_KEY, null);
    const [icon, title, text] = STATUS[order.status] || STATUS.pending;
    $('status').hidden = false;
    $('menu').hidden = true; $('cats').hidden = true;
    $('status-icon').textContent = icon;
    $('status-title').textContent = title;
    $('status-text').textContent = order.status === 'rejected' ? `Alasan dari kasir: ${order.reason || '-'}` : text;
    $('status-lines').innerHTML = (saved?.lines || []).map(l => `<li><span>${l.qty}× ${esc(l.name)}${l.extras?.length ? `<small>+ ${esc(l.extras.join(', '))}</small>` : ''}</span></li>`).join('')
      + (saved ? `<li><strong>Total</strong><strong>${rupiah(saved.total)}</strong></li>` : '');
    $('status-again').hidden = order.status === 'pending';
    renderCart();
    clearTimeout(state.polling);
    if (order.status === 'pending' && saved && Date.now() - saved.at < 21 * 60000) {
      const wait = Date.now() - saved.at < 60000 ? 5000 : 10000;
      state.polling = setTimeout(checkStatus, wait);
    }
  }
  async function checkStatus() {
    const saved = store.get(ORDER_KEY, null);
    if (!saved) return;
    if (document.hidden) { state.polling = setTimeout(checkStatus, 10000); return; }
    try {
      const q = new URLSearchParams({ store: ctx.store, table: ctx.table, token: ctx.token, id: saved.id });
      const { order } = await api('/public/order?' + q);
      showStatus(order);
    } catch {
      state.polling = setTimeout(checkStatus, 15000);
    }
  }
  function backToMenu() {
    store.del(ORDER_KEY);
    clearTimeout(state.polling);
    $('status').hidden = true; $('menu').hidden = false; $('cats').hidden = false;
    renderCart();
    window.scrollTo(0, 0);
  }

  /* ── Events ── */
  $('menu').addEventListener('click', event => { const button = event.target.closest('[data-item]'); if (button) openItem(button.dataset.item); });
  $('cats').addEventListener('click', event => {
    const button = event.target.closest('[data-cat]');
    if (!button) return;
    document.querySelectorAll('#cats button').forEach(b => b.classList.toggle('on', b === button));
    document.getElementById('cat-' + button.dataset.cat)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('item-options').addEventListener('change', event => {
    const box = event.target.closest('[data-group]');
    if (box && event.target.type === 'checkbox' && box.querySelectorAll('input:checked').length > Number(box.dataset.max)) event.target.checked = false;
    $('item-error').textContent = '';
    updateItem();
  });
  $('item-sheet').addEventListener('click', event => {
    const step = event.target.closest('[data-qty]');
    if (step) { state.qty = Math.max(1, Math.min(50, state.qty + Number(step.dataset.qty))); updateItem(); }
  });
  $('item-form').addEventListener('submit', addItem);
  $('cart-bar').addEventListener('click', () => { $('cart-error').textContent = ''; $('cart-sheet').showModal(); });
  $('cart-lines').addEventListener('click', event => {
    const button = event.target.closest('[data-line]');
    if (!button) return;
    const line = state.cart[Number(button.dataset.line)];
    line.qty += Number(button.dataset.step);
    if (line.qty <= 0) state.cart.splice(Number(button.dataset.line), 1);
    renderCart();
  });
  $('cart-send').addEventListener('click', send);
  $('status-again').addEventListener('click', backToMenu);
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
  // Scanning another table's QR in the same tab only changes the #hash.
  window.addEventListener('hashchange', () => location.reload());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && store.get(ORDER_KEY, null) && !$('status').hidden) checkStatus(); });

  $('cart-name').value = store.get(NAME_KEY, '') || '';
  loadMenu().then(() => {
    const saved = store.get(ORDER_KEY, null);
    if (saved && Date.now() - saved.at < 6 * 3600000) { showStatus({ status: 'pending' }); checkStatus(); }
  });
})();
