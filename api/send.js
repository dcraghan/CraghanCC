// api/send.js — Vercel serverless function
// Proxies email send requests to Resend, supporting HTML body + PDF attachments

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { apiKey, from, to, subject, html, attachments } = req.body;
  if (!apiKey || !to || !subject || !html) {
    return res.status(400).json({ error: "Missing required fields: apiKey, to, subject, html" });
  }

  try {
    const payload = { from, to: [to], subject, html };

    // Support PDF attachments: [{ filename: "name.pdf", content: "<base64>" }]
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map(a => ({
        filename: a.filename,
        content: a.content, // base64 string
      }));
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || data.name || "Resend error" });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
