import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { TransactionType, TransactionStatus, AccountType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Resumo Geral do Mês (Dashboard Principal)
  app.get('/monthly-summary', async (request) => {
    const { workspaceId } = request.user;
    const { month } = z.object({ month: z.string().optional() }).parse(request.query);

    const refDate = month ? new Date(month) : new Date();
    const periodStart = startOfMonth(refDate);
    const periodEnd = endOfMonth(refDate);

    // Lançamentos efetivados do mês
    const clearedTransactions = await prisma.transaction.findMany({
      where: {
        workspaceId,
        status: { in: [TransactionStatus.CLEARED, TransactionStatus.RECONCILED] },
        date: { gte: periodStart, lte: periodEnd },
      },
    });

    // Lançamentos previstos do mês
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
    const netResultProjected = (incomeCleared + incomePending) - (expenseCleared + expensePending);
    const savingsRate = incomeCleared > 0 ? Number(((netResultCleared / incomeCleared) * 100).toFixed(2)) : 0;

    // Posição patrimonial atual
    const accounts = await prisma.account.findMany({
      where: { workspaceId, isArchived: false, includeInTotals: true },
    });

    const cashBalance = accounts
      .filter((a) => a.type === AccountType.CHECKING || a.type === AccountType.SAVINGS || a.type === AccountType.CASH || a.type === AccountType.DIGITAL_WALLET)
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

  // Demonstrativo por Categoria (Gráfico de Pizza / DRE Pessoal)
  app.get('/by-category', async (request) => {
    const { workspaceId } = request.user;
    const { month, type } = z
      .object({
        month: z.string().optional(),
        type: z.nativeEnum(TransactionType).default(TransactionType.EXPENSE),
      })
      .parse(request.query);

    const refDate = month ? new Date(month) : new Date();
    const periodStart = startOfMonth(refDate);
    const periodEnd = endOfMonth(refDate);

    const transactions = await prisma.transaction.findMany({
      where: {
        workspaceId,
        type,
        status: { in: [TransactionStatus.CLEARED, TransactionStatus.RECONCILED] },
        date: { gte: periodStart, lte: periodEnd },
        categoryId: { not: null },
      },
      include: {
        category: {
          include: {
            parent: true,
          },
        },
      },
    });

    // Agrupar por categoria principal (pai) e subcategoria
    const categoryMap = new Map<string, { id: string; name: string; color: string | null; total: number; count: number }>();
    let totalGeneral = 0;

    for (const tx of transactions) {
      if (!tx.category) continue;
      const amount = Math.abs(Number(tx.amount));
      totalGeneral += amount;

      // Agrupa pelo pai se existir, senão pela própria categoria
      const groupCategory = tx.category.parent || tx.category;
      const key = groupCategory.id;

      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          id: groupCategory.id,
          name: groupCategory.name,
          color: groupCategory.color,
          total: 0,
          count: 0,
        });
      }

      const current = categoryMap.get(key)!;
      current.total += amount;
      current.count += 1;
    }

    const categoriesArray = Array.from(categoryMap.values()).map((cat) => ({
      ...cat,
      total: Number(cat.total.toFixed(2)),
      percentage: totalGeneral > 0 ? Number(((cat.total / totalGeneral) * 100).toFixed(2)) : 0,
    }));

    categoriesArray.sort((a, b) => b.total - a.total);

    return {
      month: format(periodStart, 'yyyy-MM'),
      type,
      total: Number(totalGeneral.toFixed(2)),
      categories: categoriesArray,
    };
  });
}
