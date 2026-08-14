# GAS integration

`writeDefectiveRow.gs` is the source for the new `writeDefectiveRow` action. The
production Apps Script is not stored in this repository, so deployment remains a
manual step.

In the existing authenticated `doPost(e)` action switch, add:

```javascript
if (payload.action === "writeDefectiveRow") {
  return jsonResponse_(handleWriteDefectiveRow_(payload));
}
```

Then copy `writeDefectiveRow.gs` into that Apps Script project and publish a new
web-app version. The handler creates only the `不良在庫` sheet, upserts by the
7-character `商品ID`, and never writes the four human-owned columns.
