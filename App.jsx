import { useState, useEffect, useCallback } from "react";

// ── palette & tokens ──────────────────────────────────────────────
const C = {
  navy:    "#1B2B4B",
  cobalt:  "#2557D6",
  sky:     "#EEF3FC",
  slate:   "#64748B",
  border:  "#DDE3ED",
  white:   "#FFFFFF",
  success: "#16A34A",
  warning: "#D97706",
  danger:  "#DC2626",
  text:    "#111827",
};

const MCP_URL  = "https://gmailmcp.googleapis.com/mcp/v1";
const MODEL    = "claude-sonnet-4-6";

// ── Tracking helpers ──────────────────────────────────────────────
// Build a pixel tag and wrap links for a given campaign + contact
function buildTrackedBody(htmlBody, trackingUrl, campaignId, contactId, email) {
  if (!trackingUrl) return htmlBody;
  const enc = encodeURIComponent;
  // Wrap all href links
  let tracked = htmlBody.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url) =>
      `href="${trackingUrl}/track/click?cid=${enc(campaignId)}&uid=${enc(contactId)}&em=${enc(email)}&url=${enc(url)}"`
  );
  // Append pixel just before </body> or at end
  const pixel = `<img src="${trackingUrl}/track/open?cid=${enc(campaignId)}&uid=${enc(contactId)}&em=${enc(email)}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" alt="" />`;
  return tracked.includes("</body>")
    ? tracked.replace("</body>", pixel + "</body>")
    : tracked + pixel;
}

// Fetch live stats from tracking server for a campaign
async function fetchCampaignStats(trackingUrl, campaignId) {
  if (!trackingUrl) return null;
  try {
    const r = await fetch(`${trackingUrl}/stats/campaign/${encodeURIComponent(campaignId)}`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// Check if tracking server is reachable
async function pingTrackingServer(url) {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

// ── storage helpers ───────────────────────────────────────────────
async function storageGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
async function storageSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Gmail via Claude API ──────────────────────────────────────────
async function callClaude(systemPrompt, userContent, tools) {
  const body = {
    model: MODEL,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    mcp_servers: [{ type: "url", url: MCP_URL, name: "gmail" }],
  };
  if (tools) body.tools = tools;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendEmailViaGmail(to, subject, htmlBody) {
  const prompt = `You are an email sending assistant. Use Gmail MCP to send one email.
To: ${to}
Subject: ${subject}
Body (HTML): ${htmlBody}
Send it now and confirm.`;
  const data = await callClaude("Send emails via Gmail MCP.", prompt);
  const texts = data.content?.filter(b => b.type === "text").map(b => b.text).join(" ") || "";
  return { ok: !texts.toLowerCase().includes("error"), message: texts };
}

async function fetchGmailContacts() {
  const data = await callClaude(
    "Retrieve Gmail contacts or recent email addresses from the user's Gmail account. Return ONLY a JSON array of objects with fields: name, email. No markdown, no preamble.",
    "List up to 30 contacts from my Gmail recent senders and contacts. Return only JSON array."
  );
  const texts = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "[]";
  try {
    const clean = texts.replace(/```json|```/g, "").trim();
    const arr = JSON.parse(clean);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ── tiny UI primitives ────────────────────────────────────────────
function Btn({ children, onClick, variant = "primary", size = "md", disabled, style = {} }) {
  const base = {
    border: "none", borderRadius: 6, fontFamily: "Inter, sans-serif",
    fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1, transition: "background .15s",
    ...{ sm: { padding: "5px 12px", fontSize: 12 }, md: { padding: "9px 18px", fontSize: 14 }, lg: { padding: "12px 24px", fontSize: 15 } }[size],
  };
  const variants = {
    primary:   { background: C.cobalt, color: C.white },
    secondary: { background: C.sky, color: C.navy, border: `1px solid ${C.border}` },
    danger:    { background: C.danger, color: C.white },
    ghost:     { background: "transparent", color: C.slate },
  };
  return <button style={{ ...base, ...variants[variant], ...style }} onClick={!disabled ? onClick : undefined}>{children}</button>;
}

function Input({ label, value, onChange, type = "text", placeholder, style = {} }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 4 }}>{label}</label>}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 6,
          fontSize: 14, fontFamily: "Inter, sans-serif", color: C.text, outline: "none", boxSizing: "border-box", ...style }}
      />
    </div>
  );
}

function Badge({ label, color }) {
  const colors = {
    sent:    { bg: "#DCFCE7", text: "#166534" },
    draft:   { bg: "#FEF9C3", text: "#854D0E" },
    sending: { bg: "#DBEAFE", text: "#1E40AF" },
    failed:  { bg: "#FEE2E2", text: "#991B1B" },
  };
  const s = colors[color] || colors.draft;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: s.bg, color: s.text }}>{label}</span>;
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const bg = type === "success" ? C.success : type === "error" ? C.danger : C.cobalt;
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, background: bg, color: "#fff",
      padding: "12px 20px", borderRadius: 8, fontSize: 14, fontWeight: 500, zIndex: 9999,
      boxShadow: "0 4px 16px rgba(0,0,0,.2)", maxWidth: 340 }}>
      {msg}
    </div>
  );
}

function Modal({ title, children, onClose, width = 560 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.white, borderRadius: 10, width, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 8px 40px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: C.navy }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.slate }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", icon: "⚡", label: "Dashboard" },
  { id: "campaigns", icon: "📧", label: "Campaigns" },
  { id: "contacts",  icon: "👥", label: "Contacts" },
  { id: "lists",     icon: "📋", label: "Lists" },
  { id: "analytics", icon: "📊", label: "Analytics" },
];

function Sidebar({ active, setActive }) {
  return (
    <div style={{ width: 220, minHeight: "100vh", background: C.navy, display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.white, letterSpacing: "-0.5px" }}>📬 Craghan Contact</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,.45)", marginTop: 2 }}>Email Marketing</div>
      </div>
      <nav style={{ flex: 1, padding: "12px 10px" }}>
        {NAV.map(n => (
          <div key={n.id} onClick={() => setActive(n.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 7,
              cursor: "pointer", marginBottom: 2, fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 500,
              background: active === n.id ? "rgba(37,87,214,.55)" : "transparent",
              color: active === n.id ? C.white : "rgba(255,255,255,.6)",
              transition: "all .15s" }}>
            <span style={{ fontSize: 16 }}>{n.icon}</span>{n.label}
          </div>
        ))}
      </nav>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────
function Dashboard({ campaigns, contacts }) {
  const sent    = campaigns.filter(c => c.status === "sent");
  const totalSent = sent.reduce((a, c) => a + (c.recipients?.length || 0), 0);
  const opens   = sent.reduce((a, c) => a + (c.opens || 0), 0);
  const clicks  = sent.reduce((a, c) => a + (c.clicks || 0), 0);

  const stats = [
    { label: "Contacts",        value: contacts.length,  icon: "👥", color: C.cobalt },
    { label: "Campaigns Sent",  value: sent.length,      icon: "📤", color: C.success },
    { label: "Emails Delivered",value: totalSent,        icon: "✉️",  color: "#7C3AED" },
    { label: "Open Rate",       value: totalSent ? `${Math.round(opens/totalSent*100)}%` : "—", icon: "👁", color: C.warning },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: C.navy, marginBottom: 6 }}>Dashboard</h2>
      <p style={{ color: C.slate, marginBottom: 24, fontSize: 14 }}>Your email marketing at a glance.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.slate, fontWeight: 500, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
        <div style={{ fontWeight: 700, color: C.navy, marginBottom: 14, fontSize: 15 }}>Recent Campaigns</div>
        {campaigns.length === 0
          ? <p style={{ color: C.slate, fontSize: 14 }}>No campaigns yet. Create one to get started.</p>
          : campaigns.slice(-5).reverse().map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{c.subject}</div>
                <div style={{ fontSize: 12, color: C.slate }}>{c.listName} · {c.sentAt || "Draft"}</div>
              </div>
              <Badge label={c.status} color={c.status} />
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── PDF → email-embedded images ───────────────────────────────────
// Renders each PDF page to a canvas, returns array of base64 PNG data URLs
async function pdfToImages(file) {
  // Dynamically load PDF.js from CDN
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page   = await pdf.getPage(i);
    const scale  = 1.5; // 96dpi → 144dpi for crisp email rendering
    const vp     = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    images.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.88), width: vp.width, height: vp.height });
  }
  return images;
}

// Build email HTML from PDF page images + optional greeting + pixel
function buildPdfEmailHtml(pages, greeting, senderName) {
  const imgTags = pages.map(p =>
    `<img src="${p.dataUrl}" width="${Math.round(p.width / 1.5)}" style="display:block;max-width:100%;margin:0 auto;" alt="Campaign" />`
  ).join("\n");

  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff;">
  ${greeting ? `<div style="padding:20px 24px 8px;">${greeting}</div>` : ""}
  <div style="background:#f4f4f4;padding:8px 0;">
    ${imgTags}
  </div>
  ${senderName ? `<div style="padding:16px 24px;font-size:13px;color:#555;">Best regards,<br><strong>${senderName}</strong></div>` : ""}
</div>`;
}

// ── Campaign Builder ──────────────────────────────────────────────
function CampaignBuilder({ lists, onSend, onSave, onClose, existing, defaultTrackingUrl }) {
  const [subject,      setSubject]      = useState(existing?.subject || "");
  const [fromName,     setFromName]     = useState(existing?.fromName || "Drew Craghan");
  const [listId,       setListId]       = useState(existing?.listId || (lists[0]?.id || ""));
  const [trackingUrl,  setTrackingUrl]  = useState(existing?.trackingUrl || defaultTrackingUrl || "");
  const [sending,      setSending]      = useState(false);
  const [preview,      setPreview]      = useState(false);

  // mode: "html" | "pdf"
  const [mode,         setMode]         = useState(existing?.pdfPages ? "pdf" : "html");
  const [body,         setBody]         = useState(existing?.body || "<p>Hello {{name}},</p>\n<p>Your message here.</p>\n<p>Best,<br>Drew</p>");

  // PDF state
  const [pdfFile,      setPdfFile]      = useState(null);
  const [pdfPages,     setPdfPages]     = useState(existing?.pdfPages || []); // [{dataUrl,width,height}]
  const [pdfLoading,   setPdfLoading]   = useState(false);
  const [pdfGreeting,  setPdfGreeting]  = useState(existing?.pdfGreeting || "Hello {{name}},");

  const handlePdfDrop = async (file) => {
    if (!file || file.type !== "application/pdf") return;
    setPdfFile(file);
    setPdfLoading(true);
    try {
      const pages = await pdfToImages(file);
      setPdfPages(pages);
    } catch (e) {
      alert("Could not render PDF: " + e.message);
    }
    setPdfLoading(false);
  };

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (f) handlePdfDrop(f);
  };

  // Build final HTML for sending
  const getFinalBody = () => {
    if (mode === "pdf" && pdfPages.length > 0) {
      const greeting = pdfGreeting.replace(/{{name}}/g, "{{name}}"); // kept for per-contact replace
      return buildPdfEmailHtml(pdfPages, greeting, fromName);
    }
    return body;
  };

  const previewHtml = getFinalBody().replace(/{{name}}/g, "Jane Doe");

  return (
    <div>
      {/* Header fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input label="Subject Line" value={subject} onChange={setSubject} placeholder="Your compelling subject…" />
        <Input label="From Name" value={fromName} onChange={setFromName} />
      </div>

      {/* List selector */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Send to List</label>
        <select value={listId} onChange={e => setListId(e.target.value)}
          style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14, color: C.text }}>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.contacts?.length || 0} contacts)</option>)}
        </select>
      </div>

      {/* Tracking URL */}
      <div style={{ marginBottom: 14, padding: "12px 14px", background: trackingUrl ? "#EEF8F3" : C.sky, border: `1px solid ${trackingUrl ? "#A7D7C0" : C.border}`, borderRadius: 8 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 4 }}>
          🎯 Tracking Server URL <span style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <input value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)}
          placeholder="https://mailflow-tracking.up.railway.app"
          style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontFamily: "monospace", color: C.text, boxSizing: "border-box" }} />
        <div style={{ fontSize: 11, color: trackingUrl ? "#16A34A" : C.slate, marginTop: 5 }}>
          {trackingUrl ? "✓ Open pixel + click tracking will be injected into every email." : "Without a tracking URL, opens and clicks won't be measured."}
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 7, overflow: "hidden", width: "fit-content" }}>
        {[["html","✏️ Write HTML"],["pdf","📄 Import PDF"]].map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)}
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              background: mode === m ? C.cobalt : C.white, color: mode === m ? C.white : C.slate, fontFamily: "Inter, sans-serif" }}>
            {label}
          </button>
        ))}
      </div>

      {/* HTML mode */}
      {mode === "html" && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 4 }}>
            Email Body (HTML) — use {"{{name}}"} for first name
          </label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
            style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 6,
              fontSize: 13, fontFamily: "monospace", color: C.text, boxSizing: "border-box", resize: "vertical" }} />
        </div>
      )}

      {/* PDF mode */}
      {mode === "pdf" && (
        <div style={{ marginBottom: 14 }}>
          {/* Drop zone */}
          {pdfPages.length === 0 && (
            <label style={{ display: "block", border: `2px dashed ${C.border}`, borderRadius: 10, padding: "32px 20px",
              textAlign: "center", cursor: "pointer", background: C.sky, marginBottom: 12 }}>
              <input type="file" accept="application/pdf" onChange={handleFilePick} style={{ display: "none" }} />
              {pdfLoading
                ? <div style={{ color: C.cobalt, fontWeight: 600 }}>⏳ Rendering PDF pages…</div>
                : <>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                    <div style={{ fontWeight: 600, color: C.navy, fontSize: 15 }}>Drop a PDF or click to upload</div>
                    <div style={{ color: C.slate, fontSize: 12, marginTop: 4 }}>Each page will be embedded as an image in the email</div>
                  </>
              }
            </label>
          )}

          {/* PDF loaded */}
          {pdfPages.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>
                  ✅ {pdfPages.length} page{pdfPages.length > 1 ? "s" : ""} loaded
                  {pdfFile && <span style={{ color: C.slate, fontWeight: 400 }}> — {pdfFile.name}</span>}
                </div>
                <Btn variant="secondary" size="sm" onClick={() => { setPdfPages([]); setPdfFile(null); }}>
                  Remove PDF
                </Btn>
              </div>
              {/* Page thumbnails */}
              <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0 8px" }}>
                {pdfPages.map((p, i) => (
                  <div key={i} style={{ flexShrink: 0, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", width: 80 }}>
                    <img src={p.dataUrl} alt={`Page ${i+1}`} style={{ width: 80, display: "block" }} />
                    <div style={{ fontSize: 10, textAlign: "center", padding: "2px 0", color: C.slate }}>p.{i+1}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Greeting line above PDF */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 4 }}>
              Greeting (shown above PDF) — use {"{{name}}"} for first name
            </label>
            <input value={pdfGreeting} onChange={e => setPdfGreeting(e.target.value)}
              placeholder="Hello {{name}},"
              style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14, color: C.text, boxSizing: "border-box" }} />
          </div>

          {pdfPages.length === 0 && !pdfLoading && (
            <div style={{ fontSize: 12, color: C.slate, background: "#FFFBEB", border: `1px solid #FDE68A`, borderRadius: 6, padding: "8px 12px" }}>
              ⚠️ Upload a PDF above to use PDF mode. The pixel tracker will still be injected automatically.
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn variant="secondary" size="sm" onClick={() => setPreview(!preview)}>
          {preview ? "Hide Preview" : "Preview Email"}
        </Btn>
      </div>
      {preview && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, marginBottom: 16, background: "#FAFBFC", maxHeight: 420, overflow: "auto" }}>
          <div style={{ fontSize: 11, color: C.slate, marginBottom: 8 }}>PREVIEW — Subject: {subject}</div>
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="secondary" onClick={() => onSave({ subject, fromName, listId, body: getFinalBody(), pdfPages, pdfGreeting, trackingUrl, status: "draft" })}>
          Save Draft
        </Btn>
        <Btn variant="primary" disabled={sending || !subject || !listId || (mode === "pdf" && pdfPages.length === 0)}
          onClick={async () => {
            setSending(true);
            await onSend({ subject, fromName, listId, body: getFinalBody(), trackingUrl });
            setSending(false);
          }}>
          {sending ? "Sending…" : "Send Campaign"}
        </Btn>
      </div>
    </div>
  );
}

// ── Campaigns Tab ─────────────────────────────────────────────────
function CampaignsTab({ campaigns, setCampaigns, lists, toast }) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleSend = async (data) => {
    const list = lists.find(l => l.id === data.listId);
    if (!list || !list.contacts?.length) { toast("No contacts in that list.", "error"); return; }

    const id = editing?.id || Date.now().toString();
    const trackingUrl = data.trackingUrl?.trim().replace(/\/$/, "") || "";

    // Verify tracking server if URL provided
    if (trackingUrl) {
      toast("Checking tracking server…", "info");
      const alive = await pingTrackingServer(trackingUrl);
      if (!alive) {
        toast("⚠️ Tracking server unreachable — sending without tracking.", "error");
      } else {
        toast("Tracking server connected ✓", "success");
      }
    }

    const campaign = { ...data, id, status: "sending", listName: list.name, recipients: list.contacts, sentAt: new Date().toLocaleDateString(), trackingUrl };
    setCampaigns(prev => [...prev.filter(c => c.id !== id), campaign]);
    setShowBuilder(false);
    setEditing(null);
    toast(`Sending to ${list.contacts.length} contacts…`, "info");

    let delivered = 0, fails = 0;
    for (const contact of list.contacts) {
      const firstName = contact.name?.split(" ")[0] || "there";
      let personalizedBody = data.body.replace(/{{name}}/g, firstName);
      // Inject tracking pixel + wrap links if server is configured
      if (trackingUrl) {
        personalizedBody = buildTrackedBody(personalizedBody, trackingUrl, id, contact.id || contact.email, contact.email);
      }
      try {
        const r = await sendEmailViaGmail(contact.email, data.subject, personalizedBody);
        if (r.ok) delivered++;
        else fails++;
      } catch { fails++; }
    }

    setCampaigns(prev => prev.map(c => c.id === id
      ? { ...c, status: fails === list.contacts.length ? "failed" : "sent", delivered, opens: 0, clicks: 0 }
      : c
    ));
    toast(`Sent! ${delivered} delivered, ${fails} failed.`, delivered > 0 ? "success" : "error");
  };

  const handleSave = (data) => {
    const id = editing?.id || Date.now().toString();
    const list = lists.find(l => l.id === data.listId);
    setCampaigns(prev => {
      const without = prev.filter(c => c.id !== id);
      return [...without, { ...data, id, listName: list?.name || "—" }];
    });
    setShowBuilder(false);
    setEditing(null);
    toast("Draft saved.", "success");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: C.navy, marginBottom: 2 }}>Campaigns</h2>
          <p style={{ color: C.slate, fontSize: 14 }}>Create, manage, and send email campaigns.</p>
        </div>
        <Btn onClick={() => { setEditing(null); setShowBuilder(true); }}>+ New Campaign</Btn>
      </div>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10 }}>
        {campaigns.length === 0
          ? <div style={{ padding: 40, textAlign: "center", color: C.slate }}>No campaigns yet. Create your first one.</div>
          : campaigns.map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px", borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: C.text, fontSize: 15 }}>{c.subject}</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>List: {c.listName} · {c.sentAt || "Not sent"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {c.status === "sent" && <span style={{ fontSize: 12, color: C.slate }}>{c.recipients?.length || 0} sent · {c.opens || 0} opens</span>}
                <Badge label={c.status} color={c.status} />
                {(c.status === "draft" || !c.status) && (
                  <Btn variant="secondary" size="sm" onClick={() => { setEditing(c); setShowBuilder(true); }}>Edit</Btn>
                )}
                <Btn variant="ghost" size="sm" onClick={() => setCampaigns(prev => prev.filter(x => x.id !== c.id))}>✕</Btn>
              </div>
            </div>
          ))
        }
      </div>
      {showBuilder && (
        <Modal title={editing ? "Edit Campaign" : "New Campaign"} onClose={() => { setShowBuilder(false); setEditing(null); }} width={680}>
          <CampaignBuilder lists={lists} onSend={handleSend} onSave={handleSave}
            onClose={() => { setShowBuilder(false); setEditing(null); }} existing={editing}
            defaultTrackingUrl={campaigns.find(c => c.trackingUrl)?.trackingUrl || ""} />
        </Modal>
      )}
    </div>
  );
}

// ── Contacts Tab ──────────────────────────────────────────────────
function ContactsTab({ contacts, setContacts, lists, setLists, toast }) {
  const [showAdd, setShowAdd]       = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch]         = useState("");
  const [importing, setImporting]   = useState(false);
  const [newContact, setNewContact] = useState({ name: "", email: "", company: "", tags: "" });

  const filtered = contacts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase())
  );

  const addContact = () => {
    if (!newContact.email) return;
    const c = { ...newContact, id: Date.now().toString(), tags: newContact.tags.split(",").map(t => t.trim()).filter(Boolean) };
    setContacts(prev => [...prev, c]);
    setNewContact({ name: "", email: "", company: "", tags: "" });
    setShowAdd(false);
    toast("Contact added.", "success");
  };

  const importFromGmail = async () => {
    setImporting(true);
    toast("Connecting to Gmail…", "info");
    try {
      const gmailContacts = await fetchGmailContacts();
      const existing = new Set(contacts.map(c => c.email));
      const newOnes = gmailContacts.filter(c => c.email && !existing.has(c.email))
        .map(c => ({ ...c, id: Date.now().toString() + Math.random(), tags: ["gmail-import"] }));
      if (newOnes.length) {
        setContacts(prev => [...prev, ...newOnes]);
        toast(`Imported ${newOnes.length} contacts from Gmail.`, "success");
      } else {
        toast("No new contacts found in Gmail.", "info");
      }
    } catch { toast("Gmail import failed. Check your connection.", "error"); }
    setImporting(false);
    setShowImport(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: C.navy, marginBottom: 2 }}>Contacts</h2>
          <p style={{ color: C.slate, fontSize: 14 }}>{contacts.length} total contacts</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" onClick={() => setShowImport(true)}>⬇ Import from Gmail</Btn>
          <Btn onClick={() => setShowAdd(true)}>+ Add Contact</Btn>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Input value={search} onChange={setSearch} placeholder="Search contacts…" style={{ marginBottom: 0 }} />
      </div>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: C.sky }}>
              {["Name","Email","Company","Tags",""].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
                  color: C.slate, textTransform: "uppercase", letterSpacing: ".05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: C.slate }}>No contacts found.</td></tr>
              : filtered.map((c, i) => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.white : "#FAFBFD" }}>
                  <td style={{ padding: "10px 16px", fontWeight: 600, color: C.text }}>{c.name || "—"}</td>
                  <td style={{ padding: "10px 16px", color: C.slate }}>{c.email}</td>
                  <td style={{ padding: "10px 16px", color: C.slate }}>{c.company || "—"}</td>
                  <td style={{ padding: "10px 16px" }}>
                    {(c.tags || []).map(t => <span key={t} style={{ fontSize: 10, background: C.sky, color: C.cobalt, borderRadius: 99, padding: "2px 7px", marginRight: 4, fontWeight: 600 }}>{t}</span>)}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <Btn variant="ghost" size="sm" onClick={() => setContacts(prev => prev.filter(x => x.id !== c.id))}>✕</Btn>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add Contact" onClose={() => setShowAdd(false)}>
          <Input label="Name" value={newContact.name} onChange={v => setNewContact(p => ({ ...p, name: v }))} />
          <Input label="Email *" value={newContact.email} onChange={v => setNewContact(p => ({ ...p, email: v }))} type="email" />
          <Input label="Company" value={newContact.company} onChange={v => setNewContact(p => ({ ...p, company: v }))} />
          <Input label="Tags (comma-separated)" value={newContact.tags} onChange={v => setNewContact(p => ({ ...p, tags: v }))} placeholder="retailer, phoenix, high-point" />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn onClick={addContact} disabled={!newContact.email}>Add Contact</Btn>
          </div>
        </Modal>
      )}

      {showImport && (
        <Modal title="Import from Gmail" onClose={() => setShowImport(false)}>
          <p style={{ color: C.slate, fontSize: 14, marginBottom: 20 }}>
            This will pull recent senders and contacts from your connected Gmail account and add any new ones to your contact list.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setShowImport(false)}>Cancel</Btn>
            <Btn onClick={importFromGmail} disabled={importing}>{importing ? "Importing…" : "Import Contacts"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Lists Tab ─────────────────────────────────────────────────────
function ListsTab({ lists, setLists, contacts, toast }) {
  const [showCreate, setShowCreate] = useState(false);
  const [listName, setListName]     = useState("");
  const [selected, setSelected]     = useState(null);
  const [search, setSearch]         = useState("");
  const [addSearch, setAddSearch]   = useState("");

  const createList = () => {
    if (!listName.trim()) return;
    setLists(prev => [...prev, { id: Date.now().toString(), name: listName.trim(), contacts: [] }]);
    setListName("");
    setShowCreate(false);
    toast("List created.", "success");
  };

  const toggleContact = (listId, contact) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l;
      const has = l.contacts.some(c => c.email === contact.email);
      return { ...l, contacts: has ? l.contacts.filter(c => c.email !== contact.email) : [...l.contacts, contact] };
    }));
  };

  const selectedList = lists.find(l => l.id === selected);
  const filteredForAdd = contacts.filter(c =>
    (c.name?.toLowerCase().includes(addSearch.toLowerCase()) || c.email?.toLowerCase().includes(addSearch.toLowerCase()))
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontWeight: 700, color: C.navy, fontSize: 16, margin: 0 }}>Lists</h3>
          <Btn size="sm" onClick={() => setShowCreate(true)}>+ New</Btn>
        </div>
        {lists.map(l => (
          <div key={l.id} onClick={() => setSelected(l.id)}
            style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer", marginBottom: 4,
              background: selected === l.id ? C.sky : C.white, border: `1px solid ${selected === l.id ? C.cobalt : C.border}` }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: C.navy }}>{l.name}</div>
            <div style={{ fontSize: 12, color: C.slate }}>{l.contacts?.length || 0} contacts</div>
          </div>
        ))}
        {lists.length === 0 && <p style={{ fontSize: 13, color: C.slate }}>No lists yet.</p>}
      </div>

      <div>
        {selectedList ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: C.navy, margin: 0 }}>{selectedList.name}</h2>
                <p style={{ color: C.slate, fontSize: 13, margin: 0 }}>{selectedList.contacts.length} contacts in this list</p>
              </div>
              <Btn variant="danger" size="sm" onClick={() => { setLists(prev => prev.filter(l => l.id !== selected)); setSelected(null); }}>Delete List</Btn>
            </div>
            <Input value={addSearch} onChange={setAddSearch} placeholder="Search contacts to add/remove…" />
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, maxHeight: 420, overflow: "auto" }}>
              {filteredForAdd.map((c, i) => {
                const inList = selectedList.contacts.some(x => x.email === c.email);
                return (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 16px", borderBottom: i < filteredForAdd.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{c.name || c.email}</div>
                      <div style={{ fontSize: 12, color: C.slate }}>{c.email}</div>
                    </div>
                    <Btn size="sm" variant={inList ? "danger" : "secondary"} onClick={() => toggleContact(selected, c)}>
                      {inList ? "Remove" : "Add"}
                    </Btn>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: C.slate, fontSize: 14 }}>
            Select a list to manage its contacts.
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Create List" onClose={() => setShowCreate(false)}>
          <Input label="List Name" value={listName} onChange={setListName} placeholder="e.g. Arizona Retailers" />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Btn>
            <Btn onClick={createList} disabled={!listName.trim()}>Create List</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────
function AnalyticsTab({ campaigns, setCampaigns }) {
  const sent = campaigns.filter(c => c.status === "sent");
  const [liveStats, setLiveStats] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    const tracked = sent.filter(c => c.trackingUrl);
    const results = {};
    await Promise.all(
      tracked.map(async (c) => {
        const s = await fetchCampaignStats(c.trackingUrl, c.id);
        if (s) results[c.id] = s;
      })
    );
    setLiveStats(results);
    if (Object.keys(results).length > 0) {
      setCampaigns(prev => prev.map(c => {
        const s = results[c.id];
        if (!s) return c;
        return { ...c, opens: s.unique_opens, clicks: s.unique_clicks };
      }));
    }
    setLastRefresh(new Date());
    setRefreshing(false);
  }, [sent.length]);

  useEffect(() => { refreshStats(); }, []);

  const totalRecip  = sent.reduce((a, c) => a + (c.recipients?.length || 0), 0);
  const totalOpens  = sent.reduce((a, c) => a + (c.opens  || 0), 0);
  const totalClicks = sent.reduce((a, c) => a + (c.clicks || 0), 0);
  const openRate    = totalRecip ? ((totalOpens / totalRecip) * 100).toFixed(1) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: C.navy, marginBottom: 2 }}>Analytics</h2>
          <p style={{ color: C.slate, fontSize: 14 }}>
            {lastRefresh ? `Last refreshed ${lastRefresh.toLocaleTimeString()}` : "Performance across all campaigns."}
          </p>
        </div>
        <Btn variant="secondary" onClick={refreshStats} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28, marginTop: 20 }}>
        {[
          { label: "Total Sent",    value: totalRecip,   sub: `${sent.length} campaigns`, icon: "📤", color: C.cobalt  },
          { label: "Unique Opens",  value: totalOpens,   sub: "live from server",          icon: "👁",  color: C.success },
          { label: "Link Clicks",   value: totalClicks,  sub: "unique clicks",             icon: "🖱",  color: "#7C3AED" },
          { label: "Avg Open Rate", value: openRate+"%", sub: "industry avg ~21%",         icon: "📈", color: C.warning },
        ].map(s => (
          <div key={s.label} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, marginTop: 2 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, color: C.navy }}>Campaign Performance</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.sky }}>
              {["Campaign","List","Sent","Opens","Clicks","Open Rate","Tracking","Date"].map(h => (
                <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sent.length === 0
              ? <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: C.slate }}>No sent campaigns yet.</td></tr>
              : sent.map((c, i) => {
                const recip  = c.recipients?.length || 0;
                const opens  = c.opens  || 0;
                const clicks = c.clicks || 0;
                const or = recip ? (opens / recip * 100).toFixed(1) : 0;
                const live = liveStats[c.id];
                return (
                  <tr key={c.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.white : "#FAFBFD" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: C.text, maxWidth: 160 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject}</div>
                    </td>
                    <td style={{ padding: "10px 14px", color: C.slate }}>{c.listName}</td>
                    <td style={{ padding: "10px 14px" }}>{recip}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {opens}{live && <span style={{ fontSize: 10, color: C.success, marginLeft: 4 }}>●live</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>{clicks}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 48, height: 5, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(or, 100)}%`, height: "100%", background: C.cobalt, borderRadius: 3 }} />
                        </div>
                        <span>{or}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {c.trackingUrl
                        ? <span style={{ fontSize: 10, background: "#DCFCE7", color: "#166534", borderRadius: 99, padding: "2px 7px", fontWeight: 700 }}>Active</span>
                        : <span style={{ fontSize: 10, background: "#F3F4F6", color: C.slate,   borderRadius: 99, padding: "2px 7px" }}>None</span>}
                    </td>
                    <td style={{ padding: "10px 14px", color: C.slate }}>{c.sentAt}</td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>

      {Object.keys(liveStats).length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: C.navy, marginBottom: 12, fontSize: 15 }}>Recent Opens (Live)</div>
          {Object.entries(liveStats).map(([cid, stats]) => {
            const camp = campaigns.find(c => c.id === cid);
            if (!stats?.recent_opens?.length) return null;
            return (
              <div key={cid} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ padding: "10px 16px", background: C.sky, fontSize: 13, fontWeight: 600, color: C.navy, borderBottom: `1px solid ${C.border}` }}>
                  {camp?.subject || cid}
                </div>
                {stats.recent_opens.slice(0, 8).map((o, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px",
                    borderBottom: i < 7 ? `1px solid ${C.border}` : "none", fontSize: 13 }}>
                    <span style={{ color: C.text }}>{o.email || o.contact_id}</span>
                    <span style={{ color: C.slate }}>{new Date(o.opened_at + "Z").toLocaleString()}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState("dashboard");
  const [contacts, setContacts] = useState([]);
  const [lists, setLists]       = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);
  const [loaded, setLoaded]     = useState(false);

  // Load from storage
  useEffect(() => {
    (async () => {
      const [c, l, camp] = await Promise.all([
        storageGet("craghan-contact:contacts"),
        storageGet("craghan-contact:lists"),
        storageGet("craghan-contact:campaigns"),
      ]);
      if (c) setContacts(c);
      if (l) setLists(l);
      if (camp) setCampaigns(camp);
      setLoaded(true);
    })();
  }, []);

  // Persist on change
  useEffect(() => { if (loaded) storageSet("craghan-contact:contacts", contacts); }, [contacts, loaded]);
  useEffect(() => { if (loaded) storageSet("craghan-contact:lists", lists); }, [lists, loaded]);
  useEffect(() => { if (loaded) storageSet("craghan-contact:campaigns", campaigns); }, [campaigns, loaded]);

  const toast = useCallback((msg, type = "info") => setToastMsg({ msg, type }), []);

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "Inter, sans-serif", color: C.slate }}>Loading…</div>;

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", background: "#F4F6FA" }}>
      <Sidebar active={tab} setActive={setTab} />
      <main style={{ flex: 1, padding: "28px 32px", overflow: "auto", maxWidth: "calc(100vw - 220px)" }}>
        {tab === "dashboard"  && <Dashboard campaigns={campaigns} contacts={contacts} />}
        {tab === "campaigns"  && <CampaignsTab campaigns={campaigns} setCampaigns={setCampaigns} lists={lists} toast={toast} />}
        {tab === "contacts"   && <ContactsTab contacts={contacts} setContacts={setContacts} lists={lists} setLists={setLists} toast={toast} />}
        {tab === "lists"      && <ListsTab lists={lists} setLists={setLists} contacts={contacts} toast={toast} />}
        {tab === "analytics"  && <AnalyticsTab campaigns={campaigns} setCampaigns={setCampaigns} />}
      </main>
      {toastMsg && <Toast msg={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
    </div>
  );
}
