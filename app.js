/* Dil Afroze Order Manager — app logic */
(function () {
  'use strict';

  /* ---------- CONSTANTS ---------- */
  var DEFAULT_CATEGORIES = ['Shampoo', 'Face & Body Soap', 'Face Wash', 'Body Lotion', 'Face Cream', 'Skin Care Set', 'Hair Bundles', 'Other'];
  var SHEET_ID = '1ccKmVjeOVZ5WVc8hn6oOfTGYMsqkJ6dfW1hof8gzr70';
  var STATUS_LABELS = { new: 'New', packaged: 'Packaged', shipped: 'Shipped', delivered: 'Delivered' };
  var DELIVERY_LABELS = { notset: 'Not set', pickup: 'Pickup', hand: 'Hand delivery', post: 'Post' };
  var PAYMENT_LABELS = { notset: 'Not set', cash: 'Cash', bank: 'Bank transfer' };
  var LS_PENDING = 'da_pending_sync';

  /* ---------- FIRESTORE REFS ---------- */
  var productsCol = daDb.collection('products');
  var ordersCol = daDb.collection('orders');
  var metaCol = daDb.collection('meta');
  var listenersStarted = false;
  var unsubscribers = [];

  /* ---------- STATE ---------- */
  var state = {
    products: [],
    categories: DEFAULT_CATEGORIES.slice(),
    orders: [],
    settings: { appsScriptUrl: '' },
    currentOrder: { customer: { name: '', phone: '', email: '', address: '', notes: '' }, items: [], discount: 0 },
    activeCatFilter: 'all',
    activeStatusFilter: 'all'
  };

  /* ---------- UTILS ---------- */
  function money(n) { return '£' + (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }
  function todayUK() {
    var d = new Date();
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function csvEscape(s) {
    var v = String(s == null ? '' : s);
    if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function resizeImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function onFirestoreError(err) {
    console.error('Firestore error:', err);
    toast('Sync error — check your connection');
  }

  /* ---------- APPS SCRIPT (GOOGLE SHEET) SYNC ---------- */
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function queuePush(payload) {
    var q = loadJSON(LS_PENDING, []);
    q.push(payload);
    localStorage.setItem(LS_PENDING, JSON.stringify(q));
  }
  function queueSet(q) { localStorage.setItem(LS_PENDING, JSON.stringify(q)); }

  function syncToSheet(payload) {
    var url = state.settings.appsScriptUrl;
    if (!url) return;
    sendPayload(url, payload).catch(function () { queuePush(payload); });
  }

  function sendPayload(url, payload) {
    var json = JSON.stringify(payload);
    try {
      var img = new Image();
      img.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'payload=' + encodeURIComponent(json);
    } catch (e) { /* ignore */ }
    return fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: json
    });
  }

  function flushPendingSync() {
    var url = state.settings.appsScriptUrl;
    if (!url) return;
    var q = loadJSON(LS_PENDING, []);
    if (!q.length) return;
    var remaining = [];
    var chain = Promise.resolve();
    q.forEach(function (payload) {
      chain = chain.then(function () {
        return sendPayload(url, payload).catch(function () { remaining.push(payload); });
      });
    });
    chain.then(function () { queueSet(remaining); });
  }

  window.addEventListener('online', flushPendingSync);

  /* ---------- MODAL ---------- */
  var overlay = document.getElementById('modalOverlay');
  var modalBox = document.getElementById('modalBox');
  function openModal(html) {
    modalBox.innerHTML = html;
    overlay.classList.add('open');
  }
  function closeModal() {
    overlay.classList.remove('open');
    modalBox.innerHTML = '';
  }
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

  /* ---------- TABS ---------- */
  document.getElementById('tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });

  /* ---------- COLLAPSIBLES ---------- */
  document.getElementById('customerToggle').addEventListener('click', function () {
    document.getElementById('customerCard').classList.toggle('open');
  });
  document.getElementById('customItemToggle').addEventListener('click', function () {
    document.getElementById('customItemCard').classList.toggle('open');
  });
  document.getElementById('customerCard').classList.add('open');

  /* ================= PRODUCTS TAB ================= */

  function renderProducts() {
    var container = document.getElementById('productsList');
    if (!state.products.length) {
      container.innerHTML = '<div class="empty-state">No products yet. Tap "+ Add Product" to get started.</div>';
      return;
    }
    var byCat = {};
    state.products.forEach(function (p) {
      (byCat[p.cat] = byCat[p.cat] || []).push(p);
    });
    var order = allCategoriesInOrder();
    var html = '';
    order.forEach(function (cat) {
      if (!byCat[cat] || !byCat[cat].length) return;
      html += '<div class="category-group"><div class="category-heading">' + escapeHtml(cat) + '</div>';
      byCat[cat].forEach(function (p) {
        html += '<div class="product-card">' +
          (p.img ? '<img class="product-thumb" src="' + p.img + '">' : '<div class="product-thumb placeholder">No photo</div>') +
          '<div class="product-info">' +
          '<div class="product-name">' + escapeHtml(p.name) + '</div>' +
          (p.desc ? '<div class="product-desc">' + escapeHtml(p.desc) + '</div>' : '') +
          '<div class="product-price">' + money(p.price) + '</div>' +
          '</div>' +
          '<div class="product-actions"><button class="icon-del" data-del-product="' + p.id + '" aria-label="Delete">' +
          '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-3h6l1 2H8l1-2ZM9 10v8m6-8v8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>' +
          '</button></div>' +
          '</div>';
      });
      html += '</div>';
    });
    container.innerHTML = html;
  }

  function allCategoriesInOrder() {
    var defaults = DEFAULT_CATEGORIES.filter(function (c) { return state.categories.indexOf(c) >= 0; });
    var customs = state.categories.filter(function (c) { return DEFAULT_CATEGORIES.indexOf(c) < 0; });
    return defaults.concat(customs);
  }

  document.getElementById('productsList').addEventListener('click', function (e) {
    var delBtn = e.target.closest('[data-del-product]');
    if (delBtn) {
      var id = delBtn.dataset.delProduct;
      var p = state.products.find(function (x) { return x.id === id; });
      if (p && confirm('Delete "' + p.name + '"? This cannot be undone.')) {
        productsCol.doc(id).delete().then(function () {
          toast('Product deleted');
        }).catch(onFirestoreError);
      }
    }
  });

  document.getElementById('addProductBtn').addEventListener('click', openAddProductModal);

  function categoryOptionsHtml(selected) {
    return allCategoriesInOrder().map(function (c) {
      return '<option value="' + escapeHtml(c) + '"' + (c === selected ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
    }).join('');
  }

  function openAddProductModal() {
    openModal(
      '<h2>Add Product</h2>' +
      '<label class="field"><span>Name *</span><input type="text" id="pName" placeholder="Product name"></label>' +
      '<label class="field"><span>Price (£) *</span><input type="number" id="pPrice" min="0" step="0.01" placeholder="0.00"></label>' +
      '<label class="field"><span>Description</span><textarea id="pDesc" rows="2" placeholder="Optional description"></textarea></label>' +
      '<label class="field"><span>Category</span><select id="pCat">' + categoryOptionsHtml() + '</select></label>' +
      '<label class="field"><span>Photo</span><input type="file" id="pPhoto" accept="image/*"></label>' +
      '<div class="photo-preview-row" id="pPhotoPreviewRow" style="display:none">' +
      '<img class="photo-preview" id="pPhotoPreview"><button class="btn btn-ghost btn-sm" id="pPhotoRemove">Remove</button></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="pCancel">Cancel</button><button class="btn btn-primary" id="pSave">Save</button></div>'
    );
    var photoData = '';
    document.getElementById('pPhoto').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      resizeImage(f, 480, 0.75).then(function (dataUrl) {
        photoData = dataUrl;
        document.getElementById('pPhotoPreview').src = dataUrl;
        document.getElementById('pPhotoPreviewRow').style.display = 'flex';
      });
    });
    document.getElementById('pPhotoRemove').addEventListener('click', function () {
      photoData = '';
      document.getElementById('pPhoto').value = '';
      document.getElementById('pPhotoPreviewRow').style.display = 'none';
    });
    document.getElementById('pCancel').addEventListener('click', closeModal);
    document.getElementById('pSave').addEventListener('click', function () {
      var name = document.getElementById('pName').value.trim();
      var price = parseFloat(document.getElementById('pPrice').value);
      var desc = document.getElementById('pDesc').value.trim();
      var cat = document.getElementById('pCat').value;
      if (!name) { toast('Please enter a product name'); return; }
      if (isNaN(price) || price < 0) { toast('Please enter a valid price'); return; }
      var saveBtn = document.getElementById('pSave');
      saveBtn.disabled = true;
      productsCol.add({
        name: name, price: price, desc: desc, cat: cat, img: photoData,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () {
        closeModal();
        toast('Product added');
      }).catch(function (err) {
        onFirestoreError(err);
        saveBtn.disabled = false;
      });
    });
  }

  document.getElementById('manageCatsBtn').addEventListener('click', openManageCategoriesModal);

  function openManageCategoriesModal() {
    renderCategoryModal();
  }

  function renderCategoryModal() {
    var order = allCategoriesInOrder();
    var rows = order.map(function (c) {
      var isDefault = DEFAULT_CATEGORIES.indexOf(c) >= 0;
      return '<div class="cat-manage-row' + (isDefault ? ' default' : '') + '"><span>' + escapeHtml(c) + (isDefault ? ' (default)' : '') + '</span>' +
        (isDefault ? '' : '<button class="icon-del" data-del-cat="' + escapeHtml(c) + '" aria-label="Delete category">✕</button>') +
        '</div>';
    }).join('');
    openModal(
      '<h2>Categories</h2>' +
      '<label class="field"><span>New category name</span><input type="text" id="newCatName" placeholder="e.g. Beard Oil"></label>' +
      '<button class="btn btn-primary btn-block" id="addCatBtn">Add Category</button>' +
      '<div style="margin-top:16px">' + rows + '</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost btn-block" id="catCloseBtn">Close</button></div>'
    );
    document.getElementById('addCatBtn').addEventListener('click', function () {
      var name = document.getElementById('newCatName').value.trim();
      if (!name) { toast('Enter a category name'); return; }
      if (state.categories.indexOf(name) >= 0) { toast('Category already exists'); return; }
      metaCol.doc('categories').update({ list: firebase.firestore.FieldValue.arrayUnion(name) }).then(function () {
        document.getElementById('newCatName').value = '';
        toast('Category added');
      }).catch(onFirestoreError);
    });
    document.getElementById('catCloseBtn').addEventListener('click', function () {
      closeModal();
    });
    modalBox.querySelectorAll('[data-del-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.dataset.delCat;
        var inUse = state.products.some(function (p) { return p.cat === cat; });
        if (inUse) { toast('Cannot delete — products use this category'); return; }
        if (!confirm('Delete category "' + cat + '"?')) return;
        metaCol.doc('categories').update({ list: firebase.firestore.FieldValue.arrayRemove(cat) }).then(function () {
          toast('Category deleted');
        }).catch(onFirestoreError);
      });
    });
  }

  // Re-render the open category modal whenever categories/products change underneath it
  function refreshCategoryModalIfOpen() {
    if (overlay.classList.contains('open') && document.getElementById('addCatBtn')) {
      renderCategoryModal();
    }
  }

  /* ================= NEW ORDER TAB ================= */

  ['custName', 'custPhone', 'custEmail', 'custAddress', 'custNotes'].forEach(function (id) {
    var key = id.replace('cust', '').toLowerCase();
    document.getElementById(id).addEventListener('input', function (e) {
      state.currentOrder.customer[key] = e.target.value;
    });
  });

  function renderNewOrderCatFilter() {
    var el = document.getElementById('orderCatFilter');
    var cats = ['all'].concat(allCategoriesInOrder());
    if (cats.indexOf(state.activeCatFilter) < 0) state.activeCatFilter = 'all';
    el.innerHTML = cats.map(function (c) {
      var label = c === 'all' ? 'All' : c;
      return '<button class="pill' + (state.activeCatFilter === c ? ' active' : '') + '" data-cat="' + escapeHtml(c) + '">' + escapeHtml(label) + '</button>';
    }).join('');
  }
  document.getElementById('orderCatFilter').addEventListener('click', function (e) {
    var btn = e.target.closest('.pill');
    if (!btn) return;
    state.activeCatFilter = btn.dataset.cat;
    renderNewOrderCatFilter();
    renderNewOrderProducts();
  });

  function findOrderItem(pid) {
    return state.currentOrder.items.find(function (it) { return it.pid === pid; });
  }

  function renderNewOrderProducts() {
    var container = document.getElementById('orderProductsList');
    var list = state.products.filter(function (p) {
      return state.activeCatFilter === 'all' || p.cat === state.activeCatFilter;
    });
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">No products in this category.</div>';
      return;
    }
    container.innerHTML = list.map(function (p) {
      var item = findOrderItem(p.id);
      var adjusted = item && (item.name !== p.name || item.price !== p.price);
      var top = '<div class="opc-top">' +
        (p.img ? '<img class="product-thumb" src="' + p.img + '">' : '<div class="product-thumb placeholder">No photo</div>') +
        '<div class="opc-info"><div class="opc-name">' + escapeHtml(item ? item.name : p.name) +
        (item && item.gift ? '<span class="gift-tag">GIFT</span>' : '') +
        (adjusted ? '<span class="adjusted-badge">adjusted</span>' : '') +
        '</div>' +
        '<div class="opc-price' + (item && item.gift ? ' gift' : '') + '">' + money(item ? item.price : p.price) + '</div></div>';
      var controls;
      if (!item) {
        top += '<div class="opc-controls"><button class="btn btn-primary btn-sm" data-add-pid="' + p.id + '">Add</button></div></div>';
        controls = '';
      } else {
        top += '<div class="opc-controls">' +
          '<button class="toggle-gift-btn' + (item.gift ? ' active' : '') + '" data-gift-pid="' + p.id + '">GIFT</button>' +
          '<button class="qty-btn" data-qty-pid="' + p.id + '" data-delta="-1">−</button>' +
          '<span class="qty-val">' + item.qty + '</span>' +
          '<button class="qty-btn" data-qty-pid="' + p.id + '" data-delta="1">+</button>' +
          '<button class="pencil-btn" data-edit-pid="' + p.id + '" aria-label="Edit">✏️</button>' +
          '</div></div>';
        controls = '<div class="edit-panel" id="edit-' + p.id + '">' +
          '<label class="field"><span>Name for this order</span><input type="text" data-edit-name="' + p.id + '" value="' + escapeHtml(item.name) + '"></label>' +
          '<label class="field"><span>Price for this order (£)</span><input type="number" min="0" step="0.01" data-edit-price="' + p.id + '" value="' + item.price + '"></label>' +
          '<div class="modal-actions">' +
          '<button class="btn btn-ghost btn-sm" data-edit-reset="' + p.id + '">Reset</button>' +
          '<button class="btn btn-primary btn-sm" data-edit-save="' + p.id + '">Save</button>' +
          '</div></div>';
      }
      return '<div class="order-product-card" data-card-pid="' + p.id + '">' + top + controls + '</div>';
    }).join('');
  }

  document.getElementById('orderProductsList').addEventListener('click', function (e) {
    var addBtn = e.target.closest('[data-add-pid]');
    if (addBtn) {
      var p = state.products.find(function (x) { return x.id === addBtn.dataset.addPid; });
      state.currentOrder.items.push({ pid: p.id, name: p.name, price: p.price, qty: 1, gift: false, isCustom: false });
      renderNewOrderProducts();
      renderSummary();
      return;
    }
    var qtyBtn = e.target.closest('[data-qty-pid]');
    if (qtyBtn) {
      var item = findOrderItem(qtyBtn.dataset.qtyPid);
      var delta = parseInt(qtyBtn.dataset.delta, 10);
      item.qty += delta;
      if (item.qty <= 0) {
        state.currentOrder.items = state.currentOrder.items.filter(function (it) { return it !== item; });
      }
      renderNewOrderProducts();
      renderSummary();
      return;
    }
    var giftBtn = e.target.closest('[data-gift-pid]');
    if (giftBtn) {
      var gi = findOrderItem(giftBtn.dataset.giftPid);
      gi.gift = !gi.gift;
      renderNewOrderProducts();
      renderSummary();
      return;
    }
    var editBtn = e.target.closest('[data-edit-pid]');
    if (editBtn) {
      var panel = document.getElementById('edit-' + editBtn.dataset.editPid);
      panel.classList.toggle('open');
      return;
    }
    var saveBtn = e.target.closest('[data-edit-save]');
    if (saveBtn) {
      var pid = saveBtn.dataset.editSave;
      var it = findOrderItem(pid);
      var nameInput = document.querySelector('[data-edit-name="' + pid + '"]');
      var priceInput = document.querySelector('[data-edit-price="' + pid + '"]');
      var newName = nameInput.value.trim();
      var newPrice = parseFloat(priceInput.value);
      if (newName) it.name = newName;
      if (!isNaN(newPrice) && newPrice >= 0) it.price = newPrice;
      renderNewOrderProducts();
      renderSummary();
      toast('Item adjusted for this order');
      return;
    }
    var resetBtn = e.target.closest('[data-edit-reset]');
    if (resetBtn) {
      var rpid = resetBtn.dataset.editReset;
      var rit = findOrderItem(rpid);
      var prod = state.products.find(function (x) { return x.id === rpid; });
      rit.name = prod.name;
      rit.price = prod.price;
      renderNewOrderProducts();
      renderSummary();
      return;
    }
  });

  document.getElementById('addCustomItemBtn').addEventListener('click', function () {
    var name = document.getElementById('ciName').value.trim();
    var price = parseFloat(document.getElementById('ciPrice').value);
    var qty = parseInt(document.getElementById('ciQty').value, 10) || 1;
    var gift = document.getElementById('ciGift').checked;
    if (!name) { toast('Enter an item name'); return; }
    if (isNaN(price) || price < 0) { toast('Enter a valid price'); return; }
    state.currentOrder.items.push({ pid: null, name: name, price: price, qty: qty, gift: gift, isCustom: true });
    document.getElementById('ciName').value = '';
    document.getElementById('ciPrice').value = '';
    document.getElementById('ciQty').value = 1;
    document.getElementById('ciGift').checked = false;
    document.getElementById('customItemCard').classList.remove('open');
    renderSummary();
    toast('Item added to order');
  });

  function renderSummary() {
    var items = state.currentOrder.items;
    var summaryCard = document.getElementById('orderSummary');
    if (!items.length) { summaryCard.style.display = 'none'; return; }
    summaryCard.style.display = 'block';
    var html = items.map(function (it, idx) {
      return '<div class="summary-row"><span class="sr-name">' + escapeHtml(it.name) + ' × ' + it.qty +
        (it.gift ? '<span class="gift-tag">GIFT</span>' : '') + '</span>' +
        '<span class="sr-amt' + (it.gift ? ' gift' : '') + '">' + money(it.gift ? 0 : it.price * it.qty) + '</span>' +
        (it.isCustom ? '<button class="icon-del" data-rm-custom="' + idx + '" style="margin-left:6px">✕</button>' : '') +
        '</div>';
    }).join('');
    document.getElementById('summaryItems').innerHTML = html;
    var subtotal = items.reduce(function (s, it) { return s + (it.gift ? 0 : it.price * it.qty); }, 0);
    var discount = parseFloat(document.getElementById('orderDiscount').value) || 0;
    var total = Math.max(0, subtotal - discount);
    document.getElementById('summaryTotal').textContent = money(total);
    state.currentOrder.discount = discount;
  }
  document.getElementById('orderDiscount').addEventListener('input', renderSummary);
  document.getElementById('summaryItems').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm-custom]');
    if (!rm) return;
    state.currentOrder.items.splice(parseInt(rm.dataset.rmCustom, 10), 1);
    renderSummary();
  });

  function createOrderInFirestore(orderData) {
    var counterRef = metaCol.doc('counter');
    var newOrderRef = ordersCol.doc();
    return daDb.runTransaction(function (tx) {
      return tx.get(counterRef).then(function (snap) {
        var current = (snap.exists && snap.data().value) || 0;
        var next = current + 1;
        var orderNumber = 'DA' + String(next).padStart(4, '0');
        tx.set(counterRef, { value: next }, { merge: true });
        orderData.orderNumber = orderNumber;
        tx.set(newOrderRef, orderData);
        return orderNumber;
      });
    });
  }

  document.getElementById('saveOrderBtn').addEventListener('click', function () {
    var c = state.currentOrder.customer;
    if (!c.name || !c.name.trim()) { toast('Customer name is required'); document.getElementById('customerCard').classList.add('open'); return; }
    if (!state.currentOrder.items.length) { toast('Add at least one item'); return; }

    var subtotal = state.currentOrder.items.reduce(function (s, it) { return s + (it.gift ? 0 : it.price * it.qty); }, 0);
    var discount = state.currentOrder.discount || 0;
    var total = Math.max(0, subtotal - discount);
    var date = todayUK();
    var orderData = {
      date: date,
      customer: {
        name: c.name.trim(), phone: c.phone || '', email: c.email || '',
        address: c.address || '', notes: c.notes || ''
      },
      items: state.currentOrder.items.map(function (it) {
        return { pid: it.pid, name: it.name, price: it.price, qty: it.qty, gift: !!it.gift };
      }),
      discount: discount,
      subtotal: subtotal,
      total: total,
      delivery: 'notset',
      payment: 'notset',
      status: 'new',
      dates: { created: date, packaged: '', shipped: '', delivered: '', paid: '' },
      driveLink: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    var saveBtn = document.getElementById('saveOrderBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    createOrderInFirestore(orderData).then(function (orderNumber) {
      syncToSheet({ action: 'create', orderNumber: orderNumber, customer: orderData.customer.name, total: orderData.total, date: orderData.date });

      state.currentOrder = { customer: { name: '', phone: '', email: '', address: '', notes: '' }, items: [], discount: 0 };
      ['custName', 'custPhone', 'custEmail', 'custAddress', 'custNotes'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('orderDiscount').value = 0;
      renderNewOrderProducts();
      renderSummary();
      document.getElementById('customerCard').classList.add('open');

      toast('Order ' + orderNumber + ' saved');
      document.querySelector('.tab-btn[data-tab="orders"]').click();
    }).catch(function (err) {
      console.error(err);
      if (!navigator.onLine) {
        toast('You’re offline — connect to the internet to save new orders');
      } else {
        toast('Could not save order — please try again');
      }
    }).finally(function () {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Order';
    });
  });

  /* ================= ORDERS TAB ================= */

  document.getElementById('statusFilter').addEventListener('click', function (e) {
    var btn = e.target.closest('.pill');
    if (!btn) return;
    state.activeStatusFilter = btn.dataset.status;
    document.querySelectorAll('#statusFilter .pill').forEach(function (b) { b.classList.toggle('active', b === btn); });
    renderOrders();
  });

  function orderItemsSummary(order) {
    return order.items.map(function (it) { return it.name + ' ×' + it.qty + (it.gift ? ' (gift)' : ''); }).join(', ');
  }

  function renderOrders() {
    var container = document.getElementById('ordersList');
    var list = state.orders.filter(function (o) {
      return state.activeStatusFilter === 'all' || o.status === state.activeStatusFilter;
    });
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">No orders yet.</div>';
      return;
    }
    container.innerHTML = list.map(function (o) {
      return '<div class="order-card" data-order-id="' + o.id + '">' +
        '<div class="order-card-head">' +
        '<div><div class="order-number">' + o.orderNumber + '</div><div class="order-date">' + o.date + '</div></div>' +
        '<span class="status-badge status-' + o.status + '">' + STATUS_LABELS[o.status] + '</span>' +
        '</div>' +
        '<div class="order-customer"><strong>' + escapeHtml(o.customer.name) + '</strong>' + (o.customer.phone ? ' <span class="oc-phone">· ' + escapeHtml(o.customer.phone) + '</span>' : '') + '</div>' +
        '<div class="order-items-summary">' + escapeHtml(orderItemsSummary(o)) + '</div>' +
        '<div class="order-total-line">Total: ' + money(o.total) + '</div>' +
        '<div class="order-controls-grid">' +
        '<label class="field"><span>Delivery method</span><select data-delivery="' + o.id + '">' +
        Object.keys(DELIVERY_LABELS).map(function (k) { return '<option value="' + k + '"' + (o.delivery === k ? ' selected' : '') + '>' + DELIVERY_LABELS[k] + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="field"><span>Payment method</span><select data-payment="' + o.id + '">' +
        Object.keys(PAYMENT_LABELS).map(function (k) { return '<option value="' + k + '"' + (o.payment === k ? ' selected' : '') + '>' + PAYMENT_LABELS[k] + '</option>'; }).join('') +
        '</select></label>' +
        '<button class="paid-btn' + (o.dates.paid ? ' paid' : '') + '" data-toggle-paid="' + o.id + '">' + (o.dates.paid ? '✓ Paid on ' + o.dates.paid : 'Mark as Paid') + '</button>' +
        '<label class="field"><span>Packing slip link (Google Drive)</span><input type="url" placeholder="Paste Drive link" data-drive-link="' + o.id + '" value="' + escapeHtml(o.driveLink) + '"></label>' +
        '<label class="field"><span>Status</span><select data-status-update="' + o.id + '">' +
        Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + STATUS_LABELS[k] + '</option>'; }).join('') +
        '</select></label>' +
        '</div>' +
        '<div class="order-card-actions"><button class="btn btn-brown" data-print="' + o.id + '">Print Packing Slip</button></div>' +
        '</div>';
    }).join('');
  }

  function getOrder(id) { return state.orders.find(function (o) { return o.id === id; }); }

  document.getElementById('ordersList').addEventListener('click', function (e) {
    var paidBtn = e.target.closest('[data-toggle-paid]');
    if (paidBtn) {
      var o = getOrder(paidBtn.dataset.togglePaid);
      if (o.dates.paid) {
        ordersCol.doc(o.id).update({ 'dates.paid': '' }).then(function () {
          syncToSheet({ action: 'unpaid', orderNumber: o.orderNumber });
        }).catch(onFirestoreError);
      } else {
        var d = todayUK();
        ordersCol.doc(o.id).update({ 'dates.paid': d }).then(function () {
          syncToSheet({ action: 'paid', orderNumber: o.orderNumber, date: d });
        }).catch(onFirestoreError);
      }
      return;
    }
    var printBtn = e.target.closest('[data-print]');
    if (printBtn) {
      printPackingSlip(getOrder(printBtn.dataset.print));
      return;
    }
  });

  document.getElementById('ordersList').addEventListener('change', function (e) {
    var del = e.target.closest('[data-delivery]');
    if (del) { ordersCol.doc(del.dataset.delivery).update({ delivery: del.value }).catch(onFirestoreError); return; }
    var pay = e.target.closest('[data-payment]');
    if (pay) { ordersCol.doc(pay.dataset.payment).update({ payment: pay.value }).catch(onFirestoreError); return; }
    var st = e.target.closest('[data-status-update]');
    if (st) {
      var o = getOrder(st.dataset.statusUpdate);
      var update = { status: st.value };
      var d = todayUK();
      if (o.dates.hasOwnProperty(st.value)) {
        update['dates.' + st.value] = d;
      }
      ordersCol.doc(o.id).update(update).then(function () {
        if (o.dates.hasOwnProperty(st.value)) {
          syncToSheet({ action: 'status', orderNumber: o.orderNumber, status: st.value, date: d });
        }
      }).catch(onFirestoreError);
      return;
    }
  });
  document.getElementById('ordersList').addEventListener('blur', function (e) {
    var link = e.target.closest('[data-drive-link]');
    if (!link) return;
    var o = getOrder(link.dataset.driveLink);
    var val = link.value.trim();
    if (o.driveLink !== val) {
      ordersCol.doc(o.id).update({ driveLink: val }).then(function () {
        syncToSheet({ action: 'link', orderNumber: o.orderNumber, link: val });
        toast('Packing slip link saved');
      }).catch(onFirestoreError);
    }
  }, true);

  /* ---------- CSV EXPORT ---------- */
  document.getElementById('downloadCsvBtn').addEventListener('click', function () {
    var cols = ['Order', 'Customer', 'Total', 'Created', 'Packaged', 'Shipped', 'Delivered', 'Paid', 'Packing Slip Link', 'Delivery', 'Payment', 'Notes'];
    var rows = [cols.join(',')];
    state.orders.forEach(function (o) {
      rows.push([
        o.orderNumber, o.customer.name, o.total.toFixed(2), o.dates.created, o.dates.packaged, o.dates.shipped,
        o.dates.delivered, o.dates.paid, o.driveLink, DELIVERY_LABELS[o.delivery] || '', PAYMENT_LABELS[o.payment] || '', o.customer.notes || ''
      ].map(csvEscape).join(','));
    });
    var blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'dil_afroze_orders_' + pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '-' + d.getFullYear() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  /* ---------- PACKING SLIP ---------- */
  function printPackingSlip(o) {
    var itemsRows = o.items.map(function (it) {
      var prod = it.pid ? state.products.find(function (p) { return p.id === it.pid; }) : null;
      var img = prod && prod.img ? '<img src="' + prod.img + '" style="width:48px;height:48px;border-radius:8px;object-fit:cover">' : '';
      var nameCell = escapeHtml(it.name) + (it.gift ? ' <span style="border:1px solid #825b2f;color:#825b2f;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:4px">GIFT</span>' : '') + ' × ' + it.qty;
      var amtCell = it.gift
        ? '<span style="text-decoration:line-through;color:#999">' + money(it.price * it.qty) + '</span> <span style="color:#328788;font-weight:bold">FREE</span>'
        : money(it.price * it.qty);
      return '<tr><td style="padding:8px;border-bottom:1px solid #eee">' + img + '</td>' +
        '<td style="padding:8px;border-bottom:1px solid #eee">' + nameCell + '</td>' +
        '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + amtCell + '</td></tr>';
    }).join('');
    var discountRow = o.discount > 0
      ? '<tr><td></td><td style="padding:8px;color:#888">Discount</td><td style="padding:8px;text-align:right;color:#888">− ' + money(o.discount) + '</td></tr>'
      : '';
    var notesBox = o.customer.notes
      ? '<div style="background:#f4f4f4;border-radius:8px;padding:12px;margin-top:20px;font-size:13px"><strong>Notes:</strong> ' + escapeHtml(o.customer.notes) + '</div>'
      : '';
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + o.orderNumber + ' — Packing Slip</title>' +
      '<style>' +
      'body{font-family:Georgia,"Times New Roman",serif;color:#2b2622;max-width:650px;margin:0 auto;padding:16px}' +
      '.print-bar{display:flex;justify-content:flex-end;margin-bottom:14px}' +
      '.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}' +
      '.hdr-left img{height:46px}' +
      '.hdr-left .tag{color:#825b2f;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:4px}' +
      '.hdr-right{text-align:right}' +
      '.hdr-right .onum{font-weight:bold;font-size:16px;color:#328788}' +
      '.ship-to{background:#fff6f4;border-radius:12px;padding:14px 16px;margin-bottom:20px}' +
      '.ship-to .label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#825b2f;margin-bottom:6px}' +
      'table{width:100%;border-collapse:collapse}' +
      'thead th{background:#328788;color:#fff;padding:8px;text-align:left;font-size:12px;text-transform:uppercase}' +
      '.total-row{display:flex;justify-content:flex-end;font-size:20px;font-weight:bold;color:#328788;padding-top:12px;border-top:2px solid #328788;margin-top:6px}' +
      '.footer{text-align:center;margin-top:34px;font-size:13px;color:#555}' +
      '.footer a{color:#328788}' +
      '.print-btn{background:#825b2f;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:13px;cursor:pointer}' +
      '@media print{.print-bar{display:none}}' +
      '</style></head><body>' +
      '<div class="print-bar"><button class="print-btn" onclick="window.print()">Print / Save as PDF</button></div>' +
      '<div class="hdr"><div class="hdr-left">' +
      '<img src="' + new URL('icons/logo.png', document.baseURI).href + '" onerror="this.style.display=\'none\';document.getElementById(\'fallbackWordmark\').style.display=\'block\'">' +
      '<div id="fallbackWordmark" style="display:none;font-size:22px;font-weight:bold;color:#825b2f;letter-spacing:1px">DIL AFROZE</div>' +
      '<div class="tag">Natural Skin &amp; Hair Care</div></div>' +
      '<div class="hdr-right"><div class="onum">' + o.orderNumber + '</div><div>' + o.date + '</div></div></div>' +
      '<div class="ship-to"><div class="label">Ship To</div>' +
      '<div style="font-weight:bold">' + escapeHtml(o.customer.name) + '</div>' +
      (o.customer.address ? '<div>' + escapeHtml(o.customer.address).replace(/\n/g, '<br>') + '</div>' : '') +
      (o.customer.phone ? '<div>' + escapeHtml(o.customer.phone) + '</div>' : '') +
      (o.customer.email ? '<div>' + escapeHtml(o.customer.email) + '</div>' : '') +
      '</div>' +
      '<table><thead><tr><th style="width:60px"></th><th>Product</th><th style="text-align:right">Amount</th></tr></thead>' +
      '<tbody>' + itemsRows + discountRow + '</tbody></table>' +
      '<div class="total-row">' + money(o.total) + '</div>' +
      notesBox +
      '<div class="footer">Thank you for your order ♥<br>' +
      '<a href="https://www.dilafroze.co.uk">www.dilafroze.co.uk</a><br>' +
      '📱 WhatsApp: 07577 756 348</div>' +
      '</body></html>';
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var win = window.open(url, '_blank');
    if (!win) toast('Please allow pop-ups to view the packing slip');
  }

  /* ================= SETTINGS ================= */
  document.getElementById('settingsBtn').addEventListener('click', function () {
    openModal(
      '<h2>Settings</h2>' +
      '<label class="field"><span>Google Apps Script Web App URL</span>' +
      '<input type="url" id="stAppsUrl" placeholder="https://script.google.com/macros/s/.../exec" value="' + escapeHtml(state.settings.appsScriptUrl || '') + '"></label>' +
      '<p style="font-size:12px;color:#766a5f">Orders will sync automatically to your Google Sheet once this is set. This is shared across all devices signed in. See README for setup instructions.</p>' +
      '<a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit" target="_blank" style="font-size:13px;color:#328788">Open Google Sheet →</a>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="stCancel">Cancel</button><button class="btn btn-primary" id="stSave">Save</button></div>' +
      '<div class="modal-actions"><button class="btn btn-danger btn-block" id="stSignOut">Sign Out of This Device</button></div>'
    );
    document.getElementById('stCancel').addEventListener('click', closeModal);
    document.getElementById('stSave').addEventListener('click', function () {
      var url = document.getElementById('stAppsUrl').value.trim();
      metaCol.doc('settings').set({ appsScriptUrl: url }, { merge: true }).then(function () {
        closeModal();
        toast('Settings saved');
        flushPendingSync();
      }).catch(onFirestoreError);
    });
    document.getElementById('stSignOut').addEventListener('click', function () {
      if (confirm('Sign out on this device? You’ll need the PIN to open the app again here.')) {
        closeModal();
        daAuth.signOut();
      }
    });
  });

  /* ---------- SERVICE WORKER ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  /* ---------- AUTH GATE ---------- */
  var pinForm = document.getElementById('pinForm');
  var pinInput = document.getElementById('pinInput');
  var pinError = document.getElementById('pinError');
  var pinSubmitBtn = document.getElementById('pinSubmitBtn');

  pinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    pinError.textContent = '';
    pinSubmitBtn.disabled = true;
    pinSubmitBtn.textContent = 'Unlocking…';
    daAuth.signInWithEmailAndPassword(DA_SHARED_AUTH_EMAIL, pinInput.value).catch(function () {
      pinError.textContent = 'Incorrect PIN. Please try again.';
    }).finally(function () {
      pinSubmitBtn.disabled = false;
      pinSubmitBtn.textContent = 'Unlock';
    });
  });

  function ensureDoc(ref, defaults) {
    return ref.get().then(function (snap) {
      if (!snap.exists) return ref.set(defaults);
    });
  }

  function startListeners() {
    if (listenersStarted) return;
    listenersStarted = true;

    Promise.all([
      ensureDoc(metaCol.doc('categories'), { list: DEFAULT_CATEGORIES.slice() }),
      ensureDoc(metaCol.doc('counter'), { value: 0 }),
      ensureDoc(metaCol.doc('settings'), { appsScriptUrl: '' })
    ]).catch(onFirestoreError);

    unsubscribers.push(productsCol.onSnapshot(function (snap) {
      state.products = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      state.products.sort(function (a, b) { return a.name.localeCompare(b.name); });
      renderProducts();
      renderNewOrderProducts();
      refreshCategoryModalIfOpen();
    }, onFirestoreError));

    unsubscribers.push(metaCol.doc('categories').onSnapshot(function (doc) {
      state.categories = (doc.exists && doc.data().list) ? doc.data().list : DEFAULT_CATEGORIES.slice();
      renderNewOrderCatFilter();
      renderProducts();
      renderNewOrderProducts();
      refreshCategoryModalIfOpen();
    }, onFirestoreError));

    unsubscribers.push(ordersCol.orderBy('createdAt', 'desc').onSnapshot(function (snap) {
      state.orders = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderOrders();
    }, onFirestoreError));

    unsubscribers.push(metaCol.doc('settings').onSnapshot(function (doc) {
      state.settings = doc.exists ? doc.data() : { appsScriptUrl: '' };
    }, onFirestoreError));

    renderNewOrderCatFilter();
    renderSummary();
    flushPendingSync();
  }

  function stopListeners() {
    unsubscribers.forEach(function (unsub) { unsub(); });
    unsubscribers = [];
    listenersStarted = false;
    state.products = [];
    state.categories = DEFAULT_CATEGORIES.slice();
    state.orders = [];
  }

  daAuth.onAuthStateChanged(function (user) {
    if (user) {
      document.getElementById('authGate').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      pinInput.value = '';
      pinError.textContent = '';
      startListeners();
    } else {
      document.getElementById('app').classList.add('hidden');
      document.getElementById('authGate').classList.remove('hidden');
      stopListeners();
    }
  });
})();
