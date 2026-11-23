import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountType, InvestmentType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Listar todas as contas do workspace atual
  app.get('/', async (request) => {
    const { workspaceId } = request.user;

    const accounts = await prisma.account.findMany({
      where: {
        workspaceId,
        isArchived: false,
      },
      orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });

    // Totais de patrimônio e saldo
    const totalChecking = accounts
      .filter((a) => a.type === AccountType.CHECKING || a.type === AccountType.SAVINGS || a.type === AccountType.CASH || a.type === AccountType.DIGITAL_WALLET)
      .reduce((acc, curr) => acc + Number(curr.currentBalance), 0);

    const totalInvestments = accounts
      .filter((a) => a.type === AccountType.INVESTMENT)
      .reduce((acc, curr) => acc + Number(curr.currentBalance), 0);

    const totalCreditCardDebt = accounts
      .filter((a) => a.type === AccountType.CREDIT_CARD)
      .reduce((acc, curr) => acc + Math.abs(Math.min(0, Number(curr.currentBalance))), 0);

    const netWorth = totalChecking + totalInvestments - totalCreditCardDebt;

    return {
      accounts,
      summary: {
        totalChecking,
        totalInvestments,
        totalCreditCardDebt,
        netWorth,
      },
    };
  });

  // Obter detalhes de uma conta específica
  app.get('/:id', async (request, reply) => {
    const { workspaceId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const account = await prisma.account.findFirst({
      where: { id, workspaceId },
      include: {
        invoices: {
          orderBy: { referenceMonth: 'desc' },
          take: 6,
        },
      },
    });

    if (!account) {
      return reply.status(404).send({ error: 'Conta não encontrada' });
    }

    return account;
  });

  // Criar nova conta
  app.post('/', async (request, reply) => {
    const { workspaceId } = request.user;

    const createAccountSchema = z.object({
      name: z.string().min(1, 'Nome é obrigatório'),
      type: z.nativeEnum(AccountType),
      currency: z.string().default('BRL'),
      initialBalance: z.number().default(0),
      institutionName: z.string().optional(),
      bankCode: z.string().optional(),
      branch: z.string().optional(),
      accountNumber: z.string().optional(),
      ofxBankId: z.string().optional(),
      ofxAccountId: z.string().optional(),
      // Cartão de crédito
      creditLimit: z.number().optional(),
      closingDay: z.number().min(1).max(31).optional(),
      dueDay: z.number().min(1).max(31).optional(),
      cardBrand: z.string().optional(),
      lastFourDigits: z.string().max(4).optional(),
      paymentAccountId: z.string().uuid().optional(),
      // Investimento
      investmentType: z.nativeEnum(InvestmentType).optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
    });

    const data = createAccountSchema.parse(request.body);

    const account = await prisma.account.create({
      data: {
        workspaceId,
        ...data,
      },
    });

    return reply.status(201).send(account);
  });

  // Atualizar conta
  app.put('/:id', async (request, reply) => {
    const { workspaceId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const updateAccountSchema = z.object({
      name: z.string().min(1).optional(),
      initialBalance: z.number().optional(),
      institutionName: z.string().optional(),
      bankCode: z.string().optional(),
      branch: z.string().optional(),
      accountNumber: z.string().optional(),
      creditLimit: z.number().optional(),
      closingDay: z.number().min(1).max(31).optional(),
      dueDay: z.number().min(1).max(31).optional(),
      paymentAccountId: z.string().uuid().nullable().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      isArchived: z.boolean().optional(),
    });

    const data = updateAccountSchema.parse(request.body);

    const account = await prisma.account.updateMany({
      where: { id, workspaceId },
      data,
    });

    if (account.count === 0) {
      return reply.status(404).send({ error: 'Conta não encontrada' });
    }

    const updated = await prisma.account.findUnique({ where: { id } });
    return updated;
  });
}
