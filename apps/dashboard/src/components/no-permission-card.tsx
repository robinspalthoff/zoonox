import { ShieldAlert } from "lucide-react";

/**
 * Generischer "Du hast keine Berechtigung"-Block für Seiten, die per
 * Direkt-URL erreichbar bleiben, aber für die aktuelle Rolle keinen
 * Use Case haben (z. B. Kontakte für Steuerberater). Bewusst sehr
 * leichtgewichtig — kein Action-Button, kein Fallback-Inhalt, weil das
 * je nach Aufrufer unterschiedlich aussieht.
 */
export function NoPermissionCard({
  title,
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {title && (
        <h1 className="text-2xl font-semibold text-foreground mb-4">{title}</h1>
      )}
      <div className="flex items-start gap-3 bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        <ShieldAlert className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />
        <p>{description}</p>
      </div>
    </div>
  );
}
