"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Trash2, Calendar as CalendarIcon, Tag, CreditCard, DollarSign, CheckCircle2, Clock, Copy, ArrowRightLeft, Repeat, Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { CategoryCombobox } from "./CategoryCombobox";
import { computeShiftedDate } from "@/lib/utils";

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: any;
  categories: Array<{ id: string; name: string; type: string; children?: Array<{ id: string; name: string }> }>;
  accounts?: Array<{ id: string; name: string; type: string }>;
  onSuccess?: () => void;
}

export function EditTransactionModal({
  isOpen,
  onClose,
  transaction,
  categories,
  accounts = [],
  onSuccess,
}: EditTransactionModalProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"EXPENSE" | "INCOME" | "TRANSFER">("EXPENSE");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"CLEARED" | "PENDING">("CLEARED");
  const [date, setDate] = useState("");
  const [competenceDate, setCompetenceDate] = useState("");
  const [repeatType, setRepeatType] = useState<"SINGLE" | "RECURRING" | "INSTALLMENTS">("SINGLE");
  const [recurringMonths, setRecurringMonths] = useState(12);
  const [installments, setInstallments] = useState(1);
  const [createRule, setCreateRule] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (transaction) {
      setDescription(transaction.description || "");
      const val = Math.abs(Number(transaction.amount || 0));
      setAmount(val.toFixed(2).replace(".", ","));
      setCategoryId(transaction.categoryId || "");
      setStatus(transaction.status || "CLEARED");
      setToAccountId("");
      if (transaction.type === "TRANSFER") {
        setType("TRANSFER");
      } else {
        setType(Number(transaction.amount) >= 0 ? "INCOME" : "EXPENSE");
      }
      const d = transaction.date ? new Date(transaction.date).toISOString().split("T")[0] : "";
      setDate(d);
      const compD = transaction.competenceDate ? new Date(transaction.competenceDate).toISOString().split("T")[0] : "";
      setCompetenceDate(compD);

      if (transaction.recurringRuleId || transaction.source === "RECURRING") {
        setRepeatType("RECURRING");
      } else if (transaction.installmentPlanId || transaction.source === "INSTALLMENT") {
        setRepeatType("INSTALLMENTS");
        setInstallments(transaction.installmentNumber || 2);
      } else {
        setRepeatType("SINGLE");
        setInstallments(1);
      }
      setRecurringMonths(12);
    }
  }, [transaction]);

  function handleAmountBlur() {
    if (!amount.trim()) return;
    const clean = amount.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(clean);
    if (!isNaN(num) && num >= 0) {
      setAmount(num.toFixed(2).replace(".", ","));
    }
  }

  function handleShiftMonth(delta: -1 | 1) {
    // Altera a fatura de competência, preservando a data histórica da compra!
    const baseDate = competenceDate || date;
    if (!baseDate) return;
    const newCompDate = computeShiftedDate(baseDate, delta);
    setCompetenceDate(newCompDate);
  }

  if (!isOpen || !transaction) return null;

  const filteredCategories = categories.filter((c) => c.type === type);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const parsedAmount = parseFloat(amount.replace(/\./g, "").replace(",", "."));
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        alert("Informe um valor válido");
        setLoading(false);
        return;
      }

      if (type === "TRANSFER" && !toAccountId) {
        alert("Por favor, selecione a conta de destino para a transferência.");
        setLoading(false);
        return;
      }

      const token = localStorage.getItem("token");

      const isRecurring = repeatType === "RECURRING";
      const finalInstallments = repeatType === "INSTALLMENTS" ? Number(installments) : 1;

      const res = await fetch(`http://localhost:3333/api/transactions/${transaction.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          description,
          amount: parsedAmount,
          type,
          toAccountId: type === "TRANSFER" ? toAccountId : undefined,
          categoryId: type !== "TRANSFER" ? (categoryId || null) : null,
          status,
          date: date ? `${date.split("T")[0]}T12:00:00Z` : undefined,
          competenceDate: competenceDate ? `${competenceDate.split("T")[0]}T12:00:00Z` : undefined,
          isRecurring,
          recurringMonths: isRecurring ? Number(recurringMonths) : undefined,
          installments: finalInstallments > 1 ? finalInstallments : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Erro ao atualizar lançamento");
      }

      // Se marcou para lembrar da regra, cria no servidor
      if (createRule && categoryId && type !== "TRANSFER") {
        const cleanPattern = description
          .replace(/\s*-\s*Parcela\s*\d+\/\d+/i, "")
          .replace(/\s*\(\d+\/\d+\)/g, "")
          .trim();

        if (cleanPattern.length >= 3) {
          fetch("http://localhost:3333/api/categories/rules", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              name: `Regra: ${cleanPattern}`,
              pattern: cleanPattern,
              matchType: "CONTAINS",
              categoryId,
            }),
          }).catch((e) => console.error("Erro ao criar regra:", e));
        }
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      alert(err.message || "Falha na atualização");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Tem certeza que deseja excluir este lançamento?")) return;
    setDeleting(true);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`http://localhost:3333/api/transactions/${transaction.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao excluir lançamento");
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      alert(err.message || "Falha na exclusão");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDuplicate() {
    setCopying(true);

    try {
      const parsedAmount = parseFloat(amount.replace(/\./g, "").replace(",", "."));
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        alert("Informe um valor válido");
        setCopying(false);
        return;
      }

      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:3333/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          accountId: transaction.accountId,
          type: transaction.type,
          amount: parsedAmount,
          date: date || new Date().toISOString().split("T")[0],
          description: `${description} (Cópia)`,
          categoryId: categoryId || undefined,
          status,
          installments: 1,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Erro ao duplicar lançamento");
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      alert(err.message || "Falha ao duplicar");
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            Editar Lançamento
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleUpdate} className="p-4 sm:p-5 space-y-3">
          {/* Seletor Tipo: Despesa, Receita ou Transferência */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setType("EXPENSE");
                setCategoryId("");
                setToAccountId("");
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                type === "EXPENSE"
                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => {
                setType("INCOME");
                setCategoryId("");
                setToAccountId("");
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                type === "INCOME"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Receita
            </button>
            <button
              type="button"
              onClick={() => {
                setType("TRANSFER");
                setCategoryId("");
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                type === "TRANSFER"
                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Transferência
            </button>
          </div>

          {/* Descrição e Valor em linha única */}
          <div className="grid grid-cols-12 gap-2.5">
            <div className="col-span-7 space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Descrição</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Supermercado..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="col-span-5 space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Valor</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">R$</span>
                <input
                  type="text"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={handleAmountBlur}
                  placeholder="0,00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm font-bold text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Categoria OU Conta de Transferência */}
          {type === "TRANSFER" ? (
            <div className="space-y-1 p-2.5 rounded-xl bg-sky-950/20 border border-sky-800/40">
              <label className="text-[11px] font-semibold text-sky-300 flex items-center gap-1.5">
                <ArrowRightLeft className="h-3 w-3 text-sky-400" />
                Conta Vinculada da Transferência
              </label>
              <select
                required
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              >
                <option value="">Selecione a outra conta envolvida...</option>
                {accounts
                  ?.filter((a) => a.id !== transaction.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.type})
                    </option>
                  ))}
              </select>
              <p className="text-[10px] text-slate-400">
                💡 O 10mangos criará automaticamente o lançamento de contrapartida na conta selecionada.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Categoria</label>
              <CategoryCombobox
                categories={filteredCategories}
                selectedId={categoryId}
                onSelect={(id) => setCategoryId(id)}
                placeholder="Digite para buscar categoria/subcategoria (ex: cond, pam)..."
              />
              {categoryId && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 mt-1.5">
                  <input
                    type="checkbox"
                    id="createRuleCheck"
                    checked={createRule}
                    onChange={(e) => setCreateRule(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500/20"
                  />
                  <label htmlFor="createRuleCheck" className="cursor-pointer select-none">
                    Lembrar desta escolha para lançamentos semelhantes{" "}
                    <span className="text-emerald-400 font-medium">
                      ("{description.replace(/\s*-\s*Parcela\s*\d+\/\d+/i, "").replace(/\s*\(\d+\/\d+\)/g, "").trim()}")
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Data e Situação */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <CalendarIcon className="h-3 w-3 text-emerald-400" />
                  Data
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleShiftMonth(-1)}
                    title="Mover data para o mês anterior"
                    className="text-[10px] px-1 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-amber-400 text-slate-400 font-semibold transition-colors flex items-center gap-0.5"
                  >
                    <ChevronLeft className="h-2.5 w-2.5" /> Mês
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShiftMonth(1)}
                    title="Mover data para o mês seguinte (ex: fatura seguinte)"
                    className="text-[10px] px-1 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-emerald-400 text-slate-400 font-semibold transition-colors flex items-center gap-0.5"
                  >
                    Mês <ChevronRight className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
              <div
                onClick={() => dateInputRef.current?.showPicker?.()}
                className="relative flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 hover:border-slate-700 cursor-pointer transition-colors"
              >
                <input
                  ref={dateInputRef}
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-transparent text-xs text-slate-100 focus:outline-none cursor-pointer"
                />
              </div>
              {competenceDate && competenceDate.split("-")[1] !== (date ? date.split("-")[1] : "") && (
                <div className="flex items-center justify-between text-[10px] text-amber-300/90 pt-0.5">
                  <span>Fatura de Referência:</span>
                  <span className="font-bold">Mês {competenceDate.split("-")[1]}/{competenceDate.split("-")[0]}</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Situação</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="CLEARED">Pago / Efetivado</option>
                <option value="PENDING">Previsto / Agendado</option>
              </select>
            </div>
          </div>

          {/* Frequência: Único / Fixo (Mensal) / Parcelado */}
          {type !== "TRANSFER" && (
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Repeat className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-[11px] font-semibold text-slate-300">Frequência</span>
                </div>
                <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setRepeatType("SINGLE")}
                    className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                      repeatType === "SINGLE"
                        ? "bg-slate-800 text-slate-100 shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Único
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepeatType("RECURRING")}
                    className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                      repeatType === "RECURRING"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Fixo / Mensal
                  </button>
                  {type === "EXPENSE" && (
                    <button
                      type="button"
                      onClick={() => setRepeatType("INSTALLMENTS")}
                      className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                        repeatType === "INSTALLMENTS"
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Parcelado
                    </button>
                  )}
                </div>
              </div>

              {repeatType === "RECURRING" && (
                <div className="pt-2 border-t border-slate-800/60 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">
                      Projetar para os próximos meses como <strong className="text-amber-400 font-semibold">Previsto</strong>:
                    </span>
                    <select
                      value={recurringMonths}
                      onChange={(e) => setRecurringMonths(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none"
                    >
                      <option value={6}>6 meses</option>
                      <option value={12}>12 meses (1 ano)</option>
                      <option value={24}>24 meses (2 anos)</option>
                    </select>
                  </div>
                  {transaction.recurringRuleId && (
                    <p className="text-[11px] text-emerald-400/80">
                      ✓ Este lançamento já está vinculado a uma regra mensal.
                    </p>
                  )}
                </div>
              )}

              {repeatType === "INSTALLMENTS" && (
                <div className="pt-2 border-t border-slate-800/60 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-400 text-[11px]">Dividir o valor total em:</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={installments}
                        onChange={(e) => setInstallments(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none"
                      >
                        <option value={2}>2x</option>
                        <option value={3}>3x</option>
                        <option value={4}>4x</option>
                        <option value={5}>5x</option>
                        <option value={6}>6x</option>
                        <option value={7}>7x</option>
                        <option value={8}>8x</option>
                        <option value={9}>9x</option>
                        <option value={10}>10x</option>
                        <option value={11}>11x</option>
                        <option value={12}>12x</option>
                        <option value={18}>18x</option>
                        <option value={24}>24x</option>
                        <option value={36}>36x</option>
                      </select>
                      {(() => {
                        const num = parseFloat(amount.replace(/\./g, "").replace(",", "."));
                        if (!isNaN(num) && num > 0) {
                          return (
                            <span className="text-[11px] font-semibold text-indigo-300 bg-indigo-500/15 px-2 py-0.5 rounded border border-indigo-500/30">
                              {installments}x de R$ {(num / installments).toFixed(2).replace(".", ",")}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  {transaction.installmentPlanId && (
                    <p className="text-[11px] text-indigo-300/80">
                      ✓ Parcela atual: {transaction.installmentNumber || 1}.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Botões de Ação */}
          <div className="pt-2.5 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{deleting ? "Excluindo..." : "Excluir"}</span>
              </button>
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={copying}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-sky-400 hover:bg-sky-500/10 transition-colors disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{copying ? "Copiando..." : "Copiar"}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
