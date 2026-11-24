import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TransactionType, TransactionStatus, TransactionSource, AccountType, TransferKind, Frequency } from '@prisma/client';
import { addMonths, startOfMonth } from 'date-fns';
import { prisma } from '../lib/prisma.js';

function parseDateSafely(dateInput: string | Date | null | undefined): Date | undefined {
  if (!dateInput) return undefined;
  if (dateInput instanceof Date) return dateInput;
  const clean = dateInput.split('T')[0];
  const [y, m, d] = clean.split('-').map(Number);
  if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }
  return new Date(dateInput);
}

export function computeCardCompetenceDate(purchaseDate: Date, closingDay?: number | null): Date {
  const day = purchaseDate.getUTCDate();
  const year = purchaseDate.getUTCFullYear();
  const month = purchaseDate.getUTCMonth(); // 0-indexed

  // Se o dia da compra for maior ou igual ao dia de corte (fechamento):
  // compras a partir do corte entram na fatura do mês seguinte!
  const cutOff = closingDay && closingDay > 1 ? closingDay : 20;
  const isAfterClosing = day >= cutOff;

  return new Date(Date.UTC(year, isAfterClosing ? month + 1 : month, 1, 12, 0, 0));
}

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Listar lançamentos com filtros
  app.get('/', async (request) => {
    const { workspaceId } = request.user;

    const querySchema = z.object({
      accountId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
      status: z.nativeEnum(TransactionStatus).optional(),
      type: z.nativeEnum(TransactionType).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(50),
    });

    const query = querySchema.parse(request.query);

    const where: any = {
      workspaceId,
      ...(query.accountId && { accountId: query.accountId }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.status && { status: query.status }),
      ...(query.type && { type: query.type }),
    };

    if (query.startDate || query.endDate) {
      const startGte = query.startDate ? new Date(`${query.startDate.split('T')[0]}T00:00:00.000Z`) : undefined;
      const endLte = query.endDate ? new Date(`${query.endDate.split('T')[0]}T23:59:59.999Z`) : undefined;

      where.OR = [
        {
          competenceDate: {
            ...(startGte && { gte: startGte }),
            ...(endLte && { lte: endLte }),
          },
        },
        {
          competenceDate: null,
          date: {
            ...(startGte && { gte: startGte }),
            ...(endLte && { lte: endLte }),
          },
        },
      ];
    }

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, type: true, color: true, currency: true } },
          category: {
            select: {
              id: true,
              name: true,
              type: true,
              color: true,
              parent: { select: { id: true, name: true } },
            },
          },
          payee: { select: { id: true, name: true } },
          splits: { include: { category: true } },
          tags: true,
          transferFrom: {
            include: {
              toTransaction: {
                select: {
                  id: true,
                  accountId: true,
                  account: { select: { id: true, name: true, type: true, color: true, currency: true } },
                },
              },
            },
          },
          transferTo: {
            include: {
              fromTransaction: {
                select: {
                  id: true,
                  accountId: true,
                  account: { select: { id: true, name: true, type: true, color: true, currency: true } },
                },
              },
            },
          },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data: transactions,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });

  // Criar lançamento (avulso ou parcelado)
  app.post('/', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;

    const createTransactionSchema = z.object({
      accountId: z.string().uuid(),
      type: z.nativeEnum(TransactionType),
      amount: z.number(), // valor absoluto passado pelo cliente
      date: z.string(), // ISO string YYYY-MM-DD
      description: z.string().min(1),
      categoryId: z.string().uuid().optional(),
      payeeName: z.string().optional(),
      status: z.nativeEnum(TransactionStatus).default(TransactionStatus.CLEARED),
      notes: z.string().optional(),
      competenceDate: z.string().nullable().optional(),
      // Parcelamento opcional
      installments: z.number().int().min(1).max(120).default(1),
      // Lançamento fixo / recorrente
      isRecurring: z.boolean().default(false),
      recurringMonths: z.number().int().min(1).max(120).default(12),
    });

    const data = createTransactionSchema.parse(request.body);

    const account = await prisma.account.findFirst({
      where: { id: data.accountId, workspaceId },
    });

    if (!account) {
      return reply.status(400).send({ error: 'Conta não encontrada' });
    }

    // Gerenciar Payee se fornecido
    let payeeId: string | undefined = undefined;
    if (data.payeeName) {
      const payee = await prisma.payee.upsert({
        where: {
          workspaceId_name: {
            workspaceId,
            name: data.payeeName,
          },
        },
        update: {},
        create: {
          workspaceId,
          name: data.payeeName,
          defaultCategoryId: data.categoryId,
        },
      });
      payeeId = payee.id;
    }

    const transactionDate = parseDateSafely(data.date) || new Date();

    // REGRA DE SINAL:
    // Se for EXPENSE, amount DEVE ser negativo
    // Se for INCOME, amount DEVE ser positivo
    const signedAmount =
      data.type === TransactionType.EXPENSE
        ? -Math.abs(data.amount)
        : Math.abs(data.amount);

    // 1. Lançamento Fixo / Recorrente (Opção A: gera regra e projeções futuras como PENDING)
    if (data.isRecurring) {
      const months = data.recurringMonths || 12;
      const dayOfMonth = transactionDate.getUTCDate();

      const rule = await prisma.$transaction(async (tx) => {
        const recurringRule = await tx.recurringRule.create({
          data: {
            workspaceId,
            accountId: account.id,
            categoryId: data.categoryId,
            payeeId,
            type: data.type,
            description: data.description,
            amount: signedAmount,
            frequency: Frequency.MONTHLY,
            interval: 1,
            dayOfMonth,
            startDate: transactionDate,
            endDate: addMonths(transactionDate, months - 1),
            nextOccurrence: addMonths(transactionDate, 1),
            occurrencesLimit: months,
            occurrencesCount: 1,
            isActive: true,
          },
        });

        // Gerar as N ocorrências (o 1º lançamento com o status informado, os demais como PENDING)
        for (let i = 0; i < months; i++) {
          const occDate = addMonths(transactionDate, i);

          // Se for cartão, associar à fatura do mês correspondente
          let invoiceId: string | undefined = undefined;
          if (account.type === AccountType.CREDIT_CARD) {
            const refMonth = startOfMonth(occDate);
            let invoice = await tx.creditCardInvoice.findUnique({
              where: {
                accountId_referenceMonth: {
                  accountId: account.id,
                  referenceMonth: refMonth,
                },
              },
            });

            if (!invoice) {
              const closingDay = account.closingDay || 1;
              const dueDay = account.dueDay || 10;
              const closingDate = new Date(occDate.getFullYear(), occDate.getMonth(), closingDay);
              const dueDate = new Date(occDate.getFullYear(), occDate.getMonth(), dueDay);

              invoice = await tx.creditCardInvoice.create({
                data: {
                  workspaceId,
                  accountId: account.id,
                  referenceMonth: refMonth,
                  closingDate,
                  dueDate,
                  status: i === 0 ? 'OPEN' : 'FUTURE',
                },
              });
            }
            invoiceId = invoice.id;
          }

          await tx.transaction.create({
            data: {
              workspaceId,
              accountId: account.id,
              type: data.type,
              status: i === 0 ? data.status : TransactionStatus.PENDING,
              source: TransactionSource.RECURRING,
              amount: signedAmount,
              date: occDate,
              description: data.description,
              categoryId: data.categoryId,
              payeeId,
              invoiceId,
              recurringRuleId: recurringRule.id,
              createdById: userId,
              notes: data.notes,
            },
          });
        }

        return recurringRule;
      });

      return reply.status(201).send({
        message: 'Lançamento fixo e previsões geradas com sucesso',
        recurringRule: rule,
      });
    }

    // 2. Compra parcelada (com cartão ou carnê)
    if (data.installments > 1) {
      const totalAmount = Math.abs(data.amount);
      const installmentAmount = Number((totalAmount / data.installments).toFixed(2));
      const firstInstallmentAmount = Number(
        (totalAmount - installmentAmount * (data.installments - 1)).toFixed(2)
      );

      const plan = await prisma.$transaction(async (tx) => {
        const installmentPlan = await tx.installmentPlan.create({
          data: {
            workspaceId,
            accountId: account.id,
            categoryId: data.categoryId,
            payeeId,
            description: data.description,
            purchaseDate: transactionDate,
            firstDueMonth: startOfMonth(transactionDate),
            installmentCount: data.installments,
            installmentAmount,
            firstInstallmentAmount,
            totalAmount,
            remainingAmount: totalAmount,
            lastDueMonth: startOfMonth(addMonths(transactionDate, data.installments - 1)),
          },
        });

        // Gerar os N lançamentos
        for (let i = 1; i <= data.installments; i++) {
          const installmentDate = addMonths(transactionDate, i - 1);
          const currentAmount = i === 1 ? firstInstallmentAmount : installmentAmount;
          const installmentSignedAmount = data.type === TransactionType.EXPENSE ? -currentAmount : currentAmount;
          
          let competenceDate: Date | null = null;
          let invoiceId: string | undefined = undefined;

          if (account.type === AccountType.CREDIT_CARD) {
            competenceDate = computeCardCompetenceDate(installmentDate, account.closingDay);
            const refMonth = startOfMonth(competenceDate);
            let invoice = await tx.creditCardInvoice.findUnique({
              where: {
                accountId_referenceMonth: {
                  accountId: account.id,
                  referenceMonth: refMonth,
                },
              },
            });

            if (!invoice) {
              const closingDay = account.closingDay || 1;
              const dueDay = account.dueDay || 10;
              const closingDate = new Date(competenceDate.getFullYear(), competenceDate.getMonth(), closingDay);
              const dueDate = new Date(competenceDate.getFullYear(), competenceDate.getMonth(), dueDay);

              invoice = await tx.creditCardInvoice.create({
                data: {
                  workspaceId,
                  accountId: account.id,
                  referenceMonth: refMonth,
                  closingDate,
                  dueDate,
                  status: i === 1 ? 'OPEN' : 'FUTURE',
                },
              });
            }
            invoiceId = invoice.id;
          }

          await tx.transaction.create({
            data: {
              workspaceId,
              accountId: account.id,
              type: data.type,
              status: i === 1 ? data.status : TransactionStatus.PENDING,
              source: TransactionSource.INSTALLMENT,
              amount: installmentSignedAmount,
              date: installmentDate,
              competenceDate,
              description: `${data.description} (${i}/${data.installments})`,
              categoryId: data.categoryId,
              payeeId,
              invoiceId,
              installmentPlanId: installmentPlan.id,
              installmentNumber: i,
              createdById: userId,
              notes: data.notes,
            },
          });
        }

        return installmentPlan;
      });

      return reply.status(201).send({
        message: 'Compra parcelada registrada com sucesso',
        installmentPlan: plan,
      });
    }

    // 2. Lançamento simples (avulso)
    let invoiceId: string | undefined = undefined;
    let competenceDate: Date | null = data.competenceDate ? parseDateSafely(data.competenceDate) || null : null;

    if (account.type === AccountType.CREDIT_CARD) {
      if (!competenceDate) {
        competenceDate = computeCardCompetenceDate(transactionDate, account.closingDay);
      }
      const refMonth = startOfMonth(competenceDate);
      let invoice = await prisma.creditCardInvoice.findUnique({
        where: {
          accountId_referenceMonth: {
            accountId: account.id,
            referenceMonth: refMonth,
          },
        },
      });

      if (!invoice) {
        const closingDay = account.closingDay || 1;
        const dueDay = account.dueDay || 10;
        const closingDate = new Date(competenceDate.getFullYear(), competenceDate.getMonth(), closingDay);
        const dueDate = new Date(competenceDate.getFullYear(), competenceDate.getMonth(), dueDay);

        invoice = await prisma.creditCardInvoice.create({
          data: {
            workspaceId,
            accountId: account.id,
            referenceMonth: refMonth,
            closingDate,
            dueDate,
            status: 'OPEN',
          },
        });
      }
      invoiceId = invoice.id;
    }

    const transaction = await prisma.transaction.create({
      data: {
        workspaceId,
        accountId: account.id,
        type: data.type,
        status: data.status,
        amount: signedAmount,
        date: transactionDate,
        description: data.description,
        categoryId: data.categoryId,
        payeeId,
        invoiceId,
        competenceDate,
        notes: data.notes,
        createdById: userId,
      },
      include: {
        account: true,
        category: true,
      },
    });

    return reply.status(201).send(transaction);
  });

  // Atualizar lançamento
  app.put('/:id', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const updateTransactionSchema = z.object({
      description: z.string().optional(),
      amount: z.number().optional(),
      type: z.nativeEnum(TransactionType).optional(),
      status: z.nativeEnum(TransactionStatus).optional(),
      categoryId: z.string().uuid().nullable().optional(),
      notes: z.string().optional(),
      date: z.string().optional(),
      competenceDate: z.string().nullable().optional(),
      toAccountId: z.string().uuid().optional(), // Para converter em transferência entre contas
      isRecurring: z.boolean().optional(),
      recurringMonths: z.number().int().min(1).max(120).optional(),
      installments: z.number().int().min(1).max(120).optional(),
    });

    const data = updateTransactionSchema.parse(request.body);

    const existing = await prisma.transaction.findFirst({
      where: { id, workspaceId },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Lançamento não encontrado' });
    }

    if (existing.status === TransactionStatus.RECONCILED && data.status !== TransactionStatus.CLEARED) {
      return reply.status(400).send({
        error: 'Lançamento já conciliado. Altere para CLEARED antes de editar valor ou data.',
      });
    }

    let updatedAmount = undefined;
    if (data.amount !== undefined) {
      if (data.type === TransactionType.EXPENSE) {
        updatedAmount = -Math.abs(data.amount);
      } else if (data.type === TransactionType.INCOME) {
        updatedAmount = Math.abs(data.amount);
      } else if (data.type === TransactionType.TRANSFER) {
        // Se for transferência, mantém o sinal do lançamento original
        // Se era débito (-), permanece débito (-)
        const wasNegative = Number(existing.amount) < 0;
        updatedAmount = wasNegative ? -Math.abs(data.amount) : Math.abs(data.amount);
      } else {
        const wasNegative = Number(existing.amount) < 0;
        updatedAmount = wasNegative ? -Math.abs(data.amount) : Math.abs(data.amount);
      }
    }

    const finalAmount = updatedAmount !== undefined ? updatedAmount : Number(existing.amount);
    const finalDate = data.date ? (parseDateSafely(data.date) || existing.date) : existing.date;
    const finalStatus = data.status || existing.status;

    let updatedResult;

    // Se mudou de TRANSFER para outro tipo (EXPENSE / INCOME), desvincula e remove contrapartida
    if (existing.type === TransactionType.TRANSFER && data.type && data.type !== TransactionType.TRANSFER) {
      const transferToClean = await prisma.transfer.findFirst({
        where: {
          OR: [{ fromTransactionId: existing.id }, { toTransactionId: existing.id }],
        },
      });
      if (transferToClean) {
        const counterpartId = transferToClean.fromTransactionId === existing.id
          ? transferToClean.toTransactionId
          : transferToClean.fromTransactionId;
        await prisma.transfer.delete({ where: { id: transferToClean.id } });
        await prisma.transaction.delete({ where: { id: counterpartId } }).catch(() => {});
      }
    }

    // Se solicitado conversão em transferência entre contas, executa tudo em transação atômica
    if (data.type === TransactionType.TRANSFER && data.toAccountId) {
      const destinationAccount = await prisma.account.findFirst({
        where: { id: data.toAccountId, workspaceId },
      });

      if (!destinationAccount) {
        return reply.status(404).send({ error: 'Conta de destino não encontrada' });
      }

      updatedResult = await prisma.$transaction(async (tx) => {
        const updated = await tx.transaction.update({
          where: { id },
          data: {
            ...(data.description && { description: data.description }),
            ...(data.notes !== undefined && { notes: data.notes }),
            status: finalStatus,
            type: TransactionType.TRANSFER,
            categoryId: null, // transferência não possui categoria de despesa
            date: finalDate,
            amount: finalAmount,
            updatedById: userId,
          },
        });

        const existingTransfer = await tx.transfer.findFirst({
          where: {
            OR: [{ fromTransactionId: existing.id }, { toTransactionId: existing.id }],
          },
        });

        if (!existingTransfer) {
          const transferAmount = Math.abs(finalAmount);
          const isDebit = finalAmount < 0;

          if (isDebit) {
            // Lançamento atual é a saída (-) no Itaú. Cria a entrada (+) no destino:
            const toTx = await tx.transaction.create({
              data: {
                workspaceId,
                accountId: destinationAccount.id,
                type: TransactionType.TRANSFER,
                status: finalStatus,
                amount: transferAmount,
                date: finalDate,
                description: data.description || `Transferência recebida de ${destinationAccount.name}`,
                createdById: userId,
              },
            });

            await tx.transfer.create({
              data: {
                workspaceId,
                kind: TransferKind.TRANSFER,
                fromTransactionId: existing.id,
                toTransactionId: toTx.id,
                amount: transferAmount,
                date: finalDate,
                description: data.description || existing.description,
              },
            });
          } else {
            // Lançamento atual é a entrada (+) no Itaú. Cria a saída (-) no destino:
            const fromTx = await tx.transaction.create({
              data: {
                workspaceId,
                accountId: destinationAccount.id,
                type: TransactionType.TRANSFER,
                status: finalStatus,
                amount: -transferAmount,
                date: finalDate,
                description: data.description || `Transferência enviada para ${destinationAccount.name}`,
                createdById: userId,
              },
            });

            await tx.transfer.create({
              data: {
                workspaceId,
                kind: TransferKind.TRANSFER,
                fromTransactionId: fromTx.id,
                toTransactionId: existing.id,
                amount: transferAmount,
                date: finalDate,
                description: data.description || existing.description,
              },
            });
          }
        } else {
          // Já existe transferência associada: sincroniza a contrapartida e o registro de transferência
          const transferAmount = Math.abs(finalAmount);
          const isDebit = finalAmount < 0;
          const counterpartId = existingTransfer.fromTransactionId === existing.id
            ? existingTransfer.toTransactionId
            : existingTransfer.fromTransactionId;

          await tx.transaction.update({
            where: { id: counterpartId },
            data: {
              accountId: destinationAccount.id,
              amount: isDebit ? transferAmount : -transferAmount,
              date: finalDate,
              status: finalStatus,
              ...(data.description && { description: data.description }),
              updatedById: userId,
            },
          });

          await tx.transfer.update({
            where: { id: existingTransfer.id },
            data: {
              amount: transferAmount,
              date: finalDate,
              ...(data.description && { description: data.description }),
            },
          });
        }

        return updated;
      });
    } else if (data.isRecurring && !existing.recurringRuleId) {
      const months = data.recurringMonths || 12;
      const dayOfMonth = finalDate.getUTCDate();

      updatedResult = await prisma.$transaction(async (tx) => {
        const recurringRule = await tx.recurringRule.create({
          data: {
            workspaceId,
            accountId: existing.accountId,
            categoryId: data.categoryId !== undefined ? data.categoryId : existing.categoryId,
            payeeId: existing.payeeId,
            type: data.type || existing.type,
            description: data.description || existing.description,
            amount: finalAmount,
            frequency: Frequency.MONTHLY,
            interval: 1,
            dayOfMonth,
            startDate: finalDate,
            endDate: addMonths(finalDate, months - 1),
            nextOccurrence: addMonths(finalDate, 1),
            occurrencesLimit: months,
            occurrencesCount: 1,
            isActive: true,
          },
        });

        const updated = await tx.transaction.update({
          where: { id },
          data: {
            ...(data.description && { description: data.description }),
            ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
            ...(data.notes !== undefined && { notes: data.notes }),
            status: finalStatus,
            type: data.type || existing.type,
            date: finalDate,
            amount: finalAmount,
            source: TransactionSource.RECURRING,
            recurringRuleId: recurringRule.id,
            updatedById: userId,
          },
        });

        // Gerar meses futuros (i = 1 até months - 1) como PENDING
        for (let i = 1; i < months; i++) {
          const occDate = addMonths(finalDate, i);
          await tx.transaction.create({
            data: {
              workspaceId,
              accountId: existing.accountId,
              type: data.type || existing.type,
              status: TransactionStatus.PENDING,
              source: TransactionSource.RECURRING,
              amount: finalAmount,
              date: occDate,
              description: data.description || existing.description,
              categoryId: data.categoryId !== undefined ? data.categoryId : existing.categoryId,
              payeeId: existing.payeeId,
              recurringRuleId: recurringRule.id,
              createdById: userId,
              notes: data.notes || existing.notes,
            },
          });
        }

        return updated;
      });
    } else if (data.installments && data.installments > 1 && !existing.installmentPlanId) {
      const existingAccount = await prisma.account.findUnique({ where: { id: existing.accountId } });
      const isCard = existingAccount?.type === AccountType.CREDIT_CARD;
      const closingDay = existingAccount?.closingDay;

      const totalAmount = Math.abs(finalAmount);
      const installmentCount = data.installments;
      const installmentAmount = Number((totalAmount / installmentCount).toFixed(2));
      const firstInstallmentAmount = Number(
        (totalAmount - installmentAmount * (installmentCount - 1)).toFixed(2)
      );
      const isExpense = (data.type || existing.type) === TransactionType.EXPENSE;
      const firstSigned = isExpense ? -firstInstallmentAmount : firstInstallmentAmount;
      const otherSigned = isExpense ? -installmentAmount : installmentAmount;

      const firstCompDate = isCard ? computeCardCompetenceDate(finalDate, closingDay) : (data.competenceDate ? parseDateSafely(data.competenceDate) || null : null);

      updatedResult = await prisma.$transaction(async (tx) => {
        const plan = await tx.installmentPlan.create({
          data: {
            workspaceId,
            accountId: existing.accountId,
            categoryId: data.categoryId !== undefined ? data.categoryId : existing.categoryId,
            payeeId: existing.payeeId,
            description: data.description || existing.description,
            purchaseDate: finalDate,
            firstDueMonth: startOfMonth(firstCompDate || finalDate),
            installmentCount,
            installmentAmount,
            firstInstallmentAmount,
            totalAmount,
            remainingAmount: totalAmount,
            lastDueMonth: startOfMonth(addMonths(firstCompDate || finalDate, installmentCount - 1)),
          },
        });

        const updated = await tx.transaction.update({
          where: { id },
          data: {
            description: `${data.description || existing.description} (1/${installmentCount})`,
            ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
            ...(data.notes !== undefined && { notes: data.notes }),
            status: finalStatus,
            type: data.type || existing.type,
            date: finalDate,
            competenceDate: firstCompDate,
            amount: firstSigned,
            source: TransactionSource.INSTALLMENT,
            installmentPlanId: plan.id,
            installmentNumber: 1,
            updatedById: userId,
          },
        });

        for (let i = 2; i <= installmentCount; i++) {
          const installmentDate = addMonths(finalDate, i - 1);
          const installmentCompDate = isCard ? computeCardCompetenceDate(installmentDate, closingDay) : null;

          await tx.transaction.create({
            data: {
              workspaceId,
              accountId: existing.accountId,
              type: data.type || existing.type,
              status: TransactionStatus.PENDING,
              source: TransactionSource.INSTALLMENT,
              amount: otherSigned,
              date: installmentDate,
              competenceDate: installmentCompDate,
              description: `${data.description || existing.description} (${i}/${installmentCount})`,
              categoryId: data.categoryId !== undefined ? data.categoryId : existing.categoryId,
              payeeId: existing.payeeId,
              installmentPlanId: plan.id,
              installmentNumber: i,
              createdById: userId,
              notes: data.notes || existing.notes,
            },
          });
        }

        return updated;
      });
    } else {
      updatedResult = await prisma.transaction.update({
        where: { id },
        data: {
          ...(data.description && { description: data.description }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.status && { status: data.status }),
          ...(data.type && { type: data.type }),
          ...(data.date && { date: parseDateSafely(data.date) }),
          ...(data.competenceDate !== undefined && { competenceDate: data.competenceDate ? parseDateSafely(data.competenceDate) : null }),
          ...(updatedAmount !== undefined && { amount: updatedAmount }),
          updatedById: userId,
        },
      });
    }

    const finalResult = await prisma.transaction.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, type: true, color: true, currency: true } },
        category: {
          select: {
            id: true,
            name: true,
            type: true,
            color: true,
            parent: { select: { id: true, name: true } },
          },
        },
        transferFrom: {
          include: {
            toTransaction: {
              select: {
                id: true,
                accountId: true,
                account: { select: { id: true, name: true, type: true, color: true, currency: true } },
              },
            },
          },
        },
        transferTo: {
          include: {
            fromTransaction: {
              select: {
                id: true,
                accountId: true,
                account: { select: { id: true, name: true, type: true, color: true, currency: true } },
              },
            },
          },
        },
      },
    });

    return finalResult || updatedResult;
  });

  // Excluir lançamento
  app.delete('/:id', async (request, reply) => {
    const { workspaceId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const existing = await prisma.transaction.findFirst({
      where: { id, workspaceId },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Lançamento não encontrado' });
    }

    if (existing.status === TransactionStatus.RECONCILED) {
      return reply.status(400).send({ error: 'Lançamento conciliado não pode ser excluído.' });
    }

    // Se é uma transferência vinculada, remove também o registro de transferência e a contrapartida
    const existingTransfer = await prisma.transfer.findFirst({
      where: {
        OR: [{ fromTransactionId: existing.id }, { toTransactionId: existing.id }],
      },
    });

    if (existingTransfer) {
      const counterpartId = existingTransfer.fromTransactionId === existing.id
        ? existingTransfer.toTransactionId
        : existingTransfer.fromTransactionId;
      await prisma.transfer.delete({ where: { id: existingTransfer.id } });
      await prisma.transaction.delete({ where: { id: counterpartId } }).catch(() => {});
    }

    await prisma.transaction.delete({ where: { id } });

    return reply.status(204).send();
  });
}
