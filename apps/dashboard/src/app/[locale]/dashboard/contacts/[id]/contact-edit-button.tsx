"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { ContactFormDialog, type EditableContact } from "@/components/contacts/contact-form-dialog";

export function ContactEditButton({ contact }: { contact: EditableContact }) {
  const t = useTranslations("contacts");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-accent text-foreground transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        {t("actions.edit")}
      </button>
      <ContactFormDialog open={open} editContact={contact} onClose={() => setOpen(false)} />
    </>
  );
}
