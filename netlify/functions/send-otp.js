const vercelHandler = require("../../api/send-otp");

exports.handler = async function (event) {
  let statusCode = 200;
  let bodyOut = "";
  const headers = { "Content-Type": "application/json" };

  const req = {
    method: event.httpMethod,
    body: event.body || "{}"
  };
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(code) { statusCode = code; return this; },
    json(obj) { bodyOut = JSON.stringify(obj); return this; }
  };

  await vercelHandler(req, res);
  return { statusCode, headers, body: bodyOut };
};
