"use client";

import React, { useState, useRef, useEffect } from "react";
import { X, Calendar as CalendarIcon, Tag, CreditCard, DollarSign, ArrowRight, Layers, Repeat } from "lucide-react";
import { CategoryCombobox } from "./CategoryCombobox";

export interface InitialTransactionData {
  type?: "EXPENSE" | "INCOME" | "TRANSFER";
  amount?: string;
  description?: string;
  fromAccountId?: string;
  toAccountId?: string;
  status?: "CLEARED" | "PENDING";
  date?: string;
}

interface NewTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Array<{ id: string; name: string; type: string }>;
  categories: Array<{ id: string; name: string; type: string; children?: Array<{ id: string; name: string }> }>;
  defaultDate?: string;
  initialData?: InitialTransactionData | null;
  onSuccess?: () => void;
}

export function NewTransactionModal({
  isOpen,
  onClose,
  accounts,
  categories,
  defaultDate,
  initialData,
  onSuccess,
}: NewTransactionModalProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<"EXPENSE" | "INCOME" | "TRANSFER">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split("T")[0]);
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id || "");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"CLEARED" | "PENDING">("CLEARED");
  const [repeatType, setRepeatType] = useState<"SINGLE" | "RECURRING" | "INSTALLMENTS">("SINGLE");
  const [recurringMonths, setRecurringMonths] = useState(12);
  const [installments, setInstallments] = useState(1);
  const [loading, setLoading] = useState(false);

  function resetForm() {
    if (initialData) {
      setType(initialData.type || "EXPENSE");
      setAmount(initialData.amount || "");
      setDescription(initialData.description || "");
      setCategoryId("");
      setRepeatType("SINGLE");
      setRecurringMonths(12);
      setInstallments(1);
      setStatus(initialData.status || "CLEARED");
      setDate(initialData.date || defaultDate || new Date().toISOString().split("T")[0]);
      if (initialData.fromAccountId) setAccountId(initialData.fromAccountId);
      else if (accounts[0]?.id) setAccountId(accounts[0].id);

      if (initialData.toAccountId) setToAccountId(initialData.toAccountId);
      else if (accounts[1]?.id) setToAccountId(accounts[1].id);
      return;
    }

    setType("EXPENSE");
    setAmount("");
    setDescription("");
    setCategoryId("");
    setRepeatType("SINGLE");
    setRecurringMonths(12);
    setInstallments(1);
    setStatus("CLEARED");
    setDate(defaultDate || new Date().toISOString().split("T")[0]);
    if (accounts[0]?.id) setAccountId(accounts[0].id);
    if (accounts[1]?.id) setToAccountId(accounts[1].id);
  }

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, initialData]);

  function handleAmountBlur() {
    if (!amount.trim()) return;
    const clean = amount.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(clean);
    if (!isNaN(num) && num > 0) {
      setAmount(num.toFixed(2).replace(".", ","));
    }
  }

  if (!isOpen) return null;

  const filteredCategories = categories.filter((c) => c.type === type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const parsedAmount = parseFloat(amount.replace(/\./g, "").replace(",", "."));
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        alert("Informe um valor válido");
        setLoading(false);
        return;
      }

      const token = localStorage.getItem("token");
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      if (type === "TRANSFER") {
        const res = await fetch("http://localhost:3333/api/transfers", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            fromAccountId: accountId,
            toAccountId,
            amount: parsedAmount,
            date,
            description: description || undefined,
            isPending: status === "PENDING",
            kind: accounts.find((a) => a.id === toAccountId)?.type === "CREDIT_CARD" ? "INVOICE_PAYMENT" : "TRANSFER",
          }),
        });
        if (!res.ok) throw new Error("Erro ao realizar transferência");
      } else {
        const isRecurring = repeatType === "RECURRING";
        const finalInstallments = repeatType === "INSTALLMENTS" ? Number(installments) : 1;

        const res = await fetch("http://localhost:3333/api/transactions", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            accountId,
            type,
            amount: parsedAmount,
            date,
            description,
            categoryId: categoryId || undefined,
            status,
            installments: finalInstallments,
            isRecurring,
            recurringMonths: isRecurring ? Number(recurringMonths) : undefined,
          }),
        });
        if (!res.ok) throw new Error("Erro ao criar lançamento");
      }

      resetForm();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      alert(err.message || "Erro ao salvar lançamento");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            Novo Lançamento
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3">
          {/* Seletor de Tipo */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setType("EXPENSE")}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                type === "EXPENSE"
                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType("INCOME")}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                type === "INCOME"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Receita
            </button>
            <button
              type="button"
              onClick={() => setType("TRANSFER")}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                type === "TRANSFER"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Transferência
            </button>
          </div>

          {/* Descrição & Valor na mesma linha */}
          <div className="grid grid-cols-12 gap-2.5">
            <div className="col-span-7 space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Descrição</label>
              <input
                type="text"
                required
                placeholder="Ex: Supermercado, Aluguel..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div className="col-span-5 space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Valor</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">R$</span>
                <input
                  type="text"
                  required
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={handleAmountBlur}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm font-bold text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Contas */}
          {type === "TRANSFER" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Conta de Origem</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Conta de Destino</label>
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Conta / Cartão</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Categoria</label>
                <CategoryCombobox
                  categories={filteredCategories}
                  selectedId={categoryId}
                  onSelect={(id) => setCategoryId(id)}
                  placeholder="Buscar categoria..."
                />
              </div>
            </div>
          )}

          {/* Data e Situação */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <CalendarIcon className="h-3 w-3 text-emerald-400" />
                Data
              </label>
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
                  <span className="text-xs font-semibold text-slate-300">Frequência</span>
                </div>
                <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setRepeatType("SINGLE")}
                    className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
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
                    className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
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
                      className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
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
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Projetar para os próximos meses como <strong className="text-amber-400 font-semibold">Previsto</strong>:
                  </span>
                  <select
                    value={recurringMonths}
                    onChange={(e) => setRecurringMonths(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value={6}>6 meses</option>
                    <option value={12}>12 meses (1 ano)</option>
                    <option value={24}>24 meses (2 anos)</option>
                  </select>
                </div>
              )}

              {repeatType === "INSTALLMENTS" && (
                <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">Dividir o valor total em:</span>
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
              )}
            </div>
          )}

          {/* Botões de Ação */}
          <div className="pt-1 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Salvando..." : "Salvar Lançamento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
