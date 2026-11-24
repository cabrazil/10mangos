"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Wallet,
  CreditCard,
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Calendar,
  Building,
  Search,
  Home,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Copy,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Layers,
  Filter,
  X,
  Landmark,
  Zap,
  ArrowRightLeft,
} from "lucide-react";
import { formatCurrency, formatDate, computeShiftedDate, isFinancialMovement } from "@/lib/utils";
import { NewTransactionModal } from "@/components/NewTransactionModal";
import { EditTransactionModal } from "@/components/EditTransactionModal";
import { ImportModal } from "@/components/ImportModal";

const API_BASE = "http://localhost:3333/api";

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [isNewTxOpen, setIsNewTxOpen] = useState(false);
  const [newTxInitialData, setNewTxInitialData] = useState<any | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isAutoCategorizing, setIsAutoCategorizing] = useState(false);
  const [selectedTxForEdit, setSelectedTxForEdit] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [summary, setSummary] = useState({
    totalChecking: 0,
    totalInvestments: 0,
    totalCreditCardDebt: 0,
    netWorth: 0,
  });

  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleCurrentMonth = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const monthName = currentDate.toLocaleDateString("pt-BR", { month: "long" });
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const now = new Date();
  const isCurrentMonth =
    currentDate.getFullYear() === now.getFullYear() &&
    currentDate.getMonth() === now.getMonth();

  const defaultDateForNewTx = (() => {
    if (isCurrentMonth) {
      return now.toISOString().split("T")[0];
    }
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  })();

  // Autenticação e Carga Inicial
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        let token = localStorage.getItem("token");

        // Se não tiver token, fazer login automático com Carlos Brazil
        if (!token) {
          const authRes = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "carlos@10mangos.local",
              password: "admin123",
            }),
          });
          if (authRes.ok) {
            const authData = await authRes.json();
            token = authData.token;
            localStorage.setItem("token", token!);
          }
        }

        if (token) {
          await loadData(token, currentDate);
        }
      } catch (err) {
        console.error("Erro na inicialização:", err);
      } finally {
        setLoading(false);
      }
    }

    init();
    setMounted(true);
  }, []);

  // Recarregar dados ao mudar o mês
  useEffect(() => {
    if (mounted) {
      const token = localStorage.getItem("token");
      if (token) {
        loadData(token, currentDate);
      }
    }
  }, [currentDate, mounted]);

  async function loadData(token: string, targetDate: Date = currentDate) {
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;

    try {
      // 1. Carregar Contas
      const accRes = await fetch(`${API_BASE}/accounts`, { headers: authHeaders });
      if (accRes.ok) {
        const accData = await accRes.json();
        setAccounts(accData.accounts || []);
        if (accData.summary) {
          setSummary(accData.summary);
        }
      }

      // 2. Carregar Categorias
      const catRes = await fetch(`${API_BASE}/categories`, { headers: authHeaders });
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData || []);
      }

      // 3. Carregar Transações filtradas pelo mês selecionado
      const txRes = await fetch(
        `${API_BASE}/transactions?startDate=${startDate}&endDate=${endDate}&limit=200`,
        { headers: authHeaders }
      );
      if (txRes.ok) {
        const txData = await txRes.json();
        setTransactions(txData.data || []);
      }
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
    }
  }

  async function handleDuplicateDirectly(e: React.MouseEvent, tx: any) {
    e.stopPropagation();
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountId: tx.accountId,
          type: tx.type,
          amount: Math.abs(Number(tx.amount)),
          date: tx.date ? new Date(tx.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
          description: `${tx.description} (Cópia)`,
          categoryId: tx.categoryId || undefined,
          status: tx.status,
          installments: 1,
        }),
      });

      if (res.ok) {
        await loadData(token, currentDate);
      } else {
        alert("Erro ao copiar lançamento");
      }
    } catch (err) {
      alert("Falha ao copiar lançamento");
    }
  }

  async function handleQuickShiftMonth(e: React.MouseEvent, tx: any, delta: -1 | 1) {
    e.stopPropagation();
    const token = localStorage.getItem("token");
    if (!token) return;

    // Se tiver competenceDate, usa competenceDate como referência; senão, usa a data da compra
    const currentRefDate = tx.competenceDate
      ? (typeof tx.competenceDate === "string" ? tx.competenceDate.split("T")[0] : new Date(tx.competenceDate).toISOString().split("T")[0])
      : (tx.date ? (typeof tx.date === "string" ? tx.date.split("T")[0] : new Date(tx.date).toISOString().split("T")[0]) : new Date().toISOString().split("T")[0]);

    const targetMonthStr = computeShiftedDate(currentRefDate, delta);

    try {
      const res = await fetch(`${API_BASE}/transactions/${tx.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          description: tx.description,
          amount: Math.abs(Number(tx.amount)),
          type: tx.type,
          categoryId: tx.categoryId || undefined,
          status: tx.status,
          competenceDate: `${targetMonthStr}T12:00:00Z`,
        }),
      });

      if (res.ok) {
        await loadData(token, currentDate);
      } else {
        alert("Erro ao mover lançamento de mês");
      }
    } catch (err) {
      alert("Falha ao comunicar com o servidor");
    }
  }

  async function handleAutoCategorize() {
    const token = localStorage.getItem("token");
    if (!token) return;

    setIsAutoCategorizing(true);
    try {
      const res = await fetch(`${API_BASE}/categories/auto-categorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error("Erro ao executar auto-categorização");
      }

      const data = await res.json();
      if (data.updatedCount > 0) {
        alert(`⚡ Sucesso! ${data.updatedCount} ${data.updatedCount === 1 ? "lançamento foi categorizado" : "lançamentos foram categorizados"} automaticamente.`);
        await loadData(token, currentDate);
      } else {
        alert("Nenhum lançamento pendente de categorização compatível com as regras ou dicionário foi encontrado.");
      }
    } catch (err: any) {
      alert(err.message || "Erro na auto-categorização");
    } finally {
      setIsAutoCategorizing(false);
    }
  }

  // Separar cartões de contas
  const bankAccounts = accounts.filter((a) => a.type !== "CREDIT_CARD");
  const creditCards = accounts.filter((a) => a.type === "CREDIT_CARD");

  function handleOpenNewTx() {
    setNewTxInitialData(null);
    setIsNewTxOpen(true);
  }

  function handlePayInvoice(card: any) {
    const defaultChecking = card.paymentAccountId || bankAccounts[0]?.id || accounts[0]?.id || "";
    const monthlyCardExpense = monthlyTransactions
      .filter((t) => t.accountId === card.id && t.type === "EXPENSE")
      .reduce((acc, curr) => acc + Math.abs(Number(curr.amount)), 0);
    const balance = monthlyCardExpense > 0 ? monthlyCardExpense : Math.abs(Number(card.currentBalance || 0));

    setNewTxInitialData({
      type: "TRANSFER",
      amount: balance > 0 ? balance.toFixed(2).replace(".", ",") : "",
      description: `Pagamento Fatura - ${card.name}`,
      fromAccountId: defaultChecking,
      toAccountId: card.id,
      status: "CLEARED",
      date: new Date().toISOString().split("T")[0],
    });
    setIsNewTxOpen(true);
  }

  // Filtro resiliente para garantir exibição estrita do mês selecionado
  // Se a transação possui competenceDate (ex: alocada a uma fatura específica), usamos competenceDate; senão, usamos date
  const isTxInSelectedMonth = (tx: any) => {
    if (!tx) return false;
    try {
      const refDate = tx.competenceDate || tx.date;
      if (!refDate) return false;
      let dStr = "";
      if (typeof refDate === "string") {
        dStr = refDate.split("T")[0];
      } else if (refDate instanceof Date && !isNaN(refDate.getTime())) {
        dStr = refDate.toISOString().split("T")[0];
      } else {
        dStr = String(refDate).split("T")[0];
      }
      const parts = dStr.split("-");
      if (parts.length < 2) return false;
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      return y === currentDate.getFullYear() && m === currentDate.getMonth() + 1;
    } catch {
      return false;
    }
  };

  const monthlyTransactions = transactions.filter(isTxInSelectedMonth);

  // Contagens para os botões de filtro rápido
  const bankAccountTxCount = useMemo(
    () => monthlyTransactions.filter((t) => t.account?.type !== "CREDIT_CARD").length,
    [monthlyTransactions]
  );
  const creditCardTxCount = useMemo(
    () => monthlyTransactions.filter((t) => t.account?.type === "CREDIT_CARD").length,
    [monthlyTransactions]
  );
  const uncategorizedMonthlyCount = useMemo(
    () => monthlyTransactions.filter((t) => !t.categoryId && !isFinancialMovement(t)).length,
    [monthlyTransactions]
  );

  // Transações filtradas para exibição na lista
  const displayedTransactions = useMemo(() => {
    return monthlyTransactions.filter((tx) => {
      // Filtro de busca de texto
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchDesc = tx.description?.toLowerCase().includes(term);
        const matchCat = tx.category?.name?.toLowerCase().includes(term);
        const matchAcc = tx.account?.name?.toLowerCase().includes(term);
        if (!matchDesc && !matchCat && !matchAcc) return false;
      }

      // Filtro de conta / cartão
      if (accountFilter === "ALL") return true;
      if (accountFilter === "BANK_ACCOUNTS") return tx.account?.type !== "CREDIT_CARD";
      if (accountFilter === "CREDIT_CARDS") return tx.account?.type === "CREDIT_CARD";
      return tx.accountId === accountFilter;
    });
  }, [monthlyTransactions, accountFilter, searchTerm]);

  // Subtotais da visão filtrada atual
  const filteredTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let transfers = 0;
    displayedTransactions.forEach((tx) => {
      const val = Math.abs(Number(tx.amount));
      if (tx.type === "INCOME") income += val;
      else if (tx.type === "EXPENSE") expense += val;
      else if (tx.type === "TRANSFER") transfers += val;
    });
    return { income, expense, transfers, balance: income - expense };
  }, [displayedTransactions]);

  const isCardFilterActive = useMemo(() => {
    if (accountFilter === "CREDIT_CARDS") return true;
    const acc = accounts.find((a) => a.id === accountFilter);
    return acc?.type === "CREDIT_CARD";
  }, [accountFilter, accounts]);

  // Nome da conta selecionada quando for filtro específico
  const selectedAccountName = useMemo(() => {
    if (accountFilter === "ALL" || accountFilter === "BANK_ACCOUNTS" || accountFilter === "CREDIT_CARDS") {
      return null;
    }
    const acc = accounts.find((a) => a.id === accountFilter);
    return acc ? acc.name : null;
  }, [accounts, accountFilter]);

  // Totais do mês calculados dinamicamente dos lançamentos do mês selecionado
  // 1. Realizado (Pago / Efetivado):
  const realizedIncome = monthlyTransactions
    .filter((t) => t.type === "INCOME" && t.status !== "PENDING")
    .reduce((acc, curr) => acc + Number(curr.amount), 0);

  const realizedExpense = monthlyTransactions
    .filter((t) => t.type === "EXPENSE" && t.status !== "PENDING")
    .reduce((acc, curr) => acc + Math.abs(Number(curr.amount)), 0);

  const realizedResult = realizedIncome - realizedExpense;

  // 2. Pendente / Previsto:
  const pendingIncome = monthlyTransactions
    .filter((t) => t.type === "INCOME" && t.status === "PENDING")
    .reduce((acc, curr) => acc + Number(curr.amount), 0);

  const pendingExpense = monthlyTransactions
    .filter((t) => t.type === "EXPENSE" && t.status === "PENDING")
    .reduce((acc, curr) => acc + Math.abs(Number(curr.amount)), 0);

  // 3. Projeção Total do Mês (Realizado + Previsto):
  const totalIncome = realizedIncome + pendingIncome;
  const totalExpense = realizedExpense + pendingExpense;
  const projectedResult = totalIncome - totalExpense;

  if (!mounted) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-slate-100 items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center font-black text-lg text-slate-950 shadow-lg shadow-emerald-500/20 animate-pulse">
            10
          </div>
          <span className="font-bold text-slate-300 text-sm">Carregando 10mangos...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar Elegante */}
      <aside className="w-64 border-r border-slate-800/80 bg-slate-950/60 p-6 flex flex-col justify-between hidden md:flex">
        <div className="space-y-8">
          {/* Logo 10mangos */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center font-black text-xl text-slate-950 shadow-lg shadow-emerald-500/20">
              10
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight">10mangos</span>
              <span className="block text-[10px] text-emerald-400/80 font-medium tracking-widest uppercase">Controle Pessoal</span>
            </div>
          </div>

          {/* Navegação Principal */}
          <nav className="space-y-1.5">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 font-medium text-sm transition-colors text-left">
              <Home className="h-4 w-4" />
              <span>Visão Geral</span>
            </button>
            <button
              onClick={handleOpenNewTx}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 font-medium text-sm transition-colors text-left"
            >
              <CreditCard className="h-4 w-4" />
              <span>Transações</span>
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-emerald-400/90 bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/20 font-medium text-sm transition-colors text-left"
            >
              <Sparkles className="h-4 w-4" />
              <span>Importar Organizze / OFX</span>
            </button>
          </nav>
        </div>

        {/* Perfil & Workspace */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-emerald-400">
            CB
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">Carlos Brazil</p>
            <p className="text-xs text-slate-500 truncate">Finanças Pessoais</p>
          </div>
        </div>
      </aside>

      {/* Conteúdo Central */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Topbar */}
        <header className="h-16 border-b border-slate-800/80 px-8 flex items-center justify-between bg-slate-950/40 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {/* Seletor de Mês Interativo */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-sm">
              <button
                onClick={handlePrevMonth}
                title="Mês anterior"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 px-3 py-1 font-semibold text-sm text-slate-200 min-w-[170px] justify-center select-none">
                <Calendar className="h-4 w-4 text-emerald-400" />
                <span>{capitalizedMonth} {currentDate.getFullYear()}</span>
              </div>
              <button
                onClick={handleNextMonth}
                title="Próximo mês"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {!isCurrentMonth && (
              <button
                onClick={handleCurrentMonth}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 font-medium transition-colors"
              >
                Mês Atual
              </button>
            )}

            <button
              onClick={() => {
                const token = localStorage.getItem("token");
                if (token) loadData(token, currentDate);
              }}
              title="Atualizar dados"
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAutoCategorize}
              disabled={isAutoCategorizing}
              className="flex items-center gap-2 bg-gradient-to-r from-amber-500/10 to-amber-600/15 hover:from-amber-500/20 hover:to-amber-600/25 border border-amber-500/40 text-amber-300 font-semibold px-3.5 py-2 rounded-lg text-sm transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              title="Identificar e categorizar lançamentos automaticamente pela descrição"
            >
              <Zap className={`h-4 w-4 text-amber-400 ${isAutoCategorizing ? "animate-pulse" : ""}`} />
              <span>{isAutoCategorizing ? "Categorizando..." : "Auto-categorizar"}</span>
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold px-4 py-2 rounded-lg text-sm transition-all"
            >
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <span>Importar Arquivo</span>
            </button>
            <button
              onClick={handleOpenNewTx}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>Novo Lançamento</span>
            </button>
          </div>
        </header>

        {/* Área de Conteúdo */}
        <div className="p-8 max-w-7xl w-full mx-auto space-y-8">
          {/* Hero Cards: Resumo do Mês */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/80 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Patrimônio Líquido</span>
                <Wallet className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-2xl font-black tracking-tight text-slate-50">
                {formatCurrency(summary.netWorth)}
              </p>
              <p className="text-[11px] text-slate-500">Saldo real consolidado</p>
            </div>

            <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/80 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Receitas ({capitalizedMonth})</span>
                <ArrowDownLeft className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-2xl font-black tracking-tight text-emerald-400">
                {formatCurrency(totalIncome)}
              </p>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Recebido: {formatCurrency(realizedIncome)}</span>
                {pendingIncome > 0 && (
                  <span className="text-amber-400/90 font-medium">Previsto: {formatCurrency(pendingIncome)}</span>
                )}
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/80 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Despesas ({capitalizedMonth})</span>
                <ArrowUpRight className="h-4 w-4 text-rose-400" />
              </div>
              <p className="text-2xl font-black tracking-tight text-rose-400">
                {formatCurrency(totalExpense)}
              </p>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Pago: {formatCurrency(realizedExpense)}</span>
                {pendingExpense > 0 && (
                  <span className="text-amber-400/90 font-medium">A pagar: {formatCurrency(pendingExpense)}</span>
                )}
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/80 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Resultado ({capitalizedMonth})</span>
                <TrendingUp className="h-4 w-4 text-emerald-400" />
              </div>
              
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-400 font-medium">Saldo (Realizado):</span>
                  <p className={`text-xl font-black tracking-tight ${realizedResult >= 0 ? "text-emerald-300" : "text-rose-400"}`}>
                    {realizedResult >= 0 ? `+ ${formatCurrency(realizedResult)}` : formatCurrency(realizedResult)}
                  </p>
                </div>

                <div className="flex items-baseline justify-between pt-1 border-t border-slate-800/70">
                  <span className="text-xs text-amber-400/90 font-medium flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Previsto (Final):
                  </span>
                  <p className={`text-sm font-bold tracking-tight ${projectedResult >= 0 ? "text-slate-100" : "text-rose-400"}`}>
                    {projectedResult >= 0 ? `+ ${formatCurrency(projectedResult)}` : formatCurrency(projectedResult)}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 pt-0.5">
                {pendingExpense > 0 ? `Contas a vencer: ${formatCurrency(pendingExpense)}` : "Todas as contas foram liquidadas"}
              </p>
            </div>
          </div>

          {/* Seção 2 Colunas: Cartões & Contas vs Extrato */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Coluna Esquerda: Cartões de Crédito & Contas */}
            <div className="space-y-6">
              {/* Faturas de Cartão */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Cartões de Crédito</h3>
                </div>
                <div className="space-y-3">
                  {creditCards.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum cartão cadastrado.</p>
                  ) : (
                    creditCards.map((card) => {
                      const isSelected = accountFilter === card.id;
                      const monthlyCardExpense = monthlyTransactions
                        .filter((t) => t.accountId === card.id && t.type === "EXPENSE")
                        .reduce((acc, curr) => acc + Math.abs(Number(curr.amount)), 0);
                      const balance = monthlyCardExpense > 0 ? monthlyCardExpense : Math.abs(Number(card.currentBalance || 0));
                      const limit = Number(card.creditLimit || 20000);
                      const percentage = Math.min(100, Math.round((balance / limit) * 100));
                      return (
                        <div
                          key={card.id}
                          onClick={() => setAccountFilter((prev) => (prev === card.id ? "ALL" : card.id))}
                          className={`p-4 rounded-xl border cursor-pointer transition-all space-y-3 ${
                            isSelected
                              ? "border-purple-500 bg-purple-950/30 ring-2 ring-purple-500/40 shadow-lg shadow-purple-500/10"
                              : "border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-sm">{card.name}</span>
                                {isSelected && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                                    Filtro Ativo
                                  </span>
                                )}
                              </div>
                              <span className="block text-[11px] text-slate-400">
                                Fecha dia {card.closingDay || "?"} · Vence dia {card.dueDay || "?"}
                              </span>
                            </div>
                            <p className="font-bold text-base">{formatCurrency(balance)}</p>
                          </div>
                          <div className="space-y-1">
                            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-purple-400 rounded-full" style={{ width: `${percentage}%` }}></div>
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-400">
                              <span>{percentage}% do limite</span>
                              <span>Disp: {formatCurrency(Math.max(0, limit - balance))}</span>
                            </div>
                          </div>

                          {/* Ação de Pagamento de Fatura */}
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Clock className="h-3 w-3 text-amber-400/90" />
                              Venc. dia {card.dueDay || "?"}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePayInvoice(card);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold text-xs transition-all flex items-center gap-1.5 shadow-sm hover:scale-[1.02] active:scale-[0.98]"
                            >
                              <CreditCard className="h-3 w-3" />
                              <span>Pagar Fatura</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Contas Correntes & Investimentos */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Contas & Investimentos</h3>
                </div>
                <div className="p-2 rounded-2xl bg-slate-900/60 border border-slate-800/80 divide-y divide-slate-800/60">
                  {bankAccounts.length === 0 ? (
                    <p className="text-xs text-slate-500 p-3">Nenhuma conta cadastrada.</p>
                  ) : (
                    bankAccounts.map((acc) => {
                      const isSelected = accountFilter === acc.id;
                      return (
                        <div
                          key={acc.id}
                          onClick={() => setAccountFilter((prev) => (prev === acc.id ? "ALL" : acc.id))}
                          className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                            isSelected
                              ? "bg-emerald-950/40 border border-emerald-500/50 ring-1 ring-emerald-500/30"
                              : "hover:bg-slate-800/40"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                              isSelected ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-emerald-400"
                            }`}>
                              {acc.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold">{acc.name}</p>
                                {isSelected && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                    Ativo
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500">{acc.type === "INVESTMENT" ? "Investimento" : "Conta Corrente"}</p>
                            </div>
                          </div>
                          <p className="font-bold text-sm">
                            {acc.currency === "USD" ? `$ ${Number(acc.currentBalance).toFixed(2)} USD` : formatCurrency(Number(acc.currentBalance))}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Coluna Direita: Lançamentos do Mês Selecionado */}
            <div className="lg:col-span-2 space-y-4">
              {/* Header com Título e Estatísticas da Exibição */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-100">Lançamentos de {capitalizedMonth}</h3>
                    {uncategorizedMonthlyCount > 0 && (
                      <button
                        onClick={handleAutoCategorize}
                        disabled={isAutoCategorizing}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-[11px] font-semibold transition-colors"
                        title="Identificar e categorizar lançamentos automaticamente"
                      >
                        <Zap className="h-3 w-3 text-amber-400" />
                        <span>{uncategorizedMonthlyCount} sem categoria</span>
                      </button>
                    )}
                    {selectedAccountName && (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                        {selectedAccountName}
                        <button
                          onClick={() => setAccountFilter("ALL")}
                          className="hover:text-rose-400 ml-1"
                          title="Limpar filtro de conta"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {displayedTransactions.length} {displayedTransactions.length === 1 ? "transação exibida" : "transações exibidas"}
                    {accountFilter !== "ALL" || searchTerm ? ` (de ${monthlyTransactions.length} no mês)` : ""}
                    {displayedTransactions.length > 0 && (
                      <span className="ml-1 text-slate-500">
                        {isCardFilterActive ? (
                          <>
                            · Total da Fatura (Despesas): <strong className="text-rose-400">{formatCurrency(filteredTotals.expense)}</strong>
                            {filteredTotals.transfers > 0 && (
                              <span className="ml-2 text-slate-400">
                                (Pagamentos anteriores: <span className="text-emerald-400 font-semibold">{formatCurrency(filteredTotals.transfers)}</span>)
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            · Total do filtro: <strong className={filteredTotals.balance >= 0 ? "text-emerald-400" : "text-rose-400"}>
                              {formatCurrency(filteredTotals.balance, accounts.find((a) => a.id === accountFilter)?.currency || "BRL")}
                            </strong>
                          </>
                        )}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Barra de Filtros Rápidos, Dropdown e Busca */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                {/* Abas Rápidas: Todas / Contas / Cartões */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setAccountFilter("ALL")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                      accountFilter === "ALL"
                        ? "bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                    }`}
                  >
                    <span>Todas</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-300">
                      {monthlyTransactions.length}
                    </span>
                  </button>

                  <button
                    onClick={() => setAccountFilter("BANK_ACCOUNTS")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                      accountFilter === "BANK_ACCOUNTS"
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                    }`}
                  >
                    <Landmark className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Contas Correntes</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-300">
                      {bankAccountTxCount}
                    </span>
                  </button>

                  <button
                    onClick={() => setAccountFilter("CREDIT_CARDS")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                      accountFilter === "CREDIT_CARDS"
                        ? "bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                    }`}
                  >
                    <CreditCard className="h-3.5 w-3.5 text-purple-400" />
                    <span>Cartões de Crédito</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-300">
                      {creditCardTxCount}
                    </span>
                  </button>
                </div>

                {/* Seletor dropdown específico & Campo de Busca */}
                <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                  {/* Dropdown de Conta/Cartão específico */}
                  <select
                    value={accountFilter}
                    onChange={(e) => setAccountFilter(e.target.value)}
                    className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="ALL">Todas as Origens</option>
                    <option value="BANK_ACCOUNTS">🏦 Todas Contas Correntes</option>
                    <option value="CREDIT_CARDS">💳 Todos Cartões de Crédito</option>
                    {bankAccounts.length > 0 && (
                      <optgroup label="Contas Bancárias">
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            🏦 {a.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {creditCards.length > 0 && (
                      <optgroup label="Cartões de Crédito">
                        {creditCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            💳 {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* Input de Busca */}
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-32 sm:w-40 pl-8 pr-6 py-1 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabela de Transações */}
              <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 overflow-hidden">
                {displayedTransactions.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <p className="text-sm text-slate-400">
                      {monthlyTransactions.length === 0
                        ? `Nenhum lançamento registrado em ${capitalizedMonth} de ${currentDate.getFullYear()}.`
                        : "Nenhum lançamento encontrado para os filtros selecionados."}
                    </p>
                    {monthlyTransactions.length === 0 ? (
                      <button
                        onClick={handleOpenNewTx}
                        className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-colors"
                      >
                        + Novo Lançamento em {capitalizedMonth}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setAccountFilter("ALL");
                          setSearchTerm("");
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors"
                      >
                        Limpar Filtros
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {displayedTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        onClick={() => setSelectedTxForEdit(tx)}
                        className="p-4 flex items-center justify-between hover:bg-slate-800/60 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                            tx.type === "TRANSFER"
                              ? "bg-sky-500/10 text-sky-400"
                              : tx.type === "INCOME"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-slate-800 text-slate-300"
                          }`}>
                            {tx.type === "TRANSFER" ? (
                              <ArrowRightLeft className="h-4 w-4" />
                            ) : tx.type === "INCOME" ? (
                              <ArrowDownLeft className="h-4 w-4" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-100">{tx.description}</p>
                              {Boolean(tx.recurringRuleId || tx.source === "RECURRING") && (
                                <span
                                  title="Lançamento Fixo / Recorrente"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                >
                                  <Repeat className="h-2.5 w-2.5" /> Fixo
                                </span>
                              )}
                              {Boolean(tx.installmentPlanId || tx.source === "INSTALLMENT") && (
                                <span
                                  title="Compra Parcelada"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                                >
                                  <Layers className="h-2.5 w-2.5" /> {tx.installmentNumber ? `${tx.installmentNumber}x` : "Parcelado"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                              <span>{formatDate(tx.date)}</span>
                              {tx.competenceDate && (() => {
                                try {
                                  const d1 = String(tx.date || "").split("T")[0];
                                  const d2 = String(tx.competenceDate || "").split("T")[0];
                                  const p1 = d1.split("-");
                                  const p2 = d2.split("-");
                                  if (p1.length >= 2 && p2.length >= 2) {
                                    const [y1, m1] = p1;
                                    const [y2, m2] = p2;
                                    if (y1 !== y2 || m1 !== m2) {
                                      return (
                                        <span
                                          title={`Compra em ${formatDate(tx.date)} atribuída à fatura de ${m2}/${y2}`}
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/25"
                                        >
                                          <Calendar className="h-2.5 w-2.5" /> Fatura {m2}/{y2}
                                        </span>
                                      );
                                    }
                                  }
                                } catch {
                                  // ignora erro de parse visual
                                }
                                return null;
                              })()}
                              <span>•</span>
                              {tx.type === "TRANSFER" ? (() => {
                                const isDebit = Number(tx.amount) < 0;
                                const linkedAcc = tx.transferFrom?.toTransaction?.account || tx.transferTo?.fromTransaction?.account;
                                const transferLabel = linkedAcc
                                  ? (isDebit ? `Transf. ➔ ${linkedAcc.name}` : `Transf. 🠔 ${linkedAcc.name}`)
                                  : "Transferência";
                                return (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                    <ArrowRightLeft className="h-2.5 w-2.5 text-sky-400" />
                                    {transferLabel}
                                  </span>
                                );
                              })() : isFinancialMovement(tx) ? (
                                <span
                                  title="Movimentação patrimonial interna, pagamento de fatura ou PIX entre contas (não requer categoria de despesa)"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700/60"
                                >
                                  <ArrowRightLeft className="h-2.5 w-2.5 text-slate-400" />
                                  Movimentação
                                </span>
                              ) : (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                    tx.category
                                      ? "bg-slate-800 text-slate-300"
                                      : "bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold"
                                  }`}
                                >
                                  {tx.category
                                    ? tx.category.parent
                                      ? `${tx.category.parent.name} > ${tx.category.name}`
                                      : tx.category.name
                                    : "Sem categoria"}
                                </span>
                              )}
                              <span>•</span>
                              {tx.account?.type === "CREDIT_CARD" ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                  <CreditCard className="h-2.5 w-2.5 text-purple-400" /> {tx.account?.name}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700/60">
                                  <Landmark className="h-2.5 w-2.5 text-emerald-400" /> {tx.account?.name}
                                  {tx.account?.currency === "USD" && (
                                    <span className="ml-0.5 px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                                      USD
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              title="Mover para o mês anterior"
                              onClick={(e) => handleQuickShiftMonth(e, tx, -1)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Mover para o mês seguinte (ex: fatura seguinte)"
                              onClick={(e) => handleQuickShiftMonth(e, tx, 1)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Copiar Lançamento"
                              onClick={(e) => handleDuplicateDirectly(e, tx)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="text-right">
                            {(() => {
                              const txCurr = tx.account?.currency || "BRL";
                              const amt = Number(tx.amount);
                              return (
                                <p className={`font-bold text-sm ${tx.type === "INCOME" ? "text-emerald-400" : "text-slate-100"}`}>
                                  {amt > 0 ? `+${formatCurrency(amt, txCurr)}` : formatCurrency(amt, txCurr)}
                                </p>
                              );
                            })()}
                            <div className="flex items-center justify-end gap-1 text-[10px]">
                              {tx.status === "CLEARED" ? (
                                <span className="text-emerald-500/80 flex items-center gap-0.5">
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Pago
                                </span>
                              ) : (
                                <span className="text-amber-400/90 flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" /> Previsto
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Modais Integrados */}
      <NewTransactionModal
        isOpen={isNewTxOpen}
        onClose={() => {
          setIsNewTxOpen(false);
          setNewTxInitialData(null);
        }}
        accounts={accounts}
        categories={categories}
        defaultDate={defaultDateForNewTx}
        defaultAccountId={accountFilter !== "ALL" && accountFilter !== "BANK_ACCOUNTS" && accountFilter !== "CREDIT_CARDS" ? accountFilter : undefined}
        initialData={newTxInitialData}
        onSuccess={() => {
          const token = localStorage.getItem("token");
          if (token) loadData(token, currentDate);
        }}
      />

      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        accounts={accounts}
        onSuccess={() => {
          const token = localStorage.getItem("token");
          if (token) loadData(token, currentDate);
        }}
      />

      <EditTransactionModal
        isOpen={!!selectedTxForEdit}
        onClose={() => setSelectedTxForEdit(null)}
        transaction={selectedTxForEdit}
        categories={categories}
        accounts={accounts}
        onSuccess={() => {
          const token = localStorage.getItem("token");
          if (token) loadData(token, currentDate);
        }}
      />
    </div>
  );
}
