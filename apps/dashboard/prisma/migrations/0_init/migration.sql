-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'PASSWORD_CHANGED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'SETTINGS_CHANGED', 'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_DELETED', 'CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_DELETED', 'INVOICE_CREATED', 'INVOICE_UPDATED', 'INVOICE_SENT', 'INVOICE_PAID', 'INVOICE_PAYMENT_REVERTED', 'INVOICE_CANCELLED', 'INVOICE_FINALIZED', 'INVOICE_CREDIT_NOTE_CREATED', 'INVOICE_EINVOICE_GENERATED', 'DOCUMENT_PAID', 'DOCUMENT_REOPENED', 'BANK_ACCOUNT_CREATED', 'BANK_ACCOUNT_UPDATED', 'BANK_ACCOUNT_DELETED', 'BANK_TRANSACTION_CREATED', 'BANK_TRANSACTION_IMPORTED', 'BANK_TRANSACTION_MATCHED', 'BANK_TRANSACTION_AUTO_MATCHED', 'BANK_CONNECTION_AUTHORIZED', 'BANK_CONNECTION_SYNCED', 'BANK_CONNECTION_EXPIRED', 'BANK_CONNECTION_REVOKED', 'CASHBOOK_ENTRY_CREATED', 'CASHBOOK_ENTRY_UPDATED', 'CASHBOOK_ENTRY_DELETED', 'FIXED_ASSET_CREATED', 'FIXED_ASSET_UPDATED', 'FIXED_ASSET_DISPOSED', 'FIXED_ASSET_DELETED', 'FIXED_ASSET_DEPRECIATION_POSTED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_DELETED', 'QUOTE_CREATED', 'QUOTE_UPDATED', 'QUOTE_SENT', 'QUOTE_ACCEPTED', 'QUOTE_REJECTED', 'QUOTE_EXPIRED', 'QUOTE_CONVERTED', 'QUOTE_DELETED', 'ORDER_CONFIRMATION_CREATED', 'ORDER_CONFIRMATION_UPDATED', 'ORDER_CONFIRMATION_SENT', 'ORDER_CONFIRMATION_INVOICED', 'ORDER_CONFIRMATION_CANCELLED', 'ORDER_CONFIRMATION_DELETED', 'COMMENT_CREATED', 'COMMENT_RESOLVED', 'COMMENT_REOPENED', 'COMMENT_DELETED', 'MONTH_CLOSE_SUBMITTED', 'MONTH_CLOSE_REOPENED', 'MONTH_CLOSE_FINALIZED');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('STANDARD', 'SMALL_BUSINESS');

-- CreateEnum
CREATE TYPE "SkrType" AS ENUM ('SKR03', 'SKR04');

-- CreateEnum
CREATE TYPE "AccountingMode" AS ENUM ('SINGLE_ENTRY', 'DOUBLE_ENTRY');

-- CreateEnum
CREATE TYPE "ProfitLossMethod" AS ENUM ('EUR', 'GUV');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('CUSTOMER', 'SUPPLIER', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "VatRegulation" AS ENUM ('STANDARD', 'SMALL_BUSINESS_19', 'TAX_EXEMPT_4', 'REVERSE_CHARGE_13B', 'REVERSE_CHARGE_18B', 'INTRA_COMMUNITY_DELIVERY', 'OSS', 'EXPORT', 'NON_DOMESTIC_SERVICE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderConfirmationStatus" AS ENUM ('DRAFT', 'SENT', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringInterval" AS ENUM ('DAYS_7', 'DAYS_14', 'MONTHLY', 'MONTHS_2', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'YEARS_2', 'YEARS_3', 'YEARS_4', 'YEARS_5');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DRAFT', 'FAILED', 'PAID');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('INVOICE_INCOMING', 'RECEIPT', 'CONTRACT', 'CREDIT_NOTE', 'DELIVERY_NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('MANUAL', 'MOBILE', 'EMAIL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'PAYPAL');

-- CreateEnum
CREATE TYPE "PaymentDifferenceReason" AS ENUM ('ROUNDING', 'SKONTO', 'FX', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('BANK', 'CLEARING');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('MANUAL', 'CSV', 'MT940', 'CAMT053', 'ENABLE_BANKING');

-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "CashbookEntryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalSourceType" AS ENUM ('INVOICE', 'INVOICE_PAYMENT', 'DOCUMENT', 'DOCUMENT_PAYMENT', 'BANK_TRANSACTION', 'MANUAL', 'FIXED_ASSET_ACQUISITION', 'FIXED_ASSET_DEPRECIATION', 'FIXED_ASSET_DISPOSAL');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FixedAssetMethod" AS ENUM ('LINEAR', 'IMMEDIATE', 'POOL', 'DEGRESSIVE');

-- CreateEnum
CREATE TYPE "FixedAssetCategory" AS ENUM ('TANGIBLE', 'IT_HARDWARE', 'IT_SOFTWARE', 'VEHICLE', 'MACHINERY', 'BUILDING', 'INTANGIBLE', 'OTHER');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('PLANNED', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "NumberRangeType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'QUOTE', 'ORDER_CONFIRMATION', 'DELIVERY_NOTE', 'CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "CommentEntityType" AS ENUM ('DOCUMENT', 'INVOICE', 'JOURNAL_ENTRY', 'BANK_TRANSACTION');

-- CreateEnum
CREATE TYPE "MonthCloseStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLOSED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "firstName" TEXT,
    "lastName" TEXT,
    "image" TEXT,
    "password" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "onboardingState" JSONB,
    "notificationsSeenAt" TIMESTAMP(3),
    "dismissedNotifications" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "nameSuffix" TEXT,
    "ownerName" TEXT,
    "legalForm" TEXT,
    "address" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "country" TEXT NOT NULL DEFAULT 'DE',
    "email" TEXT,
    "senderEmail" TEXT,
    "senderName" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "taxId" TEXT,
    "vatId" TEXT,
    "registerCourt" TEXT,
    "registerNumber" TEXT,
    "managingDirector" TEXT,
    "taxMode" "TaxMode" NOT NULL DEFAULT 'STANDARD',
    "bankName" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "logoBase64" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'RE',
    "defaultNotes" TEXT,
    "defaultIntroText" TEXT,
    "skrType" "SkrType" NOT NULL DEFAULT 'SKR03',
    "accountingMode" "AccountingMode" NOT NULL DEFAULT 'DOUBLE_ENTRY',
    "profitLossMethod" "ProfitLossMethod" NOT NULL DEFAULT 'EUR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerNumber" TEXT,
    "supplierNumber" TEXT,
    "roles" "ContactRole"[],
    "contactSalutation" TEXT,
    "contactTitle" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "contactPosition" TEXT,
    "address" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "country" TEXT NOT NULL DEFAULT 'DE',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "vatId" TEXT,
    "taxId" TEXT,
    "notes" TEXT,
    "paymentTermDays" INTEGER,
    "discountDays" INTEGER,
    "discountPercent" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'INVOICE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "serviceDate" TIMESTAMP(3),
    "serviceDateEnd" TIMESTAMP(3),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "globalDiscountType" TEXT,
    "globalDiscountValue" DECIMAL(10,2),
    "notes" TEXT,
    "introText" TEXT,
    "vatRegulation" "VatRegulation" NOT NULL DEFAULT 'STANDARD',
    "paymentQrEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leitwegId" TEXT,
    "buyerReference" TEXT,
    "eInvoiceXml" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "pdfHash" TEXT,
    "pdfStoragePath" TEXT,
    "creditNoteForId" TEXT,
    "recurringInvoiceId" TEXT,
    "quoteId" TEXT,
    "orderConfirmationId" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "serviceDate" TIMESTAMP(3),
    "serviceDateEnd" TIMESTAMP(3),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "globalDiscountType" TEXT,
    "globalDiscountValue" DECIMAL(10,2),
    "notes" TEXT,
    "introText" TEXT,
    "vatRegulation" "VatRegulation" NOT NULL DEFAULT 'STANDARD',
    "convertedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "discountType" TEXT,
    "discountValue" DECIMAL(10,2),
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_confirmations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "OrderConfirmationStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "serviceDate" TIMESTAMP(3),
    "serviceDateEnd" TIMESTAMP(3),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "globalDiscountType" TEXT,
    "globalDiscountValue" DECIMAL(10,2),
    "notes" TEXT,
    "introText" TEXT,
    "vatRegulation" "VatRegulation" NOT NULL DEFAULT 'STANDARD',
    "quoteId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_confirmation_line_items" (
    "id" TEXT NOT NULL,
    "orderConfirmationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "discountType" TEXT,
    "discountValue" DECIMAL(10,2),
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "order_confirmation_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_audit_hashes" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'sha256',
    "pdfSizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "invoice_audit_hashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "discountType" TEXT,
    "discountValue" DECIMAL(10,2),
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "firstIssueDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "interval" "RecurringInterval" NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "processingStartedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "notes" TEXT,
    "introText" TEXT,
    "vatRegulation" "VatRegulation" NOT NULL DEFAULT 'STANDARD',
    "paymentTermDays" INTEGER,
    "leitwegId" TEXT,
    "buyerReference" TEXT,
    "title" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_line_items" (
    "id" TEXT NOT NULL,
    "recurringInvoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatRate" INTEGER NOT NULL,

    CONSTRAINT "recurring_invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileHash" TEXT,
    "fingerprint" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "source" "DocumentSource" NOT NULL DEFAULT 'MANUAL',
    "deletedAt" TIMESTAMP(3),
    "ocrText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "recognizedAmount" DECIMAL(10,2),
    "recognizedDate" TIMESTAMP(3),
    "recognizedSupplier" TEXT,
    "recognizedDocNumber" TEXT,
    "recognizedDueDate" TIMESTAMP(3),
    "recognizedDescription" TEXT,
    "suggestedCategory" "DocumentCategory",
    "recognizedVatRate" DECIMAL(5,2),
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "bookingAccount" TEXT,
    "vatRate" DECIMAL(5,2),
    "deliveryDate" TIMESTAMP(3),
    "deliveryDateEnd" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "documentType" "DocumentType",
    "documentNumber" TEXT,
    "tags" TEXT[],
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "exchangeRate" DECIMAL(14,6),
    "notes" TEXT,
    "invoiceId" TEXT,
    "contactId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_line_items" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "skrAccount" TEXT,
    "depreciation" TEXT,
    "amount" DECIMAL(10,2),
    "vatRule" TEXT,
    "vatRate" DECIMAL(5,2),
    "total" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_payments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2),
    "reference" TEXT,
    "notes" TEXT,
    "bankAccountId" TEXT,
    "differenceReason" "PaymentDifferenceReason",
    "differenceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BankAccountType" NOT NULL DEFAULT 'BANK',
    "bankName" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "openingBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "bookingAccount" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "csvMapping" JSONB,
    "externalAccountId" TEXT,
    "bankConnectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aspspName" TEXT NOT NULL,
    "aspspCountry" TEXT NOT NULL,
    "psuType" TEXT NOT NULL DEFAULT 'business',
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "authState" TEXT NOT NULL,
    "sessionId" TEXT,
    "validUntil" TIMESTAMP(3),
    "authorizedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "counterpartName" TEXT,
    "counterpartIban" TEXT,
    "purpose" TEXT,
    "category" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "importSource" "ImportSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "documentId" TEXT,
    "invoiceId" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "autoMatched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashbook_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "entryType" "CashbookEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashbook_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_sequence" (
    "tenantId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_sequence_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" "JournalSourceType" NOT NULL,
    "sourceId" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "accountCode" TEXT NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatCode" TEXT,
    "vatAmount" DECIMAL(12,2),
    "description" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_sequence" (
    "tenantId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_sequence_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "FixedAssetCategory" NOT NULL DEFAULT 'TANGIBLE',
    "method" "FixedAssetMethod" NOT NULL DEFAULT 'LINEAR',
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'PLANNED',
    "documentId" TEXT,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2),
    "usefulLifeMonths" INTEGER NOT NULL,
    "depreciationStart" TIMESTAMP(3) NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "scrapValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bookValue" DECIMAL(12,2) NOT NULL,
    "totalDepreciated" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lastPostedYear" INTEGER,
    "lastPostedMonth" INTEGER,
    "skrAssetAccount" TEXT NOT NULL,
    "skrDepreciationAccount" TEXT NOT NULL,
    "disposalDate" TIMESTAMP(3),
    "disposalProceeds" DECIMAL(12,2),
    "disposalReason" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "bookValueBefore" DECIMAL(12,2) NOT NULL,
    "bookValueAfter" DECIMAL(12,2) NOT NULL,
    "journalEntryId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_ranges" (
    "tenantId" TEXT NOT NULL,
    "type" "NumberRangeType" NOT NULL,
    "format" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "minDigits" INTEGER NOT NULL DEFAULT 3,
    "yearlyReset" BOOLEAN NOT NULL DEFAULT true,
    "lastYear" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_ranges_pkey" PRIMARY KEY ("tenantId","type")
);

-- CreateTable
CREATE TABLE "mobile_upload_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_mailboxes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowedSenders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_mail_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT,
    "messageId" TEXT,
    "status" TEXT NOT NULL,
    "rejectReason" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_mail_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "CommentEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "month_closes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "MonthCloseStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "month_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenant_users_userId_idx" ON "tenant_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenantId_userId_key" ON "tenant_users"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_tenantId_key" ON "company_settings"("tenantId");

-- CreateIndex
CREATE INDEX "contacts_tenantId_idx" ON "contacts"("tenantId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");

-- CreateIndex
CREATE INDEX "invoices_contactId_idx" ON "invoices"("contactId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_issueDate_idx" ON "invoices"("issueDate");

-- CreateIndex
CREATE INDEX "invoices_creditNoteForId_idx" ON "invoices"("creditNoteForId");

-- CreateIndex
CREATE INDEX "invoices_recurringInvoiceId_idx" ON "invoices"("recurringInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_quoteId_idx" ON "invoices"("quoteId");

-- CreateIndex
CREATE INDEX "invoices_orderConfirmationId_idx" ON "invoices"("orderConfirmationId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

-- CreateIndex
CREATE INDEX "quotes_tenantId_idx" ON "quotes"("tenantId");

-- CreateIndex
CREATE INDEX "quotes_contactId_idx" ON "quotes"("contactId");

-- CreateIndex
CREATE INDEX "quotes_status_idx" ON "quotes"("status");

-- CreateIndex
CREATE INDEX "quotes_issueDate_idx" ON "quotes"("issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenantId_number_key" ON "quotes"("tenantId", "number");

-- CreateIndex
CREATE INDEX "quote_line_items_quoteId_idx" ON "quote_line_items"("quoteId");

-- CreateIndex
CREATE INDEX "order_confirmations_tenantId_idx" ON "order_confirmations"("tenantId");

-- CreateIndex
CREATE INDEX "order_confirmations_contactId_idx" ON "order_confirmations"("contactId");

-- CreateIndex
CREATE INDEX "order_confirmations_status_idx" ON "order_confirmations"("status");

-- CreateIndex
CREATE INDEX "order_confirmations_issueDate_idx" ON "order_confirmations"("issueDate");

-- CreateIndex
CREATE INDEX "order_confirmations_quoteId_idx" ON "order_confirmations"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "order_confirmations_tenantId_number_key" ON "order_confirmations"("tenantId", "number");

-- CreateIndex
CREATE INDEX "order_confirmation_line_items_orderConfirmationId_idx" ON "order_confirmation_line_items"("orderConfirmationId");

-- CreateIndex
CREATE INDEX "invoice_audit_hashes_invoiceId_idx" ON "invoice_audit_hashes"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

-- CreateIndex
CREATE INDEX "recurring_invoices_tenantId_idx" ON "recurring_invoices"("tenantId");

-- CreateIndex
CREATE INDEX "recurring_invoices_contactId_idx" ON "recurring_invoices"("contactId");

-- CreateIndex
CREATE INDEX "recurring_invoices_status_nextRunAt_idx" ON "recurring_invoices"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "recurring_invoice_line_items_recurringInvoiceId_idx" ON "recurring_invoice_line_items"("recurringInvoiceId");

-- CreateIndex
CREATE INDEX "documents_tenantId_idx" ON "documents"("tenantId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_uploadedById_idx" ON "documents"("uploadedById");

-- CreateIndex
CREATE INDEX "documents_invoiceId_idx" ON "documents"("invoiceId");

-- CreateIndex
CREATE INDEX "documents_contactId_idx" ON "documents"("contactId");

-- CreateIndex
CREATE INDEX "documents_tenantId_fingerprint_idx" ON "documents"("tenantId", "fingerprint");

-- CreateIndex
CREATE INDEX "documents_tenantId_fileHash_idx" ON "documents"("tenantId", "fileHash");

-- CreateIndex
CREATE INDEX "document_line_items_documentId_idx" ON "document_line_items"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_payments_documentId_key" ON "document_payments"("documentId");

-- CreateIndex
CREATE INDEX "document_payments_documentId_idx" ON "document_payments"("documentId");

-- CreateIndex
CREATE INDEX "document_payments_bankAccountId_idx" ON "document_payments"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_accounts_tenantId_idx" ON "bank_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "bank_accounts_bankConnectionId_idx" ON "bank_accounts"("bankConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_tenantId_externalAccountId_key" ON "bank_accounts"("tenantId", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_authState_key" ON "bank_connections"("authState");

-- CreateIndex
CREATE INDEX "bank_connections_tenantId_idx" ON "bank_connections"("tenantId");

-- CreateIndex
CREATE INDEX "bank_transactions_tenantId_idx" ON "bank_transactions"("tenantId");

-- CreateIndex
CREATE INDEX "bank_transactions_bankAccountId_idx" ON "bank_transactions"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_date_idx" ON "bank_transactions"("date");

-- CreateIndex
CREATE INDEX "bank_transactions_status_idx" ON "bank_transactions"("status");

-- CreateIndex
CREATE INDEX "bank_transactions_documentId_idx" ON "bank_transactions"("documentId");

-- CreateIndex
CREATE INDEX "bank_transactions_invoiceId_idx" ON "bank_transactions"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_externalId_key" ON "bank_transactions"("bankAccountId", "externalId");

-- CreateIndex
CREATE INDEX "cashbook_entries_tenantId_idx" ON "cashbook_entries"("tenantId");

-- CreateIndex
CREATE INDEX "cashbook_entries_date_idx" ON "cashbook_entries"("date");

-- CreateIndex
CREATE INDEX "cashbook_entries_documentId_idx" ON "cashbook_entries"("documentId");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_idx" ON "journal_entries"("tenantId");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE INDEX "journal_entries_sourceType_sourceId_idx" ON "journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_entries_status_idx" ON "journal_entries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenantId_number_key" ON "journal_entries"("tenantId", "number");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountCode_idx" ON "journal_lines"("accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_documentId_key" ON "fixed_assets"("documentId");

-- CreateIndex
CREATE INDEX "fixed_assets_tenantId_idx" ON "fixed_assets"("tenantId");

-- CreateIndex
CREATE INDEX "fixed_assets_tenantId_status_idx" ON "fixed_assets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_tenantId_acquisitionDate_idx" ON "fixed_assets"("tenantId", "acquisitionDate");

-- CreateIndex
CREATE INDEX "fixed_assets_documentId_idx" ON "fixed_assets"("documentId");

-- CreateIndex
CREATE INDEX "fixed_assets_status_depreciationStart_idx" ON "fixed_assets"("status", "depreciationStart");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_tenantId_assetNumber_key" ON "fixed_assets"("tenantId", "assetNumber");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_tenantId_idx" ON "fixed_asset_depreciations"("tenantId");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_assetId_idx" ON "fixed_asset_depreciations"("assetId");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_tenantId_periodYear_periodMonth_idx" ON "fixed_asset_depreciations"("tenantId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciations_assetId_periodYear_periodMonth_key" ON "fixed_asset_depreciations"("assetId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_upload_sessions_token_key" ON "mobile_upload_sessions"("token");

-- CreateIndex
CREATE INDEX "mobile_upload_sessions_tenantId_idx" ON "mobile_upload_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "mobile_upload_sessions_userId_idx" ON "mobile_upload_sessions"("userId");

-- CreateIndex
CREATE INDEX "mobile_upload_sessions_expiresAt_idx" ON "mobile_upload_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_mailboxes_tenantId_key" ON "inbound_mailboxes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_mailboxes_token_key" ON "inbound_mailboxes"("token");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_mail_logs_messageId_key" ON "inbound_mail_logs"("messageId");

-- CreateIndex
CREATE INDEX "inbound_mail_logs_tenantId_idx" ON "inbound_mail_logs"("tenantId");

-- CreateIndex
CREATE INDEX "inbound_mail_logs_createdAt_idx" ON "inbound_mail_logs"("createdAt");

-- CreateIndex
CREATE INDEX "comments_tenantId_entityType_entityId_idx" ON "comments"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "comments_tenantId_resolvedAt_idx" ON "comments"("tenantId", "resolvedAt");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- CreateIndex
CREATE INDEX "month_closes_tenantId_idx" ON "month_closes"("tenantId");

-- CreateIndex
CREATE INDEX "month_closes_tenantId_status_idx" ON "month_closes"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "month_closes_tenantId_year_month_key" ON "month_closes"("tenantId", "year", "month");

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creditNoteForId_fkey" FOREIGN KEY ("creditNoteForId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderConfirmationId_fkey" FOREIGN KEY ("orderConfirmationId") REFERENCES "order_confirmations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmations" ADD CONSTRAINT "order_confirmations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmations" ADD CONSTRAINT "order_confirmations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmations" ADD CONSTRAINT "order_confirmations_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmations" ADD CONSTRAINT "order_confirmations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmation_line_items" ADD CONSTRAINT "order_confirmation_line_items_orderConfirmationId_fkey" FOREIGN KEY ("orderConfirmationId") REFERENCES "order_confirmations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_audit_hashes" ADD CONSTRAINT "invoice_audit_hashes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_line_items" ADD CONSTRAINT "recurring_invoice_line_items_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "recurring_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_line_items" ADD CONSTRAINT "document_line_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bankConnectionId_fkey" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_sequence" ADD CONSTRAINT "journal_sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_sequence" ADD CONSTRAINT "fixed_asset_sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_ranges" ADD CONSTRAINT "number_ranges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_upload_sessions" ADD CONSTRAINT "mobile_upload_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_upload_sessions" ADD CONSTRAINT "mobile_upload_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_mailboxes" ADD CONSTRAINT "inbound_mailboxes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_mail_logs" ADD CONSTRAINT "inbound_mail_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

