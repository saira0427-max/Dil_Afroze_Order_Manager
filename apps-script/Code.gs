/**
 * Dil Afroze Order Manager — Google Sheets sync webhook.
 * Deploy this as a Google Apps Script Web App bound to the Orders spreadsheet.
 * See ../README.md for full deployment steps.
 */

function doPost(e) {
  go(JSON.parse(e.postData.contents));
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
