-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'INVESTMENT', 'CREDIT_CARD', 'CASH', 'DIGITAL_WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('FIXED_INCOME', 'VARIABLE_INCOME', 'FUNDS', 'PENSION', 'CRYPTO', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CLEARED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('MANUAL', 'OFX_IMPORT', 'EXCEL_IMPORT', 'RECURRING', 'INSTALLMENT', 'API');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('FUTURE', 'OPEN', 'CLOSED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('TRANSFER', 'INVOICE_PAYMENT', 'INVESTMENT_DEPOSIT', 'INVESTMENT_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "InstallmentPlanStatus" AS ENUM ('ACTIVE', 'FINISHED', 'PREPAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('OFX', 'EXCEL', 'CSV');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'AWAITING_REVIEW', 'COMPLETED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'SUGGESTED', 'READY', 'MATCHED', 'IMPORTED', 'DUPLICATE', 'IGNORED', 'ERROR');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('FITID', 'AUTO_EXACT', 'AUTO_FUZZY', 'MANUAL', 'CREATED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ExcelAmountMode" AS ENUM ('SINGLE_SIGNED', 'DEBIT_CREDIT_COLS', 'AMOUNT_AND_TYPE');

-- CreateEnum
CREATE TYPE "RuleMatchField" AS ENUM ('DESCRIPTION', 'MEMO', 'PAYEE');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'EQUALS', 'REGEX');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "monthStartDay" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "defaultWorkspaceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "institutionName" TEXT,
    "bankCode" TEXT,
    "branch" TEXT,
    "accountNumber" TEXT,
    "ofxBankId" TEXT,
    "ofxAccountId" TEXT,
    "initialBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "initialBalanceDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "projectedBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lastReconciledBalance" DECIMAL(15,2),
    "lastReconciledAt" TIMESTAMP(3),
    "lastReconciledDate" DATE,
    "matchDateToleranceDays" INTEGER NOT NULL DEFAULT 3,
    "creditLimit" DECIMAL(15,2),
    "closingDay" INTEGER,
    "dueDay" INTEGER,
    "cardBrand" TEXT,
    "lastFourDigits" CHAR(4),
    "holderUserId" UUID,
    "paymentAccountId" UUID,
    "investmentType" "InvestmentType",
    "includeInTotals" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "includeInReports" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payees" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "defaultCategoryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'CLEARED',
    "source" "TransactionSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" UUID,
    "updatedById" UUID,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" DATE NOT NULL,
    "competenceDate" DATE,
    "confirmedAt" TIMESTAMP(3),
    "clearedDate" DATE,
    "description" TEXT NOT NULL,
    "originalDescription" TEXT,
    "notes" TEXT,
    "checkNumber" TEXT,
    "categoryId" UUID,
    "payeeId" UUID,
    "isSplit" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" UUID,
    "installmentPlanId" UUID,
    "installmentNumber" INTEGER,
    "recurringRuleId" UUID,
    "importBatchId" UUID,
    "fitId" TEXT,
    "importHash" TEXT,
    "reconciliationId" UUID,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_splits" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "TransferKind" NOT NULL DEFAULT 'TRANSFER',
    "fromTransactionId" UUID NOT NULL,
    "toTransactionId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "invoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_card_invoices" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "closingDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_card_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "categoryId" UUID,
    "payeeId" UUID,
    "description" TEXT NOT NULL,
    "status" "InstallmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchaseDate" DATE NOT NULL,
    "firstDueMonth" DATE NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "installmentAmount" DECIMAL(15,2) NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "firstInstallmentAmount" DECIMAL(15,2),
    "hasInterest" BOOLEAN NOT NULL DEFAULT false,
    "cashPrice" DECIMAL(15,2),
    "monthlyInterest" DECIMAL(7,4),
    "paidInstallments" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(15,2) NOT NULL,
    "lastDueMonth" DATE NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_rules" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "transferToAccountId" UUID,
    "transferKind" "TransferKind",
    "categoryId" UUID,
    "payeeId" UUID,
    "type" "TransactionType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "occurrencesLimit" INTEGER,
    "occurrencesCount" INTEGER NOT NULL DEFAULT 0,
    "nextOccurrence" DATE NOT NULL,
    "daysInAdvance" INTEGER NOT NULL DEFAULT 30,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "plannedAmount" DECIMAL(15,2) NOT NULL,
    "alertThreshold" INTEGER DEFAULT 80,
    "rollover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorization_rules" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchField" "RuleMatchField" NOT NULL DEFAULT 'DESCRIPTION',
    "matchType" "RuleMatchType" NOT NULL DEFAULT 'CONTAINS',
    "pattern" TEXT NOT NULL,
    "caseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "accountId" UUID,
    "amountMin" DECIMAL(15,2),
    "amountMax" DECIMAL(15,2),
    "categoryId" UUID,
    "payeeId" UUID,
    "setDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID,
    "templateId" UUID,
    "source" "ImportSource" NOT NULL,
    "createdById" UUID,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSize" INTEGER,
    "sheetName" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "ofxBankId" TEXT,
    "ofxAccountId" TEXT,
    "ofxLedgerBalance" DECIMAL(15,2),
    "ofxBalanceDate" TIMESTAMP(3),
    "ofxAvailableBalance" DECIMAL(15,2),
    "ofxCurrency" CHAR(3),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "ignoredRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "rawData" JSONB NOT NULL,
    "date" DATE,
    "amount" DECIMAL(15,2),
    "description" TEXT,
    "payeeName" TEXT,
    "memo" TEXT,
    "bankTransactionType" TEXT,
    "fitId" TEXT,
    "checkNumber" TEXT,
    "hash" TEXT,
    "suggestedCategoryId" UUID,
    "suggestedPayeeId" UUID,
    "matchedRuleId" UUID,
    "matchedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID,
    "name" TEXT NOT NULL,
    "sheetName" TEXT,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "firstDataRow" INTEGER NOT NULL DEFAULT 2,
    "columnMapping" JSONB NOT NULL,
    "dateFormat" TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
    "decimalSeparator" CHAR(1) NOT NULL DEFAULT ',',
    "amountMode" "ExcelAmountMode" NOT NULL DEFAULT 'SINGLE_SIGNED',
    "invertSign" BOOLEAN NOT NULL DEFAULT false,
    "debitIndicator" TEXT,
    "skipPatterns" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "importBatchId" UUID,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "statementOpeningBalance" DECIMAL(15,2),
    "statementClosingBalance" DECIMAL(15,2) NOT NULL,
    "systemOpeningBalance" DECIMAL(15,2),
    "systemClosingBalance" DECIMAL(15,2),
    "difference" DECIMAL(15,2),
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedBank" INTEGER NOT NULL DEFAULT 0,
    "unmatchedBooks" INTEGER NOT NULL DEFAULT 0,
    "adjustmentTransactionId" UUID,
    "notes" TEXT,
    "startedById" UUID,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_matches" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "importRowId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "MatchMethod" NOT NULL,
    "score" DECIMAL(5,4),
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_monthly_balances" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalExpense" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transfersIn" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transfersOut" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_monthly_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_monthly_summaries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "parentCategoryId" UUID,
    "categoryType" "CategoryType" NOT NULL,
    "month" DATE NOT NULL,
    "actualAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "budgetedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_summaries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "totalIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalExpense" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netResult" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "savingsRate" DECIMAL(7,4),
    "totalBudgeted" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingExpense" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cashBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "investmentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "creditCardDebt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netWorth" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TagToTransaction" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_TagToTransaction_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "workspace_members_userId_idx" ON "workspace_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_tokenHash_key" ON "workspace_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "workspace_invites_workspaceId_status_idx" ON "workspace_invites"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "workspace_invites_email_idx" ON "workspace_invites"("email");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_type_idx" ON "accounts"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_workspaceId_name_key" ON "accounts"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_workspaceId_ofxBankId_ofxAccountId_key" ON "accounts"("workspaceId", "ofxBankId", "ofxAccountId");

-- CreateIndex
CREATE INDEX "categories_workspaceId_type_idx" ON "categories"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_workspaceId_type_parentId_name_key" ON "categories"("workspaceId", "type", "parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payees_workspaceId_name_key" ON "payees"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspaceId_name_key" ON "tags"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "transactions_workspaceId_date_idx" ON "transactions"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "transactions_createdById_idx" ON "transactions"("createdById");

-- CreateIndex
CREATE INDEX "transactions_accountId_date_idx" ON "transactions"("accountId", "date");

-- CreateIndex
CREATE INDEX "transactions_accountId_status_idx" ON "transactions"("accountId", "status");

-- CreateIndex
CREATE INDEX "transactions_categoryId_date_idx" ON "transactions"("categoryId", "date");

-- CreateIndex
CREATE INDEX "transactions_workspaceId_competenceDate_idx" ON "transactions"("workspaceId", "competenceDate");

-- CreateIndex
CREATE INDEX "transactions_invoiceId_idx" ON "transactions"("invoiceId");

-- CreateIndex
CREATE INDEX "transactions_installmentPlanId_idx" ON "transactions"("installmentPlanId");

-- CreateIndex
CREATE INDEX "transactions_importBatchId_idx" ON "transactions"("importBatchId");

-- CreateIndex
CREATE INDEX "transactions_reconciliationId_idx" ON "transactions"("reconciliationId");

-- CreateIndex
CREATE INDEX "transactions_accountId_clearedDate_idx" ON "transactions"("accountId", "clearedDate");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_accountId_fitId_key" ON "transactions"("accountId", "fitId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_accountId_importHash_key" ON "transactions"("accountId", "importHash");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_installmentPlanId_installmentNumber_key" ON "transactions"("installmentPlanId", "installmentNumber");

-- CreateIndex
CREATE INDEX "transaction_splits_transactionId_idx" ON "transaction_splits"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_splits_categoryId_idx" ON "transaction_splits"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_fromTransactionId_key" ON "transfers"("fromTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_toTransactionId_key" ON "transfers"("toTransactionId");

-- CreateIndex
CREATE INDEX "transfers_workspaceId_date_idx" ON "transfers"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "transfers_invoiceId_idx" ON "transfers"("invoiceId");

-- CreateIndex
CREATE INDEX "credit_card_invoices_accountId_status_idx" ON "credit_card_invoices"("accountId", "status");

-- CreateIndex
CREATE INDEX "credit_card_invoices_dueDate_idx" ON "credit_card_invoices"("dueDate");

-- CreateIndex
CREATE INDEX "credit_card_invoices_workspaceId_dueDate_idx" ON "credit_card_invoices"("workspaceId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "credit_card_invoices_accountId_referenceMonth_key" ON "credit_card_invoices"("accountId", "referenceMonth");

-- CreateIndex
CREATE INDEX "installment_plans_workspaceId_status_idx" ON "installment_plans"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "installment_plans_accountId_lastDueMonth_idx" ON "installment_plans"("accountId", "lastDueMonth");

-- CreateIndex
CREATE INDEX "recurring_rules_workspaceId_isActive_nextOccurrence_idx" ON "recurring_rules"("workspaceId", "isActive", "nextOccurrence");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_workspaceId_categoryId_month_key" ON "budgets"("workspaceId", "categoryId", "month");

-- CreateIndex
CREATE INDEX "categorization_rules_workspaceId_isActive_priority_idx" ON "categorization_rules"("workspaceId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "import_batches_workspaceId_createdAt_idx" ON "import_batches"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "import_batches_workspaceId_fileHash_idx" ON "import_batches"("workspaceId", "fileHash");

-- CreateIndex
CREATE INDEX "import_rows_batchId_status_idx" ON "import_rows"("batchId", "status");

-- CreateIndex
CREATE INDEX "import_rows_workspaceId_fitId_idx" ON "import_rows"("workspaceId", "fitId");

-- CreateIndex
CREATE INDEX "import_rows_workspaceId_date_amount_idx" ON "import_rows"("workspaceId", "date", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_rowNumber_key" ON "import_rows"("batchId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_workspaceId_name_key" ON "import_templates"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_adjustmentTransactionId_key" ON "bank_reconciliations"("adjustmentTransactionId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_workspaceId_accountId_periodEnd_idx" ON "bank_reconciliations"("workspaceId", "accountId", "periodEnd");

-- CreateIndex
CREATE INDEX "bank_reconciliations_accountId_status_idx" ON "bank_reconciliations"("accountId", "status");

-- CreateIndex
CREATE INDEX "reconciliation_matches_transactionId_idx" ON "reconciliation_matches"("transactionId");

-- CreateIndex
CREATE INDEX "reconciliation_matches_workspaceId_isConfirmed_idx" ON "reconciliation_matches"("workspaceId", "isConfirmed");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_matches_importRowId_transactionId_key" ON "reconciliation_matches"("importRowId", "transactionId");

-- CreateIndex
CREATE INDEX "account_monthly_balances_month_idx" ON "account_monthly_balances"("month");

-- CreateIndex
CREATE INDEX "account_monthly_balances_workspaceId_month_idx" ON "account_monthly_balances"("workspaceId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "account_monthly_balances_accountId_month_key" ON "account_monthly_balances"("accountId", "month");

-- CreateIndex
CREATE INDEX "category_monthly_summaries_workspaceId_month_categoryType_idx" ON "category_monthly_summaries"("workspaceId", "month", "categoryType");

-- CreateIndex
CREATE INDEX "category_monthly_summaries_workspaceId_parentCategoryId_mon_idx" ON "category_monthly_summaries"("workspaceId", "parentCategoryId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "category_monthly_summaries_workspaceId_categoryId_month_key" ON "category_monthly_summaries"("workspaceId", "categoryId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_summaries_workspaceId_month_key" ON "monthly_summaries"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "_TagToTransaction_B_index" ON "_TagToTransaction"("B");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "credit_card_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "recurring_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromTransactionId_fkey" FOREIGN KEY ("fromTransactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toTransactionId_fkey" FOREIGN KEY ("toTransactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "credit_card_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_card_invoices" ADD CONSTRAINT "credit_card_invoices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_card_invoices" ADD CONSTRAINT "credit_card_invoices_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_transferToAccountId_fkey" FOREIGN KEY ("transferToAccountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "import_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_suggestedPayeeId_fkey" FOREIGN KEY ("suggestedPayeeId") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_matchedRuleId_fkey" FOREIGN KEY ("matchedRuleId") REFERENCES "categorization_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "import_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_monthly_balances" ADD CONSTRAINT "account_monthly_balances_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_monthly_balances" ADD CONSTRAINT "account_monthly_balances_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_monthly_summaries" ADD CONSTRAINT "category_monthly_summaries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_monthly_summaries" ADD CONSTRAINT "category_monthly_summaries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToTransaction" ADD CONSTRAINT "_TagToTransaction_A_fkey" FOREIGN KEY ("A") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToTransaction" ADD CONSTRAINT "_TagToTransaction_B_fkey" FOREIGN KEY ("B") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
