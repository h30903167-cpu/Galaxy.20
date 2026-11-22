const crypto = require("crypto");

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
}

function getSigningSecret(apiKey) {
  return process.env.OTP_SECRET || crypto.createHash("sha256").update(`galaxy-otp:${apiKey}`).digest("hex");
}

function verifySignedToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const phone = normalizePhone(body.phone);
    const otp = String(body.otp || "").replace(/\D/g, "");
    const token = body.token;

    if (phone.length !== 10 || otp.length !== 6 || !token) {
      return res.status(400).json({ ok: false, error: "Phone number and 6-digit OTP are required" });
    }

    const apiKey = (process.env.FAST2SMS_API_KEY || "").trim();
    if (!apiKey || apiKey === "MY_FAST2SMS_API_KEY") {
      return res.status(503).json({ ok: false, error: "SMS gateway key (FAST2SMS_API_KEY) not configured." });
    }

    const secret = getSigningSecret(apiKey);
    const decoded = verifySignedToken(token, secret);
    if (!decoded) {
      return res.status(400).json({ ok: false, error: "Invalid OTP session. Please request a new OTP." });
    }
    if (Date.now() > Number(decoded.exp || 0)) {
      return res.status(400).json({ ok: false, error: "OTP expired. Please resend OTP." });
    }
    if (decoded.phone !== phone) {
      return res.status(400).json({ ok: false, error: "Phone number does not match OTP request." });
    }

    const candidateHash = crypto.createHash("sha256").update(`${phone}:${otp}`).digest("hex");
    const a = Buffer.from(candidateHash);
    const b = Buffer.from(String(decoded.otpHash || ""));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ ok: false, error: "Incorrect OTP. Please check SMS and try again." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to verify OTP" });
  }
};
