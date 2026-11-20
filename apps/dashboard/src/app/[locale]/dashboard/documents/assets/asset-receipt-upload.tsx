"use client";

// Receipt-upload helper shared by the asset form (new) and the detail page.
//
// Two modes:
//   - `mode="deferred"` (used in the new-asset form): the user picks a file,
//     we just hold onto it. The parent reads it via the `onChange` callback
//     and uploads it on form submit, *before* creating the asset (so the
//     resulting documentId can be passed to createAssetAction).
//
//   - `mode="instant"` (used in the detail page): the user picks a file and
//     we immediately upload it to /api/documents/upload AND call
//     attachDocumentToAssetAction. The component reports success via
//     `onAttached`.
//
// Why two modes:
//   - On create we don't have an assetId yet, so we cannot link in advance.
//     Uploading the file before asset creation also means: if asset creation
//     fails (validation, etc.) we'd leave an orphan Document. Deferring the
//     actual fetch() to the parent keeps that flow atomic from the user's POV
//     (the parent uploads + creates in a single submit handler and handles
//     rollback if needed).

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, X, Loader2, FileText } from "lucide-react";
import { attachDocumentToAssetAction, detachDocumentFromAssetAction } from "./actions";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const ACCEPTED_INPUT = "application/pdf,image/png,image/jpeg";

export interface UploadedDocument {
  id: string;
  fileName: string;
}

interface BaseProps {
  /** Currently linked / chosen file (display only). */
  current?: { fileName: string; id?: string } | null;
  className?: string;
}

interface DeferredProps extends BaseProps {
  mode: "deferred";
  /** Receives the picked file (or null when cleared). Parent uploads on submit. */
  onChange: (file: File | null) => void;
}

interface InstantProps extends BaseProps {
  mode: "instant";
  assetId: string;
  /** Called after a successful upload + attach. */
  onAttached: (doc: UploadedDocument) => void;
  /** Called when the linked document was detached. */
  onDetached?: () => void;
}

export type AssetReceiptUploadProps = DeferredProps | InstantProps;

export function AssetReceiptUpload(props: AssetReceiptUploadProps) {
  const t = useTranslations("assets.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);

  const linked = props.current?.fileName ?? picked?.name ?? null;

  function validate(file: File): string | null {
    if (!ACCEPTED_MIME.includes(file.type)) return t("errors.type");
    if (file.size > MAX_FILE_SIZE) return t("errors.size");
    return null;
  }

  async function handleFile(file: File | null) {
    setError(null);
    if (!file) {
      setPicked(null);
      if (props.mode === "deferred") props.onChange(null);
      return;
    }
    const err = validate(file);
    if (err) {
      setError(err);
      return;
    }

    if (props.mode === "deferred") {
      setPicked(file);
      props.onChange(file);
      return;
    }

    // instant mode — upload + attach
    setPending(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("errors.uploadFailed"));
      }
      const doc = (await res.json()) as { id: string; fileName: string };

      const attach = await attachDocumentToAssetAction(props.assetId, doc.id);
      if (!attach.success) throw new Error(attach.error);

      props.onAttached(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.uploadFailed"));
    } finally {
      setPending(false);
    }
  }

  function handleDetach() {
    if (props.mode !== "instant") return;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const r = await detachDocumentFromAssetAction(props.assetId);
        if (!r.success) throw new Error(r.error);
        props.onDetached?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Detach failed.");
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <div className={props.className ?? ""}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_INPUT}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {linked ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 border border-border rounded-lg">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-foreground flex-1 truncate" title={linked}>
            {linked}
          </span>
          <button
            type="button"
            onClick={() => {
              if (props.mode === "instant" && props.current?.id) {
                handleDetach();
              } else {
                handleFile(null);
                if (inputRef.current) inputRef.current.value = "";
              }
            }}
            disabled={pending}
            className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded disabled:opacity-60"
            title={t("remove")}
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted border border-dashed border-border rounded-lg transition-colors disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Paperclip className="w-3.5 h-3.5" />
          )}
          {pending ? t("uploading") : t("pickFile")}
        </button>
      )}

      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
      {!error && !linked && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("hint")}</p>
      )}
    </div>
  );
}
