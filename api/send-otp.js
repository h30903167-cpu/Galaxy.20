const crypto = require("crypto");

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
}

function getSigningSecret(apiKey) {
  return process.env.OTP_SECRET || crypto.createHash("sha256").update(`galaxy-otp:${apiKey}`).digest("hex");
}

function signToken(payloadObj, secret) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const phone = normalizePhone(body.phone);
    if (!/^[6-9]\d{9}$/.test(phone) && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: "Enter valid 10-digit Indian phone number" });
    }

    const apiKey = (process.env.FAST2SMS_API_KEY || "").trim();
    if (!apiKey || apiKey === "MY_FAST2SMS_API_KEY") {
      return res.status(503).json({
        ok: false,
        error: "SMS gateway key (FAST2SMS_API_KEY) not configured in Vercel/Netlify Environment Variables."
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const route = (process.env.FAST2SMS_ROUTE || "q").trim();

    const smsPayload = route === "otp"
      ? {
          route: "otp",
          variables_values: otp,
          numbers: phone
        }
      : {
          route: "q",
          message: `Your Galaxy Manual Seeder verification OTP is ${otp}. Valid for 5 minutes.`,
          language: "english",
          flash: 0,
          numbers: phone
        };

    const smsRes = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        "authorization": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(smsPayload)
    });

    const smsJson = await smsRes.json().catch(() => ({}));
    if (!smsRes.ok || smsJson.return !== true) {
      const msg = Array.isArray(smsJson.message) ? smsJson.message.join(", ") : (smsJson.message || "SMS gateway rejected OTP request");
      return res.status(502).json({ ok: false, error: msg });
    }

    const secret = getSigningSecret(apiKey);
    const otpHash = crypto.createHash("sha256").update(`${phone}:${otp}`).digest("hex");
    const token = signToken({
      phone,
      otpHash,
      exp: Date.now() + 5 * 60 * 1000
    }, secret);

    return res.status(200).json({
      ok: true,
      token,
      expiresIn: 300
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to send OTP" });
  }
};
