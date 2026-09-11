// Shared parser for Granola's list_meetings MCP result. Extracted verbatim from
// granola-meetings (verified against a live Business-plan account) so the
// scheduled sync (granola-sync) parses meeting lists identically.

export interface GranolaMeeting {
  id: string;
  title: string;
  date: string | null;
  participants: string[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Best-effort ISO conversion for Granola's human dates ("Jun 9, 2026 6:08 PM EDT").
export function toIso(dateRaw: string | null): string | null {
  if (!dateRaw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) return dateRaw;
  let d = new Date(dateRaw);
  if (isNaN(d.getTime())) d = new Date(dateRaw.replace(/\s+[A-Z]{2,4}$/, ""));
  return isNaN(d.getTime()) ? dateRaw : d.toISOString();
}

// Granola's MCP returns list_meetings as XML-style text:
//   <meetings_data ...><meeting id="uuid" title="..." date="...">
//     <known_participants> Name <email>, Name2 from Org <email2> </known_participants>
//   </meeting>...
function parseXmlMeetings(text: string): GranolaMeeting[] {
  const out: GranolaMeeting[] = [];
  const meetingRe = /<meeting\s+([^>]*)>([\s\S]*?)<\/meeting>/g;
  let m: RegExpExecArray | null;
  while ((m = meetingRe.exec(text))) {
    const attrs = m[1];
    const body = m[2];
    const id = (attrs.match(/id="([^"]*)"/) || [])[1];
    if (!id) continue;
    const title = decodeEntities((attrs.match(/title="([^"]*)"/) || [])[1] || "Untitled meeting");
    const dateRaw = (attrs.match(/date="([^"]*)"/) || [])[1] || null;
    const partBlock = (body.match(/<known_participants>([\s\S]*?)<\/known_participants>/) || [])[1] || "";
    const participants: string[] = [];
    const pRe = /([^,<>\n]+?)(?:\s*\(note creator\))?\s*<[^<>@\s]+@[^<>\s]+>/g;
    let p: RegExpExecArray | null;
    while ((p = pRe.exec(partBlock))) {
      const name = p[1].trim().replace(/^,\s*/, "").trim();
      if (name) participants.push(name);
    }
    out.push({ id, title, date: toIso(dateRaw), participants });
  }
  return out;
}

// Normalizes whatever shape list_meetings returns into the contract. Granola
// currently speaks the XML-style text format; JSON paths are forward-compat.
// `mcpJson` / `mcpText` are passed in from granola-mcp.ts (mcpResultJson/Text).
export function normalizeMeetings(result: any, mcpJson: (r: any) => any, mcpText: (r: any) => string): GranolaMeeting[] {
  const j = mcpJson(result);
  let raw: any[] = [];
  if (Array.isArray(j)) raw = j;
  else if (Array.isArray(j?.meetings)) raw = j.meetings;
  else if (Array.isArray(j?.results)) raw = j.results;

  if (raw.length) {
    return raw
      .filter((m) => m && (m.id || m.meeting_id))
      .map((m) => ({
        id: String(m.id || m.meeting_id),
        title: String(m.title || m.name || "Untitled meeting"),
        date: toIso(m.date || m.start_time || m.created_at || null),
        participants: (Array.isArray(m.participants) ? m.participants : Array.isArray(m.attendees) ? m.attendees : [])
          .map((p: any) => (typeof p === "string" ? p : p?.name || p?.email || ""))
          .filter(Boolean),
      }));
  }

  const text = mcpText(result);
  if (text.includes("<meeting")) return parseXmlMeetings(text);
  return [];
}
