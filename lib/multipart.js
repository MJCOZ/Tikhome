'use strict';
// محلل multipart/form-data بسيط بلا اعتماديات. يعيد { fields, files:[{name, filename, mime, data}] }
function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('boundary مفقود');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {};
  const files = [];
  let pos = buffer.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    const next = buffer.indexOf(boundary, start);
    if (next === -1) break;
    const part = buffer.slice(start + 2, next - 2); // نحذف CRLF قبل وبعد
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const name = /name="([^"]*)"/i.exec(headers);
      const filename = /filename="([^"]*)"/i.exec(headers);
      const mime = /content-type:\s*([^\r\n;]+)/i.exec(headers);
      if (filename && name) {
        files.push({ name: name[1], filename: filename[1], mime: mime ? mime[1].trim().toLowerCase() : '', data: body });
      } else if (name) {
        fields[name[1]] = body.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}
module.exports = { parseMultipart };
