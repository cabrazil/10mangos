import { PrismaClient, TransactionType, TransferKind } from '@prisma/client';

const prisma = new PrismaClient();

async function fixAndReconcile() {
  const tx = await prisma.transaction.findUnique({
    where: { id: 'ef198b91-ab90-4eb1-81ba-d872c1276343' },
  });

  if (tx) {
    console.log(`Corrigindo lançamento ${tx.id} de R$ ${tx.amount} para -R$ 7575...`);
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        amount: -7575,
        type: TransactionType.EXPENSE,
      },
    });
  }

  // Recalcular saldos de todas as contas
  const accounts = await prisma.account.findMany();
  for (const acc of accounts) {
    await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${acc.id}'::uuid);`);
  }

  const itau = await prisma.account.findFirst({ where: { name: 'Itau PF' } });
  console.log(`🏦 Itau PF: Saldo Atual = R$ ${itau?.currentBalance}`);
}

fixAndReconcile()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
