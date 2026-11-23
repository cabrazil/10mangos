import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TransferKind, TransactionType, TransactionStatus, AccountType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function transferRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Listar transferências do workspace
  app.get('/', async (request) => {
    const { workspaceId } = request.user;

    const transfers = await prisma.transfer.findMany({
      where: { workspaceId },
      include: {
        fromTransaction: { include: { account: true } },
        toTransaction: { include: { account: true } },
        invoice: true,
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    return transfers;
  });

  // Criar transferência entre contas (ou pagamento de fatura de cartão)
  app.post('/', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;

    const createTransferSchema = z.object({
      fromAccountId: z.string().uuid(),
      toAccountId: z.string().uuid(),
      amount: z.number().positive('O valor deve ser positivo'),
      date: z.string(), // ISO Date YYYY-MM-DD
      description: z.string().optional(),
      kind: z.nativeEnum(TransferKind).default(TransferKind.TRANSFER),
      invoiceId: z.string().uuid().optional(),
      isPending: z.boolean().default(false), // true para agendamento futuro
    });

    const data = createTransferSchema.parse(request.body);

    if (data.fromAccountId === data.toAccountId) {
      return reply.status(400).send({ error: 'A conta de origem e destino não podem ser as mesmas' });
    }

    const [fromAccount, toAccount] = await Promise.all([
      prisma.account.findFirst({ where: { id: data.fromAccountId, workspaceId } }),
      prisma.account.findFirst({ where: { id: data.toAccountId, workspaceId } }),
    ]);

    if (!fromAccount || !toAccount) {
      return reply.status(404).send({ error: 'Uma das contas não foi encontrada' });
    }

    const transferDate = new Date(data.date);
    const status = data.isPending ? TransactionStatus.PENDING : TransactionStatus.CLEARED;
    const defaultDesc =
      data.kind === TransferKind.INVOICE_PAYMENT
        ? `Pagamento de Fatura - ${toAccount.name}`
        : `Transferência de ${fromAccount.name} para ${toAccount.name}`;

    const description = data.description || defaultDesc;

    // Criar a transferência e os dois lançamentos atomicamente
    const transfer = await prisma.$transaction(async (tx) => {
      // 1. Lançamento de saída (negativo)
      const fromTx = await tx.transaction.create({
        data: {
          workspaceId,
          accountId: fromAccount.id,
          type: TransactionType.TRANSFER,
          status,
          amount: -data.amount,
          date: transferDate,
          description,
          createdById: userId,
        },
      });

      // 2. Lançamento de entrada (positivo)
      const toTx = await tx.transaction.create({
        data: {
          workspaceId,
          accountId: toAccount.id,
          type: TransactionType.TRANSFER,
          status,
          amount: data.amount,
          date: transferDate,
          description,
          createdById: userId,
        },
      });

      // 3. Registro da transferência ligando ambos
      const newTransfer = await tx.transfer.create({
        data: {
          workspaceId,
          kind: data.kind,
          fromTransactionId: fromTx.id,
          toTransactionId: toTx.id,
          amount: data.amount,
          date: transferDate,
          description,
          invoiceId: data.invoiceId,
        },
        include: {
          fromTransaction: { include: { account: true } },
          toTransaction: { include: { account: true } },
          invoice: true,
        },
      });

      return newTransfer;
    });

    return reply.status(201).send(transfer);
  });
}
