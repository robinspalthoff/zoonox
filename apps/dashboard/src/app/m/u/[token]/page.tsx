import { resolveActiveMobileSession } from "@/lib/documents/mobile-upload-session";
import { MobileUploadView } from "./mobile-upload-view";

type PageProps = { params: Promise<{ token: string }> };

export default async function MobileUploadPage({ params }: PageProps) {
  const { token } = await params;
  const session = await resolveActiveMobileSession(token);

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-xl font-semibold">Link abgelaufen</h1>
          <p className="text-sm text-muted-foreground">
            Dieser Upload-Link ist nicht mehr gültig. Bitte erzeuge am Desktop einen
            neuen QR-Code und scanne ihn erneut.
          </p>
        </div>
      </main>
    );
  }

  return <MobileUploadView token={token} expiresAt={session.expiresAt.toISOString()} />;
}
