package com.example.data

import com.example.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

data class OtpDispatchResult(
    val phone: String,
    val otpCode: String,
    val expiresAtMillis: Long
)

object SmsOtpService {
    private val secureRandom = SecureRandom()

    fun generateSixDigitOtp(): String {
        val num = 100000 + secureRandom.nextInt(900000)
        return num.toString()
    }

    fun isConfigured(): Boolean {
        val key = BuildConfig.FAST2SMS_API_KEY.trim()
        return key.isNotEmpty() && key != "MY_FAST2SMS_API_KEY"
    }

    suspend fun sendSmsOtp(phone10: String): Result<OtpDispatchResult> = withContext(Dispatchers.IO) {
        val apiKey = BuildConfig.FAST2SMS_API_KEY.trim()
        if (apiKey.isEmpty() || apiKey == "MY_FAST2SMS_API_KEY") {
            return@withContext Result.failure(
                IllegalStateException(
                    "SMS gateway key (FAST2SMS_API_KEY) not configured. Add FAST2SMS_API_KEY in AI Studio Secrets for real SMS OTP."
                )
            )
        }

        val cleanPhone = phone10.filter { it.isDigit() }.let {
            if (it.length > 10 && it.startsWith("91")) it.takeLast(10) else it
        }
        if (cleanPhone.length != 10) {
            return@withContext Result.failure(IllegalArgumentException("Enter valid 10-digit Indian phone number"))
        }

        val otpCode = generateSixDigitOtp()
        var conn: HttpURLConnection? = null
        try {
            val url = URL("https://www.fast2sms.com/dev/bulkV2")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 12000
                readTimeout = 12000
                doOutput = true
                setRequestProperty("authorization", apiKey)
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
            }

            val payload = JSONObject().apply {
                put("route", "q")
                put("message", "Your Galaxy Manual Seeder verification OTP is $otpCode. Valid for 5 minutes.")
                put("language", "english")
                put("flash", 0)
                put("numbers", cleanPhone)
            }

            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val bodyText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val json = JSONObject(bodyText)

            if (code in 200..299 && json.optBoolean("return", false)) {
                Result.success(
                    OtpDispatchResult(
                        phone = cleanPhone,
                        otpCode = otpCode,
                        expiresAtMillis = System.currentTimeMillis() + 5 * 60 * 1000L
                    )
                )
            } else {
                val msg = json.opt("message")?.toString() ?: "SMS gateway rejected OTP request ($code)"
                Result.failure(IllegalStateException(msg))
            }
        } catch (e: Exception) {
            Result.failure(IllegalStateException(e.message ?: "Failed to connect to SMS gateway"))
        } finally {
            conn?.disconnect()
        }
    }
}
