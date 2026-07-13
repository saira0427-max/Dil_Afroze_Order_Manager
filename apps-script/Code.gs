/**
 * Dil Afroze Order Manager — Google Sheets sync webhook.
 * Deploy this as a Google Apps Script Web App bound to the Orders spreadsheet.
 * See ../README.md for full deployment steps.
 */

// Fill these in once you've created your Drive folder and packing-slip
// template Doc — see README.md "Automatic packing-slip PDFs" for how to
// build the template and get these two IDs from their Drive URLs.
var DRIVE_FOLDER_ID = '1yMk5AykdcRGjnUU-8sg44IReUiHuni-e';
var TEMPLATE_DOC_ID = '1yub3aD2gChV9M38lgb_Oz9tqc10hTDkiU4XYAKSP-TM';
var FIREBASE_PROJECT_ID = 'dil-afroze-orders';

function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  try {
    if (d.action == 'generateSlip') {
      generateSlip(d);
    } else {
      go(d);
    }
  } catch (err) {
    logDebug('doPost(' + (d.action || '?') + ' ' + (d.orderNumber || '') + ')', err.message + '\n' + err.stack);
  }
  return ContentService.createTextOutput('ok');
}

function logDebug(context, message) {
  var b = SpreadsheetApp.getActiveSpreadsheet();
  var s = b.getSheetByName('Debug') || b.insertSheet('Debug');
  if (s.getLastRow() === 0) s.appendRow(['Time', 'Context', 'Message']);
  s.appendRow([new Date(), context, message]);
}

function doGet(e) {
  if (e.parameter.payload) go(JSON.parse(e.parameter.payload));
  return ContentService.createTextOutput('ok');
}

function go(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    goLocked(d);
  } finally {
    lock.releaseLock();
  }
}

// Guards against two near-simultaneous requests (e.g. two devices syncing
// at once) both deciding a row doesn't exist yet and both appending one.
function goLocked(d) {
  var b = SpreadsheetApp.getActiveSpreadsheet();
  var s = b.getSheetByName('Orders') || b.insertSheet('Orders');

  if (s.getLastRow() === 0) {
    s.appendRow(['Order', 'Customer', 'Total', 'Created', 'Packaged', 'Shipped', 'Delivered', 'Paid', 'Link']);
    var header = s.getRange(1, 1, 1, 9);
    header.setBackground('#328788');
    header.setFontColor('#ffffff');
    header.setFontWeight('bold');
    s.setFrozenRows(1);
  }

  var n = s.getLastRow();
  var r = -1;
  if (n > 1) {
    var v = s.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) {
      if (v[i][0] == d.orderNumber) { r = i + 2; }
    }
  }

  if (d.action == 'create' && r < 0) {
    s.appendRow([d.orderNumber, d.customer, d.total, d.date, '', '', '', '', '']);
    r = s.getLastRow();
  }

  if (r > 0) {
    if (d.action == 'delete') { s.deleteRow(r); return; }
    if (d.status == 'packaged') { s.getRange(r, 5).setValue(d.date); }
    if (d.status == 'shipped') { s.getRange(r, 6).setValue(d.date); }
    if (d.status == 'delivered') { s.getRange(r, 7).setValue(d.date); }
    if (d.action == 'paid') { s.getRange(r, 8).setValue(d.date); }
    if (d.action == 'unpaid') { s.getRange(r, 8).setValue(''); }
    if (d.action == 'link') { s.getRange(r, 9).setValue(d.link); }
  }
}

/**
 * Fills the packing-slip template Doc for this order, exports it as a PDF
 * into DRIVE_FOLDER_ID, and writes the resulting link back into both the
 * Sheet and the order's Firestore document (driveLink field).
 */
// replaceText() treats its search pattern as a regex, so the literal
// {{ }} braces must be escaped, and any $ or \ in the replacement text
// (which could appear in a customer's name/address/notes) must be
// escaped too, since replacement strings support $-backreferences.
function tag(name) {
  return '\\{\\{' + name + '\\}\\}';
}
function safeReplacement(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
}

function generateSlip(d) {
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var copyFile = DriveApp.getFileById(TEMPLATE_DOC_ID).makeCopy('Packing Slip ' + d.orderNumber, folder);
  var doc = DocumentApp.openById(copyFile.getId());
  var body = doc.getBody();

  body.replaceText(tag('ORDER_NUMBER'), safeReplacement(d.orderNumber));
  body.replaceText(tag('DATE'), safeReplacement(d.date));
  body.replaceText(tag('CUSTOMER_NAME'), safeReplacement(d.customerName));
  body.replaceText(tag('CUSTOMER_ADDRESS'), safeReplacement((d.customerAddress || '').replace(/\n/g, ', ')));
  body.replaceText(tag('CUSTOMER_PHONE'), safeReplacement(d.customerPhone));
  body.replaceText(tag('CUSTOMER_EMAIL'), safeReplacement(d.customerEmail));
  body.replaceText(tag('DISCOUNT_LINE'), safeReplacement(d.discountLine));
  body.replaceText(tag('TOTAL'), safeReplacement(d.total));
  body.replaceText(tag('NOTES'), safeReplacement(d.notes ? ('Notes: ' + d.notes) : ''));

  fillItemsTable(body, d.items || []);

  doc.saveAndClose();

  var pdfBlob = DriveApp.getFileById(copyFile.getId()).getAs('application/pdf');
  pdfBlob.setName('Packing Slip ' + d.orderNumber + '.pdf');
  var pdfFile = folder.createFile(pdfBlob);
  copyFile.setTrashed(true); // only keep the final PDF, not the intermediate Doc copy

  var link = pdfFile.getUrl();
  writeLinkToSheet(d.orderNumber, link);
  if (d.docId) writeLinkToFirestore(d.docId, link);
}

function fillItemsTable(body, items) {
  var tables = body.getTables();
  var itemsTable = null, templateRowIndex = -1;
  for (var t = 0; t < tables.length; t++) {
    var tbl = tables[t];
    for (var r = 0; r < tbl.getNumRows(); r++) {
      if (tbl.getRow(r).getText().indexOf('{{ITEM_LINE}}') >= 0) {
        itemsTable = tbl;
        templateRowIndex = r;
        break;
      }
    }
    if (itemsTable) break;
  }
  if (!itemsTable || !items.length) return;

  // Insert one fresh row per item (cloned from the untouched template row),
  // then remove the original template row at the end. Reusing the template
  // row in place for the first item would mean every later clone copies
  // that item's already-substituted text instead of the blank placeholders.
  var templateRow = itemsTable.getRow(templateRowIndex);
  items.forEach(function (item, idx) {
    var row = itemsTable.insertTableRow(templateRowIndex + idx, templateRow.copy());
    row.getCell(0).replaceText(tag('ITEM_LINE'), safeReplacement(item.line));
    row.getCell(1).replaceText(tag('ITEM_AMOUNT'), safeReplacement(item.amount));
    if (item.img) {
      try {
        logDebug('image-attempt', item.line + ' — received ' + item.img.length + ' chars, starts "' + item.img.slice(0, 24) + '"');
        var img = insertImageFromDataUrl(row.getCell(0), item.img);
        logDebug('image-result', item.line + ' — inserted=' + (!!img));
        if (img) { img.setWidth(40); img.setHeight(40); }
      } catch (imgErr) {
        // don't let a broken/oversized image fail the whole slip, but log
        // it so a genuine embedding problem doesn't fail silently
        logDebug('insertImageFromDataUrl(' + item.line + ')', imgErr.message + '\n' + imgErr.stack);
      }
    } else {
      logDebug('image-skip', item.line + ' — no image data in payload for this item');
    }
  });
  itemsTable.removeRow(templateRowIndex + items.length);
}

function insertImageFromDataUrl(cell, dataUrl) {
  var match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, match[1], 'item.jpg');
  return cell.insertImage(0, blob);
}

function writeLinkToSheet(orderNumber, link) {
  var b = SpreadsheetApp.getActiveSpreadsheet();
  var s = b.getSheetByName('Orders');
  if (!s) return;
  var n = s.getLastRow();
  if (n <= 1) return;
  var v = s.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] == orderNumber) { s.getRange(i + 2, 9).setValue(link); return; }
  }
}

function writeLinkToFirestore(docId, link) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/orders/' + docId + '?updateMask.fieldPaths=driveLink';
  var res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: { driveLink: { stringValue: link } } }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    logDebug('writeLinkToFirestore(' + docId + ')', res.getResponseCode() + ': ' + res.getContentText());
  }
}
