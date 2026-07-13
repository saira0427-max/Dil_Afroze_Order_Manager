/**
 * Dil Afroze Order Manager — Google Sheets sync webhook.
 * Deploy this as a Google Apps Script Web App bound to the Orders spreadsheet.
 * See ../README.md for full deployment steps.
 */

// Fill these in once you've created your Drive folder and packing-slip
// template Doc — see README.md "Automatic packing-slip PDFs" for how to
// build the template and get these two IDs from their Drive URLs.
var DRIVE_FOLDER_ID = 'PUT_YOUR_DRIVE_FOLDER_ID_HERE';
var TEMPLATE_DOC_ID = 'PUT_YOUR_TEMPLATE_DOC_ID_HERE';
var FIREBASE_PROJECT_ID = 'dil-afroze-orders';

function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  if (d.action == 'generateSlip') {
    generateSlip(d);
  } else {
    go(d);
  }
  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  if (e.parameter.payload) go(JSON.parse(e.parameter.payload));
  return ContentService.createTextOutput('ok');
}

function go(d) {
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
function generateSlip(d) {
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var copyFile = DriveApp.getFileById(TEMPLATE_DOC_ID).makeCopy('Packing Slip ' + d.orderNumber, folder);
  var doc = DocumentApp.openById(copyFile.getId());
  var body = doc.getBody();

  body.replaceText('{{ORDER_NUMBER}}', d.orderNumber || '');
  body.replaceText('{{DATE}}', d.date || '');
  body.replaceText('{{CUSTOMER_NAME}}', d.customerName || '');
  body.replaceText('{{CUSTOMER_ADDRESS}}', (d.customerAddress || '').replace(/\n/g, ', '));
  body.replaceText('{{CUSTOMER_PHONE}}', d.customerPhone || '');
  body.replaceText('{{CUSTOMER_EMAIL}}', d.customerEmail || '');
  body.replaceText('{{DISCOUNT_LINE}}', d.discountLine || '');
  body.replaceText('{{TOTAL}}', d.total || '');
  body.replaceText('{{NOTES}}', d.notes ? ('Notes: ' + d.notes) : '');

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

  var templateRow = itemsTable.getRow(templateRowIndex);
  items.forEach(function (item, idx) {
    var row = idx === 0 ? templateRow : itemsTable.insertTableRow(templateRowIndex + idx, templateRow.copy());
    row.getCell(0).replaceText('{{ITEM_LINE}}', item.line);
    row.getCell(1).replaceText('{{ITEM_AMOUNT}}', item.amount);
  });
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
  UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: { driveLink: { stringValue: link } } }),
    muteHttpExceptions: true
  });
}
