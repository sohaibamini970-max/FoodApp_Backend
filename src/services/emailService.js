const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendVerificationCode(toEmail, code, name = "there") {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;background:#0a0a0a;color:#fff;border-radius:16px">
      <div style="font-size:32px">🍔</div>
      <h1 style="margin:8px 0 4px;font-size:24px">Verify your FoodieHub account</h1>
      <p style="color:#bbb;margin:0 0 20px">Hi ${name}, use this code to finish signing up:</p>
      <div style="font-size:36px;font-weight:900;letter-spacing:8px;background:linear-gradient(90deg,#f97316,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;text-align:center;padding:20px 0">
        ${code}
      </div>
      <p style="color:#888;font-size:13px;margin-top:16px">
        This code expires in 10 minutes. If you didn't request this, ignore this email.
      </p>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "FoodieHub <onboarding@resend.dev>",
    to: toEmail,
    subject: `Your FoodieHub code: ${code}`,
    html,
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Send contact form notification to admin inbox
 */
async function sendContactNotification({ name, email, subject, message }) {
  const adminEmail = process.env.CONTACT_EMAIL || process.env.EMAIL_FROM;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:24px;background:#0a0a0a;color:#fff;border-radius:16px">
      <h2 style="margin:0 0 8px">📬 New contact message</h2>
      <p style="color:#999;margin:0 0 20px">You received a new message from your website.</p>

      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;color:#888;width:90px">Name:</td>
          <td style="padding:8px 0;color:#fff;font-weight:600">${escapeHtml(name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#888">Email:</td>
          <td style="padding:8px 0"><a href="mailto:${escapeHtml(email)}" style="color:#f97316">${escapeHtml(email)}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#888">Subject:</td>
          <td style="padding:8px 0;color:#fff">${escapeHtml(subject)}</td>
        </tr>
      </table>

      <div style="margin-top:16px;padding:16px;background:rgba(255,255,255,0.05);border-radius:12px;border-left:3px solid #f97316;color:#ddd;white-space:pre-wrap">${escapeHtml(message)}</div>

      <p style="margin-top:20px;font-size:12px;color:#666">
        Reply directly to this email or handle it from the admin dashboard.
      </p>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "FoodieHub <onboarding@resend.dev>",
    to: adminEmail,
    reply_to: email,          // replying goes straight to the customer
    subject: `[Contact] ${subject}`,
    html,
  });

  if (error) throw new Error(error.message);
  return data;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Add to exports:
module.exports = {
  sendVerificationCode,
  sendContactNotification,  // ← NEW
};
