/**
 * BankLayout
 * ──────────
 * Thin padding wrapper for everything under /dashboard/bank. The
 * previous page-level <h1>Bank</h1> + subtitle + tab nav were removed
 * intentionally: the sidebar already names the section ("Bank") and
 * surfaces the sub-pages (Konten, Kassenbuch) as nested entries. A
 * second header on every page was pure chrome.
 *
 * Contextual H1s — like the account name on /dashboard/bank/<id> —
 * stay where they live. They actually tell the user something the
 * sidebar can't.
 */
export default function BankLayout({ children }: { children: React.ReactNode }) {
  return <div className="p-6">{children}</div>;
}
