const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Small self-contained page used for auth messages (no external assets). */
export function simplePage(title: string, message: string, link: { href: string; label: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - OneJarc</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1720;color:#e6edf3}
  main{max-width:28rem;padding:2rem;text-align:center}
  h1{font-size:1.4rem;margin:0 0 .75rem}
  p{color:#9fb0c0;line-height:1.5}
  a{display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;border-radius:.5rem;background:#29b7aa;color:#04201d;text-decoration:none;font-weight:600}
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></main></body>
</html>`;
}
