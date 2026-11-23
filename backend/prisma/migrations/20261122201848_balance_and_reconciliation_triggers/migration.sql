-- =============================================================================
--  Manutenção automática de saldos das contas
--  Aplicar após a primeira migration (ex.: criar migration vazia com
--  `npx prisma migrate dev --create-only --name balance_triggers` e colar este SQL).
--
--  accounts.currentBalance   = initialBalance + SUM(amount) WHERE status IN (CLEARED, RECONCILED)
--  accounts.projectedBalance = initialBalance + SUM(amount)  (inclui PENDING)
-- =============================================================================

-- 1) Atualização incremental a cada INSERT / UPDATE / DELETE em transactions
CREATE OR REPLACE FUNCTION fn_transactions_update_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE accounts SET
      "projectedBalance" = "projectedBalance" - OLD.amount,
      "currentBalance"   = "currentBalance"
                           - CASE WHEN OLD.status IN ('CLEARED', 'RECONCILED') THEN OLD.amount ELSE 0 END,
      "updatedAt"        = now()
    WHERE id = OLD."accountId";
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE accounts SET
      "projectedBalance" = "projectedBalance" + NEW.amount,
      "currentBalance"   = "currentBalance"
                           + CASE WHEN NEW.status IN ('CLEARED', 'RECONCILED') THEN NEW.amount ELSE 0 END,
      "updatedAt"        = now()
    WHERE id = NEW."accountId";
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_update_balance ON transactions;
CREATE TRIGGER trg_transactions_update_balance
AFTER INSERT OR DELETE OR UPDATE OF amount, status, "accountId" ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_transactions_update_balance();


-- 2) Novo cadastro de conta: saldos começam iguais ao saldo inicial
--    Alteração do saldo inicial: aplica a diferença
CREATE OR REPLACE FUNCTION fn_accounts_initial_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."currentBalance"   := NEW."initialBalance";
    NEW."projectedBalance" := NEW."initialBalance";
  ELSIF NEW."initialBalance" IS DISTINCT FROM OLD."initialBalance" THEN
    NEW."currentBalance"   := NEW."currentBalance"   + (NEW."initialBalance" - OLD."initialBalance");
    NEW."projectedBalance" := NEW."projectedBalance" + (NEW."initialBalance" - OLD."initialBalance");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounts_initial_balance ON accounts;
CREATE TRIGGER trg_accounts_initial_balance
BEFORE INSERT OR UPDATE OF "initialBalance" ON accounts
FOR EACH ROW EXECUTE FUNCTION fn_accounts_initial_balance();


-- 3) Recalcular do zero (auditoria / correção). Uso: SELECT fn_recalculate_account_balance('<uuid>');
CREATE OR REPLACE FUNCTION fn_recalculate_account_balance(p_account_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE accounts a SET
    "currentBalance" = a."initialBalance" + COALESCE((
        SELECT SUM(t.amount) FROM transactions t
        WHERE t."accountId" = a.id AND t.status IN ('CLEARED', 'RECONCILED')), 0),
    "projectedBalance" = a."initialBalance" + COALESCE((
        SELECT SUM(t.amount) FROM transactions t
        WHERE t."accountId" = a.id), 0),
    "updatedAt" = now()
  WHERE a.id = p_account_id;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
--  Totais das faturas de cartão (totalAmount / paidAmount / status)
--  totalAmount = -(SUM(transactions.amount))  -> compras, parcelas (inclusive previstas), estornos
--  paidAmount  = SUM(transfers.amount) cujo lançamento de entrada está efetivado
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_recalculate_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_total numeric(15,2);
  v_paid  numeric(15,2);
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(-SUM(t.amount), 0) INTO v_total
  FROM transactions t WHERE t."invoiceId" = p_invoice_id;

  SELECT COALESCE(SUM(tr.amount), 0) INTO v_paid
  FROM transfers tr
  JOIN transactions t ON t.id = tr."toTransactionId"
  WHERE tr."invoiceId" = p_invoice_id
    AND t.status IN ('CLEARED', 'RECONCILED');

  UPDATE credit_card_invoices i SET
    "totalAmount" = v_total,
    "paidAmount"  = v_paid,
    status = CASE
      WHEN i.status IN ('CLOSED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID') AND v_paid >= v_total AND v_total > 0 THEN 'PAID'::"InvoiceStatus"
      WHEN i.status IN ('CLOSED', 'OVERDUE', 'PAID') AND v_paid > 0 AND v_paid < v_total THEN 'PARTIALLY_PAID'::"InvoiceStatus"
      ELSE i.status
    END,
    "paidAt" = CASE WHEN v_paid >= v_total AND v_total > 0 THEN COALESCE(i."paidAt", now()) ELSE NULL END,
    "updatedAt" = now()
  WHERE i.id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- Lançamentos: compra/parcela muda de fatura, valor ou status
CREATE OR REPLACE FUNCTION fn_transactions_update_invoice()
RETURNS TRIGGER AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM fn_recalculate_invoice(OLD."invoiceId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'INSERT' OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" THEN
      PERFORM fn_recalculate_invoice(NEW."invoiceId");
    END IF;
    -- Pagamento de fatura efetivado/estornado (status do lançamento de entrada)
    IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.amount IS DISTINCT FROM OLD.amount) THEN
      FOR r IN SELECT "invoiceId" FROM transfers WHERE "toTransactionId" = NEW.id AND "invoiceId" IS NOT NULL LOOP
        PERFORM fn_recalculate_invoice(r."invoiceId");
      END LOOP;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_update_invoice ON transactions;
CREATE TRIGGER trg_transactions_update_invoice
AFTER INSERT OR DELETE OR UPDATE OF amount, status, "invoiceId" ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_transactions_update_invoice();

-- Transferências: pagamento vinculado/desvinculado de uma fatura
CREATE OR REPLACE FUNCTION fn_transfers_update_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM fn_recalculate_invoice(OLD."invoiceId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'INSERT' OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" OR NEW.amount IS DISTINCT FROM OLD.amount THEN
      PERFORM fn_recalculate_invoice(NEW."invoiceId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transfers_update_invoice ON transfers;
CREATE TRIGGER trg_transfers_update_invoice
AFTER INSERT OR DELETE OR UPDATE OF amount, "invoiceId" ON transfers
FOR EACH ROW EXECUTE FUNCTION fn_transfers_update_invoice();


-- =============================================================================
--  Conciliação bancária: trava de lançamentos conciliados
--  Um lançamento RECONCILED não pode ter valor/conta/data alterados nem ser
--  excluído. Para corrigir, primeiro "desconcilie" (status -> CLEARED e
--  reconciliationId -> NULL), de forma explícita, no mesmo UPDATE ou antes.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_transactions_lock_reconciled()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'RECONCILED' THEN
      RAISE EXCEPTION 'Lançamento % está conciliado e não pode ser excluído. Desconcilie antes.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'RECONCILED' AND NEW.status = 'RECONCILED' AND (
       NEW.amount      IS DISTINCT FROM OLD.amount
    OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
    OR NEW.date        IS DISTINCT FROM OLD.date
  ) THEN
    RAISE EXCEPTION 'Lançamento % está conciliado: valor, conta e data não podem ser alterados.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_lock_reconciled ON transactions;
CREATE TRIGGER trg_transactions_lock_reconciled
BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_transactions_lock_reconciled();


-- =============================================================================
--  Conciliação: mantém import_rows.matchedAmount = SUM(reconciliation_matches.amount)
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_matches_update_row_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_row uuid;
BEGIN
  FOR v_row IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."importRowId" END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."importRowId" END
    ]) AS x WHERE x IS NOT NULL
  LOOP
    UPDATE import_rows SET
      "matchedAmount" = COALESCE((SELECT SUM(amount) FROM reconciliation_matches WHERE "importRowId" = v_row), 0),
      "updatedAt" = now()
    WHERE id = v_row;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_matches_update_row_amount ON reconciliation_matches;
CREATE TRIGGER trg_matches_update_row_amount
AFTER INSERT OR DELETE OR UPDATE OF amount, "importRowId" ON reconciliation_matches
FOR EACH ROW EXECUTE FUNCTION fn_matches_update_row_amount();
