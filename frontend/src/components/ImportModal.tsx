"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RotateCcw,
  Link2,
  PlusCircle,
  Ban,
  Sparkles,
  ArrowLeft,
  Check,
  ArrowRightLeft,
  ShieldCheck,
  Landmark,
  CreditCard,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface CategoryOption {
  id: string;
  name: string;
  type?: string;
  parentId?: string | null;
  parent?: { id: string; name: string } | null;
  children?: CategoryOption[];
}

interface CandidateTransaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  status: "PENDING" | "CLEARED" | "RECONCILED";
  source: string;
  fitId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

interface PreviewItem {
  tempId: string;
  rowNumber: number;
  date: string;
  competenceDate: string | null;
  amount: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";
  status: "CLEARED" | "PENDING";
  source: "OFX_IMPORT" | "EXCEL_IMPORT";
  description: string;
  originalDescription: string;
  fitId: string | null;
  importHash: string;
  legacyHash: string | null;
  installmentNumber: number | null;
  notes: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  matchStatus: "DUPLICATE" | "MATCH" | "NEW";
  defaultAction: "IGNORE" | "RECONCILE" | "CREATE";
  matchedTransaction: CandidateTransaction | null;
  matchScore: number;
  matchMethod: "FITID" | "AUTO_EXACT" | "AUTO_FUZZY" | null;
  matchReason: string | null;
}

interface EditableReconciliationItem extends PreviewItem {
  action: "RECONCILE" | "CREATE" | "IGNORE";
  selectedTransactionId: string | null;
  keepExistingDescription: boolean;
  customDescription: string;
  selectedCategoryId: string | null;
}

interface PreviewResponse {
  account: {
    id: string;
    name: string;
    type: string;
    currency: string;
    currentBalance: number;
    projectedBalance: number;
  };
  fileName: string;
  format: string;
  formatLabel: string;
  ledgerBalance: number | null;
  balanceDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  summary: {
    total: number;
    matched: number;
    newItems: number;
    duplicates: number;
  };
  items: PreviewItem[];
  availableCandidates: CandidateTransaction[];
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Array<{ id: string; name: string; type?: string; currency?: string }>;
  categories?: CategoryOption[];
  defaultAccountId?: string;
  onSuccess?: () => void;
}

export function ImportModal({
  isOpen,
  onClose,
  accounts,
  categories = [],
  defaultAccountId,
  onSuccess,
}: ImportModalProps) {
  const [mode, setMode] = useState<"CHECKING" | "CREDIT_CARD">("CHECKING");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"UPLOAD" | "REVIEW" | "DONE">("UPLOAD");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [rows, setRows] = useState<EditableReconciliationItem[]>([]);
  const [filterTab, setFilterTab] = useState<"ALL" | "RECONCILE" | "CREATE" | "IGNORE">("ALL");

  // Resultado da conciliação de conta corrente
  const [reconcileResult, setReconcileResult] = useState<{
    reconciled: number;
    created: number;
    ignored: number;
    newBalance?: number | null;
    accountCurrency?: string;
  } | null>(null);

  // Resultado da importação direta de fatura de cartão
  const [cardResult, setCardResult] = useState<{
    inserted: number;
    skipped: number;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Separar contas correntes/bancárias vs cartões de crédito
  const checkingAccounts = useMemo(
    () => accounts.filter((a) => a.type !== "CREDIT_CARD"),
    [accounts]
  );
  const creditCardAccounts = useMemo(
    () => accounts.filter((a) => a.type === "CREDIT_CARD"),
    [accounts]
  );

  const wasOpenRef = useRef(false);

  // Ao abrir o modal (transição false -> true), reseta o formulário e detecta o modo ideal
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      resetForm();
      if (defaultAccountId) {
        const targetAcc = accounts.find((a) => a.id === defaultAccountId);
        if (targetAcc?.type === "CREDIT_CARD") {
          setMode("CREDIT_CARD");
          setSelectedAccount(targetAcc.id);
        } else if (targetAcc) {
          setMode("CHECKING");
          setSelectedAccount(targetAcc.id);
        } else {
          setMode("CHECKING");
          setSelectedAccount(checkingAccounts[0]?.id || accounts[0]?.id || "");
        }
      } else {
        setMode("CHECKING");
        setSelectedAccount(checkingAccounts[0]?.id || accounts[0]?.id || "");
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, defaultAccountId, accounts, checkingAccounts]);

  // Atualizar conta selecionada quando o usuário alternar entre as abas
  function handleSwitchMode(newMode: "CHECKING" | "CREDIT_CARD") {
    setMode(newMode);
    setFile(null);
    setError(null);
    setCardResult(null);
    setReconcileResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (newMode === "CHECKING") {
      setSelectedAccount(checkingAccounts[0]?.id || "");
    } else {
      setSelectedAccount(creditCardAccounts[0]?.id || "");
    }
  }

  const flatCategories = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [];
    const parents = categories.filter((c) => !c.parentId);
    for (const p of parents) {
      list.push({ id: p.id, label: p.name });
      const children = p.children || categories.filter((c) => c.parentId === p.id);
      for (const ch of children) {
        list.push({ id: ch.id, label: `${p.name} › ${ch.name}` });
      }
    }
    if (list.length === 0) {
      for (const c of categories) {
        list.push({
          id: c.id,
          label: c.parent ? `${c.parent.name} › ${c.name}` : c.name,
        });
      }
    }
    return list;
  }, [categories]);

  const candidatesMap = useMemo(() => {
    const map = new Map<string, CandidateTransaction>();
    if (previewData) {
      for (const c of previewData.availableCandidates) {
        map.set(c.id, c);
      }
      for (const it of previewData.items) {
        if (it.matchedTransaction) {
          map.set(it.matchedTransaction.id, it.matchedTransaction);
        }
      }
    }
    return map;
  }, [previewData]);

  function resetForm() {
    setFile(null);
    setStep("UPLOAD");
    setPreviewData(null);
    setRows([]);
    setFilterTab("ALL");
    setReconcileResult(null);
    setCardResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  // ===========================================================================
  // PROCESSO 1: CONCILIAÇÃO DE CONTA CORRENTE (.OFX) -> PREVIEW & MATCHING
  // ===========================================================================
  async function handlePreviewReconciliation() {
    if (!file || !selectedAccount) {
      setError("Selecione o arquivo .ofx e a conta corrente de destino.");
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("accountId", selectedAccount);
    formData.append("file", file);

    const token = localStorage.getItem("token");

    try {
      const res = await fetch(
        `http://localhost:3333/api/imports/preview?accountId=${encodeURIComponent(selectedAccount)}`,
        {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ? `${data.error || "Erro"}: ${data.message}` : data.error || "Erro ao analisar extrato para conciliação"
        );
      }

      const preview: PreviewResponse = data;
      setPreviewData(preview);

      const editable: EditableReconciliationItem[] = preview.items.map((item) => ({
        ...item,
        action: item.defaultAction,
        selectedTransactionId: item.matchedTransaction?.id || null,
        keepExistingDescription: true,
        customDescription: item.description,
        selectedCategoryId: item.matchedTransaction?.categoryId || item.suggestedCategoryId || null,
      }));

      setRows(editable);
      setStep("REVIEW");
    } catch (err: any) {
      setError(err.message || "Falha ao analisar arquivo de extrato");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmReconciliation() {
    if (!previewData) return;

    setConfirming(true);
    setError(null);

    const token = localStorage.getItem("token");

    try {
      const payload = {
        accountId: previewData.account.id,
        fileName: previewData.fileName,
        format: previewData.format,
        ledgerBalance: previewData.ledgerBalance,
        items: rows.map((r) => ({
          tempId: r.tempId,
          action: r.action,
          matchedTransactionId: r.action === "RECONCILE" ? r.selectedTransactionId : null,
          keepExistingDescription: r.keepExistingDescription,
          date: r.date,
          competenceDate: r.competenceDate,
          amount: r.amount,
          type: r.type,
          source: r.source,
          description: r.action === "CREATE" ? r.customDescription : r.description,
          originalDescription: r.originalDescription,
          fitId: r.fitId,
          importHash: r.importHash,
          categoryId: r.selectedCategoryId || null,
          installmentNumber: r.installmentNumber,
          notes: r.notes,
        })),
      };

      const res = await fetch("http://localhost:3333/api/imports/confirm-reconciliation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ? `${data.error || "Erro"}: ${data.message}` : data.error || "Erro ao confirmar conciliação"
        );
      }

      setReconcileResult({
        reconciled: data.reconciled ?? 0,
        created: data.created ?? 0,
        ignored: data.ignored ?? 0,
        newBalance: data.account?.currentBalance ?? null,
        accountCurrency: previewData.account.currency || "BRL",
      });
      setStep("DONE");
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || "Falha ao confirmar conciliação");
    } finally {
      setConfirming(false);
    }
  }

  // ===========================================================================
  // PROCESSO 2: IMPORTAÇÃO DIRETA DE FATURA DE CARTÃO DE CRÉDITO (.CSV / .XLS)
  // ===========================================================================
  async function handleCardDirectImport() {
    if (!file || !selectedAccount) {
      setError("Selecione o arquivo da fatura e o cartão de crédito.");
      return;
    }

    setLoading(true);
    setError(null);
    setCardResult(null);

    const formData = new FormData();
    formData.append("accountId", selectedAccount);
    formData.append("file", file);

    const token = localStorage.getItem("token");

    try {
      const res = await fetch(
        `http://localhost:3333/api/imports/organizze-csv?accountId=${encodeURIComponent(selectedAccount)}`,
        {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ? `${data.error || "Erro"}: ${data.message}` : data.error || "Erro ao importar fatura de cartão"
        );
      }

      setCardResult({ inserted: data.inserted ?? 0, skipped: data.skipped ?? 0 });
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || "Falha na importação da fatura");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(tempId: string, patch: Partial<EditableReconciliationItem>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.tempId !== tempId) return r;
        const updated = { ...r, ...patch };
        if (patch.action === "RECONCILE" && !updated.selectedTransactionId && previewData) {
          const sameSignCandidate = previewData.availableCandidates.find(
            (c) => (r.amount < 0 && c.amount < 0) || (r.amount >= 0 && c.amount >= 0)
          );
          if (sameSignCandidate) {
            updated.selectedTransactionId = sameSignCandidate.id;
          }
        }
        return updated;
      })
    );
  }

  // Contadores e simulação de saldo em tempo real para a Mesa de Conciliação
  const stats = useMemo(() => {
    let reconcileCount = 0;
    let createCount = 0;
    let ignoreCount = 0;
    let balanceDelta = 0;

    for (const r of rows) {
      if (r.action === "RECONCILE") {
        reconcileCount++;
        const targetTx = r.selectedTransactionId ? candidatesMap.get(r.selectedTransactionId) : null;
        if (targetTx) {
          if (targetTx.status === "PENDING") {
            balanceDelta += r.amount;
          } else {
            balanceDelta += r.amount - targetTx.amount;
          }
        } else {
          balanceDelta += r.amount;
        }
      } else if (r.action === "CREATE") {
        createCount++;
        balanceDelta += r.amount;
      } else {
        ignoreCount++;
      }
    }

    const currentBalance = previewData?.account.currentBalance ?? 0;
    const simulatedBalance = currentBalance + balanceDelta;

    return {
      reconcileCount,
      createCount,
      ignoreCount,
      balanceDelta,
      currentBalance,
      simulatedBalance,
    };
  }, [rows, previewData, candidatesMap]);

  const filteredRows = useMemo(() => {
    if (filterTab === "ALL") return rows;
    return rows.filter((r) => r.action === filterTab);
  }, [rows, filterTab]);

  if (!isOpen) return null;

  const accountCurrency = previewData?.account.currency || "BRL";
  const activeAccountsList = mode === "CHECKING" ? checkingAccounts : creditCardAccounts;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div
        className={`bg-slate-900 border border-slate-800 rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${
          step === "REVIEW" ? "max-w-5xl max-h-[92vh]" : "max-w-lg"
        }`}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl border ${
                mode === "CHECKING"
                  ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
                  : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              }`}
            >
              {mode === "CHECKING" ? <Landmark className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
                {step === "UPLOAD" &&
                  (mode === "CHECKING"
                    ? "Conciliação de Conta Corrente (.OFX)"
                    : "Importar Fatura de Cartão (.CSV / .XLS)")}
                {step === "REVIEW" && (
                  <>
                    <span>Mesa de Conciliação Bancária</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      {previewData?.account.name}
                    </span>
                  </>
                )}
                {step === "DONE" && "Conciliação Bancária Concluída"}
              </h2>
              {step === "REVIEW" && previewData && (
                <p className="text-[11px] text-slate-400">
                  {previewData.formatLabel} • <span className="text-slate-300">{previewData.fileName}</span>
                  {previewData.periodStart && previewData.periodEnd && (
                    <span>
                      {" "}
                      • Período: {formatDate(previewData.periodStart)} a {formatDate(previewData.periodEnd)}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ETAPA 1: UPLOAD COM DUAS ABAS DISTINTAS */}
        {step === "UPLOAD" && (
          <div className="p-6 space-y-5">
            {/* Seletor de Abas: Conta Corrente (.OFX) vs Cartão de Crédito (.CSV/.XLS) */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => handleSwitchMode("CHECKING")}
                className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  mode === "CHECKING"
                    ? "bg-cyan-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Landmark className="h-4 w-4" />
                <span>Conta Corrente (.OFX)</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchMode("CREDIT_CARD")}
                className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  mode === "CREDIT_CARD"
                    ? "bg-emerald-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <CreditCard className="h-4 w-4" />
                <span>Cartão de Crédito (.CSV/.XLS)</span>
              </button>
            </div>

            {/* Conta ou Cartão Alvo */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">
                {mode === "CHECKING" ? "Conta Corrente a Conciliar" : "Cartão de Crédito da Fatura"}
              </label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                {activeAccountsList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Dropzone específico para cada modo */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">
                {mode === "CHECKING"
                  ? "Arquivo de Extrato Bancário (.ofx)"
                  : "Arquivo da Fatura do Cartão (.csv, .xls, .xlsx)"}
              </label>
              <label
                className={`border-2 border-dashed border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-slate-950/40 ${
                  mode === "CHECKING" ? "hover:border-cyan-500/50" : "hover:border-emerald-500/50"
                }`}
              >
                <FileSpreadsheet className="h-8 w-8 text-slate-400" />
                <div className="text-center">
                  <span
                    className={`text-xs font-semibold ${
                      mode === "CHECKING" ? "text-cyan-400" : "text-emerald-400"
                    }`}
                  >
                    Clique para selecionar o arquivo
                  </span>
                  <span className="text-xs text-slate-500 block">
                    {mode === "CHECKING"
                      ? "Extrato .ofx exportado do Itaú, Nubank, Inter, etc."
                      : "Fatura .csv do Nubank ou planilha .xls/.xlsx do Cartão Itaú"}
                  </span>
                </div>
                {file && (
                  <div
                    className={`mt-2 px-3 py-1 rounded-lg text-xs font-medium border ${
                      mode === "CHECKING"
                        ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    }`}
                  >
                    {file.name}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={mode === "CHECKING" ? ".ofx,.csv,.xls,.xlsx" : ".csv,.xls,.xlsx"}
                  className="hidden"
                  onChange={(e) => {
                    setError(null);
                    setCardResult(null);
                    setFile(e.target.files?.[0] || null);
                  }}
                />
              </label>
            </div>

            {/* Explicação contextual de cada modo */}
            {mode === "CHECKING" ? (
              <div className="p-3.5 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-[11px] text-slate-400 space-y-1">
                <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Fluxo de Conciliação Bancária (.OFX):</span>
                </div>
                <p>
                  • Abre a <strong>Mesa de Conciliação</strong> para bater o extrato com seus{" "}
                  <strong>lançamentos previstos e fixos</strong> (IPTU, Luz, Aluguel, Salário).
                </p>
                <p>• Efetiva as previsões existentes sem duplicar lançamentos e simula o saldo final da conta.</p>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-[11px] text-slate-400 space-y-1">
                <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Fluxo de Importação de Fatura (.CSV / .XLS):</span>
                </div>
                <p>
                  • Importa as compras da fatura diretamente em <strong>1 clique</strong> com{" "}
                  <strong>auto-categorização inteligente</strong>.
                </p>
                <p>
                  • Ajusta automaticamente a <strong>competência da fatura</strong> e ignora compras que já foram
                  importadas antes.
                </p>
              </div>
            )}

            {/* Resultado imediato quando está na aba de Cartão de Crédito */}
            {mode === "CREDIT_CARD" && cardResult && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 space-y-2">
                <div className="flex items-center justify-between font-bold text-emerald-400">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Fatura Importada com Sucesso!</span>
                  </div>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400/80 hover:text-emerald-300 transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Importar outra</span>
                  </button>
                </div>
                <p>• {cardResult.inserted} lançamentos da fatura inseridos e categorizados.</p>
                {cardResult.skipped > 0 && (
                  <p>• {cardResult.skipped} lançamentos já existentes na fatura foram ignorados.</p>
                )}
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="pt-1 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                Fechar
              </button>

              {mode === "CHECKING" ? (
                <button
                  type="button"
                  onClick={handlePreviewReconciliation}
                  disabled={loading || !file}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? "Analisando Extrato..." : "Abrir Mesa de Conciliação"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCardDirectImport}
                  disabled={loading || !file}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? "Importando Fatura..." : "Importar Fatura Agora"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ETAPA 2: MESA DE REVISÃO E CONCILIAÇÃO (CONTA CORRENTE) */}
        {step === "REVIEW" && previewData && (
          <>
            <div className="px-5 py-3.5 bg-slate-950/60 border-b border-slate-800 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setFilterTab("ALL")}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    filterTab === "ALL"
                      ? "bg-slate-800/90 border-slate-600 text-slate-100"
                      : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-slate-400">Total no Extrato</div>
                  <div className="text-base font-bold text-slate-100">{rows.length} linhas</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTab("RECONCILE")}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    filterTab === "RECONCILE"
                      ? "bg-cyan-500/15 border-cyan-500/50 text-cyan-200"
                      : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-cyan-400 flex items-center gap-1">
                    <Link2 className="h-3 w-3" />
                    <span>Conciliados (Match)</span>
                  </div>
                  <div className="text-base font-bold text-cyan-300">{stats.reconcileCount}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTab("CREATE")}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    filterTab === "CREATE"
                      ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                      : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
                    <PlusCircle className="h-3 w-3" />
                    <span>Criar Novos</span>
                  </div>
                  <div className="text-base font-bold text-emerald-300">{stats.createCount}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTab("IGNORE")}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    filterTab === "IGNORE"
                      ? "bg-amber-500/15 border-amber-500/50 text-amber-200"
                      : "bg-amber-500/5 border-amber-500/20 text-slate-300 hover:bg-amber-500/10"
                  }`}
                >
                  <div className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Já Importados / Ignorados</span>
                  </div>
                  <div className="text-base font-bold text-amber-300">{stats.ignoreCount}</div>
                </button>
              </div>

              {/* Simulador de Saldo da Conta */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <span className="text-slate-400">Saldo Atual no 10mangos: </span>
                    <span className="font-bold text-slate-200">
                      {formatCurrency(stats.currentBalance, accountCurrency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Impacto Líquido: </span>
                    <span
                      className={`font-bold ${
                        stats.balanceDelta > 0
                          ? "text-emerald-400"
                          : stats.balanceDelta < 0
                          ? "text-rose-400"
                          : "text-slate-300"
                      }`}
                    >
                      {stats.balanceDelta >= 0 ? "+" : ""}
                      {formatCurrency(stats.balanceDelta, accountCurrency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Saldo Pós-Conciliação: </span>
                    <span className="font-bold text-emerald-400">
                      {formatCurrency(stats.simulatedBalance, accountCurrency)}
                    </span>
                  </div>
                </div>

                {previewData.ledgerBalance !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Saldo OFX do Banco:</span>
                    <span className="font-bold text-slate-200">
                      {formatCurrency(previewData.ledgerBalance, accountCurrency)}
                    </span>
                    {Math.abs(stats.simulatedBalance - previewData.ledgerBalance) < 0.01 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <ShieldCheck className="h-3 w-3" />
                        Bateu 100%
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Lista de Linhas para Conciliação */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70 px-5 py-2">
              {filteredRows.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  Nenhuma linha do extrato nesta categoria de filtro.
                </div>
              ) : (
                filteredRows.map((row) => {
                  const linkedTx = row.selectedTransactionId
                    ? candidatesMap.get(row.selectedTransactionId)
                    : null;

                  const compatibleCandidates = previewData.availableCandidates.filter(
                    (c) => (row.amount < 0 && c.amount < 0) || (row.amount >= 0 && c.amount >= 0)
                  );

                  return (
                    <div
                      key={row.tempId}
                      className={`py-3 px-3 my-1 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                        row.matchStatus === "DUPLICATE"
                          ? "bg-amber-500/[0.06] border border-amber-500/25 border-l-4 border-l-amber-400"
                          : row.action === "RECONCILE"
                          ? "bg-cyan-500/[0.04] border border-cyan-500/15 border-l-4 border-l-cyan-400"
                          : row.action === "CREATE"
                          ? "bg-emerald-500/[0.03] border border-emerald-500/15 border-l-4 border-l-emerald-400"
                          : "opacity-60 bg-slate-950/30"
                      }`}
                    >
                      {/* Coluna 1: Linha do Extrato (Banco) */}
                      <div className="lg:w-[36%] min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-mono text-slate-300 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                            {formatDate(row.date)}
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              row.amount >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {row.amount >= 0 ? "+" : ""}
                            {formatCurrency(row.amount, accountCurrency)}
                          </span>
                          {row.matchStatus === "MATCH" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              <Link2 className="h-2.5 w-2.5" />
                              Match {row.matchScore}%
                            </span>
                          )}
                          {row.matchStatus === "DUPLICATE" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-sm">
                              <CheckCircle2 className="h-3 w-3 text-amber-400" />
                              JÁ IMPORTADO
                            </span>
                          )}
                          {row.matchStatus === "NEW" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Novo
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-slate-100 truncate" title={row.originalDescription}>
                          {row.originalDescription}
                        </div>
                        {row.matchReason && (
                          <div
                            className={`text-[11px] truncate ${
                              row.matchStatus === "DUPLICATE" ? "text-amber-300/90 font-medium" : "text-slate-400"
                            }`}
                            title={row.matchReason}
                          >
                            {row.matchReason}
                          </div>
                        )}
                      </div>

                      {/* Coluna 2: Seletor de Ação */}
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 self-start lg:self-center flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => updateRow(row.tempId, { action: "RECONCILE" })}
                          disabled={compatibleCandidates.length === 0 && !row.matchedTransaction}
                          title={
                            compatibleCandidates.length === 0
                              ? "Nenhum lançamento existente de mesmo sinal no período para vincular"
                              : "Conciliar com lançamento já existente no 10mangos (evita duplicar)"
                          }
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all disabled:opacity-30 ${
                            row.action === "RECONCILE"
                              ? "bg-cyan-500 text-slate-950 shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <Link2 className="h-3 w-3" />
                          <span>Conciliar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => updateRow(row.tempId, { action: "CREATE" })}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all ${
                            row.action === "CREATE"
                              ? "bg-emerald-500 text-slate-950 shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <PlusCircle className="h-3 w-3" />
                          <span>Criar Novo</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => updateRow(row.tempId, { action: "IGNORE" })}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all ${
                            row.action === "IGNORE"
                              ? "bg-slate-700 text-slate-100 shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <Ban className="h-3 w-3" />
                          <span>Ignorar</span>
                        </button>
                      </div>

                      {/* Coluna 3: Destino / Configuração no 10mangos */}
                      <div className="lg:w-[40%] min-w-0">
                        {row.action === "RECONCILE" && (
                          <div className="p-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/20 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                                Vincular ao lançamento existente:
                              </span>
                              {linkedTx && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    linkedTx.status === "PENDING"
                                      ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                      : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  }`}
                                >
                                  {linkedTx.status === "PENDING" ? "Previsto → Efetivar" : "Já Efetivado (Não duplica)"}
                                </span>
                              )}
                            </div>

                            <select
                              value={row.selectedTransactionId || ""}
                              onChange={(e) =>
                                updateRow(row.tempId, { selectedTransactionId: e.target.value || null })
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                            >
                              {compatibleCandidates.map((cand) => (
                                <option key={cand.id} value={cand.id}>
                                  {formatDate(cand.date)} • {cand.description} (
                                  {formatCurrency(cand.amount, accountCurrency)}){" "}
                                  {cand.status === "PENDING" ? "[Previsto]" : "[Efetivado]"}
                                </option>
                              ))}
                            </select>

                            {linkedTx && (
                              <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none pt-0.5">
                                <input
                                  type="checkbox"
                                  checked={row.keepExistingDescription}
                                  onChange={(e) =>
                                    updateRow(row.tempId, { keepExistingDescription: e.target.checked })
                                  }
                                  className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
                                />
                                <span className="truncate">
                                  Manter nome <strong>&ldquo;{linkedTx.description}&rdquo;</strong>
                                  {linkedTx.categoryName ? ` (${linkedTx.categoryName})` : ""}
                                </span>
                              </label>
                            )}
                          </div>
                        )}

                        {row.action === "CREATE" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={row.customDescription}
                              onChange={(e) => updateRow(row.tempId, { customDescription: e.target.value })}
                              placeholder="Descrição do lançamento"
                              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                            />

                            {row.type === "TRANSFER" ? (
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400">
                                <ArrowRightLeft className="h-3 w-3 text-slate-400 flex-shrink-0" />
                                <span className="truncate">Movimentação / Transferência</span>
                              </div>
                            ) : (
                              <select
                                value={row.selectedCategoryId || ""}
                                onChange={(e) =>
                                  updateRow(row.tempId, { selectedCategoryId: e.target.value || null })
                                }
                                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                              >
                                <option value="">Sem categoria</option>
                                {flatCategories.map((cat) => (
                                  <option key={cat.id} value={cat.id}>
                                    {cat.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        {row.action === "IGNORE" && (
                          row.matchStatus === "DUPLICATE" && row.matchedTransaction ? (
                            <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 space-y-0.5">
                              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                                <span className="truncate">
                                  Já consta na conta: &ldquo;{row.matchedTransaction.description}&rdquo;
                                </span>
                              </div>
                              <div className="text-[10px] text-amber-300/80">
                                Ignorado automaticamente para evitar duplicidade
                                {row.matchedTransaction.categoryName
                                  ? ` • Categoria: ${row.matchedTransaction.categoryName}`
                                  : ""}
                              </div>
                            </div>
                          ) : (
                            <div className="px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800/60 text-[11px] text-slate-500">
                              Linha ignorada — não criará nem alterará lançamentos.
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {error && (
              <div className="mx-5 my-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Rodapé da Mesa de Conciliação */}
            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900/95 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep("UPLOAD")}
                disabled={confirming}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Voltar</span>
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 hidden sm:inline">
                  <strong className="text-cyan-400">{stats.reconcileCount}</strong> conciliar •{" "}
                  <strong className="text-emerald-400">{stats.createCount}</strong> criar •{" "}
                  <strong className="text-slate-300">{stats.ignoreCount}</strong> ignorar
                </span>

                <button
                  type="button"
                  onClick={handleConfirmReconciliation}
                  disabled={confirming}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center gap-2"
                >
                  <Check className="h-4 w-4" />
                  <span>{confirming ? "Aplicando Conciliação..." : "Confirmar Conciliação"}</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* ETAPA 3: RESULTADO FINAL DA CONCILIAÇÃO DE CONTA CORRENTE */}
        {step === "DONE" && reconcileResult && (
          <div className="p-6 space-y-5">
            <div className="p-5 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 space-y-3">
              <div className="flex items-center gap-2.5 text-cyan-400 font-bold text-sm">
                <CheckCircle2 className="h-5 w-5" />
                <span>Conciliação Bancária Aplicada com Sucesso!</span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-200">
                <p className="flex items-center justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">🔗 Conciliados com previstos/manuais (sem duplicar):</span>
                  <strong className="text-cyan-300">{reconcileResult.reconciled}</strong>
                </p>
                <p className="flex items-center justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">➕ Novos lançamentos criados:</span>
                  <strong className="text-emerald-300">{reconcileResult.created}</strong>
                </p>
                <p className="flex items-center justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">🚫 Duplicados / ignorados:</span>
                  <strong className="text-slate-300">{reconcileResult.ignored}</strong>
                </p>
                {reconcileResult.newBalance !== null && reconcileResult.newBalance !== undefined && (
                  <p className="flex items-center justify-between pt-2 text-sm">
                    <span className="font-semibold text-slate-300">💰 Saldo Atualizado da Conta:</span>
                    <strong className="text-emerald-400">
                      {formatCurrency(reconcileResult.newBalance, reconcileResult.accountCurrency || "BRL")}
                    </strong>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Conciliar Outro Extrato</span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all"
              >
                Concluir e Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
