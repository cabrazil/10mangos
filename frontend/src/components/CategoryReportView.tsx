"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  PieChart,
  ChevronDown,
  ChevronRight,
  Info,
  ArrowLeft,
  Layers,
  CheckCircle2,
  Clock,
  CreditCard,
  Landmark,
  Filter,
  ChevronsUpDown,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface ReportTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: "PENDING" | "CLEARED" | "RECONCILED";
  accountName: string;
  accountType: string;
  currency: string;
}

interface ReportSubcategory {
  id: string;
  name: string;
  displayName: string;
  isDirectParent: boolean;
  total: number;
  clearedTotal: number;
  pendingTotal: number;
  count: number;
  percentageOfParent: number;
  percentageOfTotal: number;
  transactions: ReportTransaction[];
}

interface ReportCategory {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  total: number;
  clearedTotal: number;
  pendingTotal: number;
  count: number;
  percentage: number;
  hasSubcategories: boolean;
  subcategories: ReportSubcategory[];
}

interface CategoryReportData {
  month: string;
  type: "EXPENSE" | "INCOME";
  cardDateMode: "PURCHASE_DATE" | "COMPETENCE_DATE";
  includePending: boolean;
  total: number;
  clearedTotal: number;
  pendingTotal: number;
  transactionCount: number;
  categories: ReportCategory[];
}

interface CategoryReportViewProps {
  currentDate: Date;
  accounts: Array<{ id: string; name: string; type: string; currency?: string }>;
  onBack: () => void;
  onSelectTransaction?: (txId: string) => void;
}

const API_BASE = "http://localhost:3333/api";

// Helper para desenhar fatias de arco SVG no gráfico de rosca (Donut)
function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

function createDonutSlicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  // Evitar arco de 360 graus exatos que colapsa no SVG
  const clampedEnd = endAngle - startAngle >= 359.9 ? startAngle + 359.89 : endAngle;
  const startOuter = polarToCartesian(cx, cy, outerR, clampedEnd);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, clampedEnd);
  const endInner = polarToCartesian(cx, cy, innerR, startAngle);

  const largeArcFlag = clampedEnd - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    startOuter.x,
    startOuter.y,
    "A",
    outerR,
    outerR,
    0,
    largeArcFlag,
    0,
    endOuter.x,
    endOuter.y,
    "L",
    endInner.x,
    endInner.y,
    "A",
    innerR,
    innerR,
    0,
    largeArcFlag,
    1,
    startInner.x,
    startInner.y,
    "Z",
  ].join(" ");
}

export function CategoryReportView({
  currentDate,
  accounts,
  onBack,
  onSelectTransaction,
}: CategoryReportViewProps) {
  const [reportType, setReportType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [cardDateMode, setCardDateMode] = useState<"PURCHASE_DATE" | "COMPETENCE_DATE">("PURCHASE_DATE");
  const [includePending, setIncludePending] = useState<boolean>(true);
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<CategoryReportData | null>(null);

  // Categorias pai expandidas (por padrão expande a maior categoria automaticamente)
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Subcategorias expandidas para ver os lançamentos individuais
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  // Categoria em destaque no hover ou clique do gráfico
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null);

  const monthParam = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, [currentDate]);

  const monthLabel = useMemo(() => {
    const name = currentDate.toLocaleDateString("pt-BR", { month: "long" });
    return `${name.charAt(0).toUpperCase() + name.slice(1)} de ${currentDate.getFullYear()}`;
  }, [currentDate]);

  useEffect(() => {
    async function fetchReport() {
      const token = localStorage.getItem("token");
      if (!token) return;

      setLoading(true);
      try {
        const params = new URLSearchParams({
          month: monthParam,
          type: reportType,
          cardDateMode,
          includePending: String(includePending),
          accountId: accountFilter,
        });

        const res = await fetch(`${API_BASE}/reports/by-category?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const json: CategoryReportData = await res.json();
          setData(json);
          setExpandedParents(new Set());
          setExpandedSubs(new Set());
        }
      } catch (err) {
        console.error("Erro ao carregar relatório por categorias:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, [monthParam, reportType, cardDateMode, includePending, accountFilter]);

  function toggleParent(catId: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  }

  function toggleSubcategory(subId: string) {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) {
        next.delete(subId);
      } else {
        next.add(subId);
      }
      return next;
    });
  }

  function toggleExpandAll() {
    if (!data) return;
    if (expandedParents.size === data.categories.length) {
      setExpandedParents(new Set());
      setExpandedSubs(new Set());
    } else {
      setExpandedParents(new Set(data.categories.map((c) => c.id)));
    }
  }

  // Calcular ângulos das fatias do Donut Chart
  const donutSlices = useMemo(() => {
    if (!data || data.categories.length === 0 || data.total <= 0) return [];
    let currentAngle = 0;
    return data.categories.map((cat) => {
      const angle = (cat.total / data.total) * 360;
      const slice = {
        ...cat,
        startAngle: currentAngle,
        endAngle: currentAngle + Math.max(angle, 1.2),
      };
      currentAngle += angle;
      return slice;
    });
  }, [data]);

  // Categoria ativa para exibir no centro do Donut e no card lateral
  const activeCategory = useMemo(() => {
    if (!data || data.categories.length === 0) return null;
    if (hoveredCategoryId) {
      return data.categories.find((c) => c.id === hoveredCategoryId) || null;
    }
    if (expandedParents.size === 1) {
      const onlyId = Array.from(expandedParents)[0];
      return data.categories.find((c) => c.id === onlyId) || null;
    }
    return null;
  }, [data, hoveredCategoryId, expandedParents]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Barra de Topo do Relatório */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Visão Geral</span>
          </button>

          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <PieChart className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">Categorias</h1>
              <p className="text-xs text-slate-400">
                Análise detalhada de {reportType === "EXPENSE" ? "gastos" : "receitas"} em{" "}
                <strong className="text-slate-200">{monthLabel}</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Filtros Rápidos e Critério de Data do Cartão */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Alternador Despesas / Receitas */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setReportType("EXPENSE")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                reportType === "EXPENSE"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Despesas
            </button>
            <button
              type="button"
              onClick={() => setReportType("INCOME")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                reportType === "INCOME"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Receitas
            </button>
          </div>

          {/* Filtro de Conta / Cartão */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900">
                Todas as Contas e Cartões
              </option>
              <option value="BANK_ACCOUNTS" className="bg-slate-900">
                Apenas Contas Bancárias
              </option>
              <option value="CREDIT_CARDS" className="bg-slate-900">
                Apenas Cartões de Crédito
              </option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id} className="bg-slate-900">
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Todos do Mês vs Apenas Realizados */}
          <button
            type="button"
            onClick={() => setIncludePending((prev) => !prev)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
              includePending
                ? "bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800"
                : "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
            }`}
            title="Alternar entre considerar todos os compromissos do mês (Realizados + Previstos) ou apenas os já pagos"
          >
            {includePending ? (
              <>
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                <span>Realizados + Previstos</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Apenas Realizados</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sub-barra de Critério de Cartão de Crédito (igual à referência visual) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs">
        <div className="flex items-center gap-4 text-slate-400">
          <span>
            Total de {reportType === "EXPENSE" ? "Despesas" : "Receitas"}:{" "}
            <strong className={reportType === "EXPENSE" ? "text-rose-400 text-sm" : "text-emerald-400 text-sm"}>
              {formatCurrency(data?.total || 0)}
            </strong>
          </span>
          {data && data.pendingTotal > 0 && (
            <span className="hidden sm:inline text-slate-500">
              (Pago: <strong className="text-slate-300">{formatCurrency(data.clearedTotal)}</strong> • Previsto:{" "}
              <strong className="text-amber-400/90">{formatCurrency(data.pendingTotal)}</strong>)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-slate-400">
          <Info className="h-3.5 w-3.5 text-slate-400" />
          <span>Gastos de cartão com base na</span>
          <select
            value={cardDateMode}
            onChange={(e) => setCardDateMode(e.target.value as "PURCHASE_DATE" | "COMPETENCE_DATE")}
            className="bg-transparent font-semibold text-slate-200 underline decoration-dotted underline-offset-4 focus:outline-none cursor-pointer"
          >
            <option value="PURCHASE_DATE" className="bg-slate-900">
              data da compra
            </option>
            <option value="COMPETENCE_DATE" className="bg-slate-900">
              competência da fatura
            </option>
          </select>
        </div>
      </div>

      {/* Corpo Principal: 2 Colunas (Lista Hierárquica à Esquerda + Gráfico Donut à Direita) */}
      {loading ? (
        <div className="py-20 text-center text-sm text-slate-400 animate-pulse">
          Calculando gastos por categoria e subcategoria...
        </div>
      ) : !data || data.categories.length === 0 ? (
        <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800/80 text-center space-y-2">
          <PieChart className="h-10 w-10 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">
            Nenhum lançamento encontrado para {monthLabel}.
          </p>
          <p className="text-xs text-slate-500">
            Altere o mês no seletor superior ou ajuste os filtros acima.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* COLUNA ESQUERDA: Lista de Categorias e Subcategorias (7 colunas) */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                {reportType === "EXPENSE" ? "Despesas por Categoria" : "Receitas por Categoria"} (
                {data.categories.length})
              </h2>
              <button
                type="button"
                onClick={toggleExpandAll}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
                <span>
                  {expandedParents.size === data.categories.length ? "Recolher todas" : "Expandir todas"}
                </span>
              </button>
            </div>

            <div className="space-y-2">
              {data.categories.map((cat) => {
                const isExpanded = expandedParents.has(cat.id);
                const isHovered = hoveredCategoryId === cat.id;

                return (
                  <div
                    key={cat.id}
                    onMouseEnter={() => setHoveredCategoryId(cat.id)}
                    onMouseLeave={() => setHoveredCategoryId(null)}
                    className="rounded-2xl border border-slate-800/80 bg-slate-900/40 overflow-hidden transition-all"
                  >
                    {/* Linha da Categoria Pai */}
                    <button
                      type="button"
                      onClick={() => toggleParent(cat.id)}
                      style={{
                        backgroundColor: isExpanded || isHovered ? `${cat.color}16` : undefined,
                        borderColor: isExpanded ? `${cat.color}40` : undefined,
                      }}
                      className="w-full p-4 flex items-center justify-between gap-4 text-left transition-colors relative overflow-hidden group"
                    >
                      {/* Barra de proporção suave no rodapé do card */}
                      <div
                        className="absolute bottom-0 left-0 h-1 transition-all duration-300 opacity-75"
                        style={{
                          width: `${Math.max(cat.percentage, 2)}%`,
                          backgroundColor: cat.color,
                        }}
                      />

                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Ícone Circular Colorido da Categoria */}
                        <div
                          className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm text-slate-950 font-black text-sm"
                          style={{ backgroundColor: cat.color }}
                        >
                          {cat.name.substring(0, 2).toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-slate-100 truncate">
                              {cat.name}
                            </span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-slate-950/60 text-slate-400 border border-slate-800">
                              {cat.count} {cat.count === 1 ? "item" : "itens"}
                            </span>
                          </div>
                          {cat.subcategories.length > 1 ||
                          (cat.subcategories.length === 1 && !cat.subcategories[0].isDirectParent) ? (
                            <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-slate-300" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                              )}
                              <span>
                                {cat.subcategories.length}{" "}
                                {cat.subcategories.length === 1 ? "subcategoria" : "subcategorias"}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                              )}
                              <span>Ver lançamentos</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <div className="text-base font-bold text-slate-100 tracking-tight">
                          {formatCurrency(cat.total)}
                        </div>
                        <div className="text-xs font-semibold text-slate-400">
                          {cat.percentage.toFixed(2).replace(".", ",")}%
                        </div>
                      </div>
                    </button>

                    {/* Lista de Subcategorias Expandida */}
                    {isExpanded && (
                      <div className="divide-y divide-slate-800/60 bg-slate-950/50 border-t border-slate-800/70">
                        {cat.subcategories.map((sub) => {
                          const isSubExpanded = expandedSubs.has(sub.id);

                          return (
                            <div key={sub.id} className="transition-colors">
                              <button
                                type="button"
                                onClick={() => toggleSubcategory(sub.id)}
                                className="w-full pl-9 pr-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-900/70 text-left transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div
                                    className="h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-slate-950"
                                    style={{ backgroundColor: cat.color }}
                                  >
                                    {sub.name.substring(0, 1).toUpperCase()}
                                  </div>

                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-200 truncate">
                                        {sub.isDirectParent && cat.subcategories.length > 1 ? (
                                          <>
                                            {sub.name}{" "}
                                            <span className="text-slate-500 font-normal">(categoria pai)</span>
                                          </>
                                        ) : (
                                          sub.displayName
                                        )}
                                      </span>
                                      <span className="text-[10px] text-slate-500">
                                        ({sub.count})
                                      </span>
                                    </div>
                                    {/* Mini barra de participação dentro da categoria pai */}
                                    <div className="flex items-center gap-2 mt-1">
                                      <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                          className="h-full rounded-full"
                                          style={{
                                            width: `${Math.max(sub.percentageOfParent, 4)}%`,
                                            backgroundColor: cat.color,
                                          }}
                                        />
                                      </div>
                                      <span className="text-[10px] text-slate-500">
                                        {sub.percentageOfParent.toFixed(1).replace(".", ",")}% da categoria •{" "}
                                        {sub.percentageOfTotal.toFixed(1).replace(".", ",")}% do mês
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2.5 flex-shrink-0">
                                  <div className="text-right">
                                    <div className="text-sm font-bold text-slate-200">
                                      {formatCurrency(sub.total)}
                                    </div>
                                  </div>
                                  {isSubExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-slate-500" />
                                  )}
                                </div>
                              </button>

                              {/* Drill-down: Lançamentos individuais da Subcategoria */}
                              {isSubExpanded && (
                                <div className="pl-16 pr-4 py-2 bg-slate-950/90 border-t border-slate-900 space-y-1.5">
                                  {sub.transactions.map((tx) => (
                                    <div
                                      key={tx.id}
                                      onClick={() => onSelectTransaction?.(tx.id)}
                                      className={`py-1.5 px-2.5 rounded-lg flex items-center justify-between gap-3 text-xs border border-slate-800/60 bg-slate-900/40 ${
                                        onSelectTransaction ? "hover:bg-slate-800/60 cursor-pointer" : ""
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <span className="text-[11px] font-mono text-slate-400">
                                          {formatDate(tx.date)}
                                        </span>
                                        <span className="font-medium text-slate-200 truncate">
                                          {tx.description}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-950 text-slate-400 border border-slate-800 flex-shrink-0">
                                          {tx.accountType === "CREDIT_CARD" ? (
                                            <CreditCard className="h-2.5 w-2.5 text-indigo-400" />
                                          ) : (
                                            <Landmark className="h-2.5 w-2.5 text-emerald-400" />
                                          )}
                                          {tx.accountName}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {tx.status === "PENDING" && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                            Previsto
                                          </span>
                                        )}
                                        <span className="font-semibold text-slate-200">
                                          {formatCurrency(tx.amount, tx.currency)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* COLUNA DIREITA: Gráfico de Rosca (Donut Chart) & Detalhamento Visual (5 colunas) */}
          <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-5">
            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 flex flex-col items-center">
              {/* SVG Donut Chart Interativo */}
              <div className="relative w-72 h-72 flex items-center justify-center">
                <svg viewBox="0 0 260 260" className="w-full h-full overflow-visible">
                  {donutSlices.map((slice) => {
                    const isFocused =
                      hoveredCategoryId === slice.id ||
                      (!hoveredCategoryId && activeCategory?.id === slice.id);
                    const outerRadius = isFocused ? 116 : 108;
                    const innerRadius = 68;
                    const pathData = createDonutSlicePath(
                      130,
                      130,
                      outerRadius,
                      innerRadius,
                      slice.startAngle,
                      slice.endAngle
                    );

                    return (
                      <path
                        key={slice.id}
                        d={pathData}
                        fill={slice.color}
                        stroke="#090D16"
                        strokeWidth={donutSlices.length > 1 ? 2.5 : 0}
                        onMouseEnter={() => setHoveredCategoryId(slice.id)}
                        onMouseLeave={() => setHoveredCategoryId(null)}
                        onClick={() => toggleParent(slice.id)}
                        className="cursor-pointer transition-all duration-200 hover:opacity-95"
                        style={{
                          opacity:
                            hoveredCategoryId && hoveredCategoryId !== slice.id
                              ? 0.45
                              : 1,
                        }}
                      >
                        <title>
                          {slice.name}: {formatCurrency(slice.total)} ({slice.percentage.toFixed(2)}%)
                        </title>
                      </path>
                    );
                  })}
                </svg>

                {/* Centro Dinâmico do Donut */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-12 text-center">
                  {activeCategory ? (
                    <>
                      <span
                        className="w-3 h-3 rounded-full mb-1.5 shadow-sm"
                        style={{ backgroundColor: activeCategory.color }}
                      />
                      <span className="text-xs font-bold text-slate-200 line-clamp-1">
                        {activeCategory.name}
                      </span>
                      <span className="text-base font-black text-slate-50 tracking-tight mt-0.5">
                        {formatCurrency(activeCategory.total)}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">
                        {activeCategory.percentage.toFixed(2).replace(".", ",")}% do total
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Total {reportType === "EXPENSE" ? "Gasto" : "Recebido"}
                      </span>
                      <span className="text-lg font-black text-slate-100 tracking-tight mt-0.5">
                        {formatCurrency(data.total)}
                      </span>
                      <span className="text-[11px] text-slate-500 mt-0.5">
                        {data.transactionCount} lançamentos
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Composição da Categoria em Foco (quando uma categoria pai está selecionada/expandida) */}
              {activeCategory && activeCategory.subcategories.length > 0 && (
                <div className="w-full mt-4 pt-4 border-t border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: activeCategory.color }}
                      />
                      Composição de {activeCategory.name}
                    </span>
                    <span className="font-bold text-slate-300">
                      {formatCurrency(activeCategory.total)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {activeCategory.subcategories.slice(0, 6).map((sub) => (
                      <div key={sub.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300 truncate pr-2">{sub.displayName}</span>
                          <span className="text-slate-200 font-semibold flex-shrink-0">
                            {formatCurrency(sub.total)}{" "}
                            <span className="text-slate-500 font-normal">
                              ({sub.percentageOfParent.toFixed(0)}%)
                            </span>
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(sub.percentageOfParent, 3)}%`,
                              backgroundColor: activeCategory.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legenda Compacta das Top Categorias */}
              <div className="w-full mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-2 gap-2">
                {data.categories.slice(0, 8).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleParent(cat.id)}
                    onMouseEnter={() => setHoveredCategoryId(cat.id)}
                    onMouseLeave={() => setHoveredCategoryId(null)}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-xs text-slate-300 truncate">{cat.name}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400 flex-shrink-0">
                      {cat.percentage.toFixed(1).replace(".", ",")}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
