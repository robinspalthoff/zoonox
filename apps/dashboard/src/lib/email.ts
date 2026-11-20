import * as Brevo from "@getbrevo/brevo";

if (!process.env.BREVO_API_KEY) {
  console.warn("BREVO_API_KEY is not set — emails will not be sent.");
}
if (!process.env.PLATFORM_SENDER_EMAIL) {
  console.warn("PLATFORM_SENDER_EMAIL is not set — invoice emails will fail.");
}

const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY ?? ""
);

export { apiInstance as brevo };
export { Brevo };
