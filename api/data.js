// api/data.js — Vercel serverless function
// Proxies reads/writes to Supabase kv_store table.
// Env vars required (set in Vercel → Settings → Environment Variables):
//   SUPABASE_URL       = https://xxxxx.supabase.co
//   SUPABASE_ANON_KEY  = your anon/public key

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Supabase env vars not configured on server" });
  }

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    if (req.method === "GET") {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: "Missing key" });

      const url = `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`;
      const r = await fetch(url, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Supabase read error" });

      return res.status(200).json({ value: data[0]?.value ?? null });
    }

    if (req.method === "POST") {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: "Missing key" });

      // Upsert
      const url = `${SUPABASE_URL}/rest/v1/kv_store`;
      const r = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: data.message || "Supabase write error" });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
