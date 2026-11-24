import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { TransactionType, TransactionStatus, AccountType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isFinancialMovementDesc, normalizeText } from '../lib/auto-categorizer.js';

// Paleta vibrante e distinta inspirada no Organizze / design moderno escuro
const CATEGORY_PALETTE = [
  '#84CC16', // Lime green (Arken)
  '#FB923C', // Coral / Orange (Impostos e Taxas)
  '#A3E635', // Light green (Família e filhos)
  '#D97706', // Amber / Ochre
  '#60A5FA', // Sky blue
  '#38BDF8', // Cyan blue
  '#F472B6', // Pink
  '#A78BFA', // Violet
  '#34D399', // Emerald
  '#FBBF24', // Yellow
  '#F87171', // Rose red
  '#2DD4BF', // Teal
  '#C084FC', // Purple
  '#FB7185', // Crimson pink
  '#94A3B8', // Slate
];

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Resumo Geral do Mês (Dashboard Principal)
  app.get('/monthly-summary', async (request) => {
    const { workspaceId } = request.user;
    const { month } = z.object({ month: z.string().optional() }).parse(request.query);

    const refDate = month ? new Date(month) : new Date();
    const periodStart = startOfMonth(refDate);
    const periodEnd = endOfMonth(refDate);

    const clearedTransactions = await prisma.transaction.findMany({
      where: {
        workspaceId,
        status: { in: [TransactionStatus.CLEARED, TransactionStatus.RECONCILED] },
        date: { gte: periodStart, lte: periodEnd },
      },
    });

    const pendingTransactions = await prisma.transaction.findMany({
      where: {
        workspaceId,
        status: TransactionStatus.PENDING,
        date: { gte: periodStart, lte: periodEnd },
      },
    });

    const incomeCleared = clearedTransactions
      .filter((t) => t.type === TransactionType.INCOME)
      .reduce((acc, t) => acc + Number(t.amount), 0);

    const expenseCleared = clearedTransactions
      .filter((t) => t.type === TransactionType.EXPENSE)
      .reduce((acc, t) => acc + Math.abs(Number(t.amount)), 0);

    const incomePending = pendingTransactions
      .filter((t) => t.type === TransactionType.INCOME)
      .reduce((acc, t) => acc + Number(t.amount), 0);

    const expensePending = pendingTransactions
      .filter((t) => t.type === TransactionType.EXPENSE)
      .reduce((acc, t) => acc + Math.abs(Number(t.amount)), 0);

    const netResultCleared = incomeCleared - expenseCleared;
    const netResultProjected = incomeCleared + incomePending - (expenseCleared + expensePending);
    const savingsRate = incomeCleared > 0 ? Number(((netResultCleared / incomeCleared) * 100).toFixed(2)) : 0;

    const accounts = await prisma.account.findMany({
      where: { workspaceId, isArchived: false, includeInTotals: true },
    });

    const cashBalance = accounts
      .filter(
        (a) =>
          a.type === AccountType.CHECKING ||
          a.type === AccountType.SAVINGS ||
          a.type === AccountType.CASH ||
          a.type === AccountType.DIGITAL_WALLET
      )
      .reduce((acc, a) => acc + Number(a.currentBalance), 0);

    const investmentBalance = accounts
      .filter((a) => a.type === AccountType.INVESTMENT)
      .reduce((acc, a) => acc + Number(a.currentBalance), 0);

    const creditCardDebt = accounts
      .filter((a) => a.type === AccountType.CREDIT_CARD)
      .reduce((acc, a) => acc + Math.abs(Math.min(0, Number(a.currentBalance))), 0);

    const netWorth = cashBalance + investmentBalance - creditCardDebt;

    return {
      month: format(periodStart, 'yyyy-MM'),
      cleared: {
        income: incomeCleared,
        expense: expenseCleared,
        netResult: netResultCleared,
        savingsRate,
      },
      projected: {
        income: incomeCleared + incomePending,
        expense: expenseCleared + expensePending,
        netResult: netResultProjected,
      },
      netWorth: {
        cashBalance,
        investmentBalance,
        creditCardDebt,
        total: netWorth,
      },
    };
  });

  // ===========================================================================
  // Demonstrativo Hierárquico por Categoria e Subcategoria
  // Por padrão considera os gastos com cartão de crédito pela DATA DA COMPRA (tx.date)
  // ===========================================================================
  app.get('/by-category', async (request) => {
    const { workspaceId } = request.user;
    const query = z
      .object({
        month: z.string().optional(), // formato YYYY-MM ou YYYY-MM-DD
        type: z.nativeEnum(TransactionType).default(TransactionType.EXPENSE),
        cardDateMode: z.enum(['PURCHASE_DATE', 'COMPETENCE_DATE']).default('PURCHASE_DATE'),
        includePending: z.enum(['true', 'false']).default('true'),
        accountId: z.string().optional(),
      })
      .parse(request.query);

    // Determinar início e fim estritos do mês em UTC
    let year: number;
    let monthZeroIndexed: number;
    if (query.month && /^\d{4}-\d{2}/.test(query.month)) {
      const parts = query.month.split('-');
      year = Number(parts[0]);
      monthZeroIndexed = Number(parts[1]) - 1;
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      monthZeroIndexed = now.getUTCMonth();
    }

    const periodStart = new Date(Date.UTC(year, monthZeroIndexed, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, monthZeroIndexed + 1, 0, 23, 59, 59, 999));

    const statuses =
      query.includePending === 'true'
        ? [TransactionStatus.CLEARED, TransactionStatus.RECONCILED, TransactionStatus.PENDING]
        : [TransactionStatus.CLEARED, TransactionStatus.RECONCILED];

    const whereClause: any = {
      workspaceId,
      type: query.type,
      status: { in: statuses },
    };

    if (query.accountId && query.accountId !== 'ALL') {
      if (query.accountId === 'BANK_ACCOUNTS') {
        whereClause.account = { type: { not: AccountType.CREDIT_CARD } };
      } else if (query.accountId === 'CREDIT_CARDS') {
        whereClause.account = { type: AccountType.CREDIT_CARD };
      } else {
        whereClause.accountId = query.accountId;
      }
    }

    // Regra principal solicitada:
    // "Assumir os gastos com cartão de crédito pela data da compra" (PURCHASE_DATE -> tx.date)
    if (query.cardDateMode === 'PURCHASE_DATE') {
      whereClause.date = { gte: periodStart, lte: periodEnd };
    } else {
      whereClause.OR = [
        { competenceDate: { gte: periodStart, lte: periodEnd } },
        { competenceDate: null, date: { gte: periodStart, lte: periodEnd } },
      ];
    }

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true, color: true },
        },
        category: {
          include: {
            parent: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    interface SubcategoryAcc {
      id: string;
      name: string;
      isDirectParent: boolean;
      total: number;
      clearedTotal: number;
      pendingTotal: number;
      count: number;
      transactions: Array<{
        id: string;
        date: string;
        description: string;
        amount: number;
        status: TransactionStatus;
        accountName: string;
        accountType: AccountType;
        currency: string;
      }>;
    }

    interface ParentCategoryAcc {
      id: string;
      name: string;
      color: string | null;
      icon: string | null;
      total: number;
      clearedTotal: number;
      pendingTotal: number;
      count: number;
      subcategoriesMap: Map<string, SubcategoryAcc>;
    }

    const parentMap = new Map<string, ParentCategoryAcc>();
    let totalGeneral = 0;
    let totalClearedGeneral = 0;
    let totalPendingGeneral = 0;
    let totalTxCount = 0;

    for (const tx of transactions) {
      // Se não tem categoria e é uma movimentação financeira (PIX entre contas, pagamento de fatura, CDB), ignora do gráfico de gastos
      if (!tx.category && isFinancialMovementDesc(normalizeText(tx.description || ''))) {
        continue;
      }

      const amount = Math.abs(Number(tx.amount));
      if (amount === 0) continue;

      const isPending = tx.status === TransactionStatus.PENDING;
      totalGeneral += amount;
      if (isPending) totalPendingGeneral += amount;
      else totalClearedGeneral += amount;
      totalTxCount++;

      let parentId: string;
      let parentName: string;
      let parentColor: string | null = null;
      let parentIcon: string | null = null;

      let subId: string;
      let subName: string;
      let isDirectParent = false;

      if (!tx.category) {
        parentId = 'uncategorized';
        parentName = 'Sem categoria';
        parentColor = '#64748B';
        subId = 'uncategorized-direct';
        subName = 'Lançamentos sem categoria';
        isDirectParent = true;
      } else if (tx.category.parent) {
        parentId = tx.category.parent.id;
        parentName = tx.category.parent.name;
        parentColor = tx.category.parent.color || tx.category.color;
        parentIcon = tx.category.parent.icon || tx.category.icon;
        subId = tx.category.id;
        subName = tx.category.name;
        isDirectParent = false;
      } else {
        parentId = tx.category.id;
        parentName = tx.category.name;
        parentColor = tx.category.color;
        parentIcon = tx.category.icon;
        subId = `${tx.category.id}__direct`;
        subName = tx.category.name;
        isDirectParent = true;
      }

      if (!parentMap.has(parentId)) {
        parentMap.set(parentId, {
          id: parentId,
          name: parentName,
          color: parentColor,
          icon: parentIcon,
          total: 0,
          clearedTotal: 0,
          pendingTotal: 0,
          count: 0,
          subcategoriesMap: new Map(),
        });
      }

      const parentAcc = parentMap.get(parentId)!;
      parentAcc.total += amount;
      if (isPending) parentAcc.pendingTotal += amount;
      else parentAcc.clearedTotal += amount;
      parentAcc.count += 1;

      if (!parentAcc.subcategoriesMap.has(subId)) {
        parentAcc.subcategoriesMap.set(subId, {
          id: subId,
          name: subName,
          isDirectParent,
          total: 0,
          clearedTotal: 0,
          pendingTotal: 0,
          count: 0,
          transactions: [],
        });
      }

      const subAcc = parentAcc.subcategoriesMap.get(subId)!;
      subAcc.total += amount;
      if (isPending) subAcc.pendingTotal += amount;
      else subAcc.clearedTotal += amount;
      subAcc.count += 1;
      subAcc.transactions.push({
        id: tx.id,
        date: tx.date.toISOString().split('T')[0],
        description: tx.description,
        amount,
        status: tx.status,
        accountName: tx.account?.name || 'Conta',
        accountType: tx.account?.type || AccountType.CHECKING,
        currency: tx.account?.currency || 'BRL',
      });
    }

    // Ordenar categorias pai por maior valor
    const sortedParents = Array.from(parentMap.values()).sort((a, b) => b.total - a.total);

    const categoriesResult = sortedParents.map((parent, idx) => {
      const assignedColor = parent.color || CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
      const subs = Array.from(parentAccSubcategories(parent)).sort((a, b) => b.total - a.total);
      const hasRealSubcategories = subs.some((s) => !s.isDirectParent);

      const formattedSubs = subs.map((sub) => ({
        id: sub.id,
        name: sub.name,
        displayName: sub.isDirectParent && hasRealSubcategories ? `${sub.name} (categoria pai)` : sub.name,
        isDirectParent: sub.isDirectParent,
        total: Number(sub.total.toFixed(2)),
        clearedTotal: Number(sub.clearedTotal.toFixed(2)),
        pendingTotal: Number(sub.pendingTotal.toFixed(2)),
        count: sub.count,
        percentageOfParent: parent.total > 0 ? Number(((sub.total / parent.total) * 100).toFixed(2)) : 0,
        percentageOfTotal: totalGeneral > 0 ? Number(((sub.total / totalGeneral) * 100).toFixed(2)) : 0,
        transactions: sub.transactions,
      }));

      return {
        id: parent.id,
        name: parent.name,
        color: assignedColor,
        icon: parent.icon,
        total: Number(parent.total.toFixed(2)),
        clearedTotal: Number(parent.clearedTotal.toFixed(2)),
        pendingTotal: Number(parent.pendingTotal.toFixed(2)),
        count: parent.count,
        percentage: totalGeneral > 0 ? Number(((parent.total / totalGeneral) * 100).toFixed(2)) : 0,
        hasSubcategories: hasRealSubcategories || formattedSubs.length > 0,
        subcategories: formattedSubs,
      };
    });

    function parentAccSubcategories(p: ParentCategoryAcc) {
      return p.subcategoriesMap.values();
    }

    return {
      month: `${year}-${String(monthZeroIndexed + 1).padStart(2, '0')}`,
      type: query.type,
      cardDateMode: query.cardDateMode,
      includePending: query.includePending === 'true',
      total: Number(totalGeneral.toFixed(2)),
      clearedTotal: Number(totalClearedGeneral.toFixed(2)),
      pendingTotal: Number(totalPendingGeneral.toFixed(2)),
      transactionCount: totalTxCount,
      categories: categoriesResult,
    };
  });
}
