import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetTransactions() {
  console.log('🧹 Limpando lançamentos, transferências e histórico de importações...');

  // Deletar em ordem respeitando as chaves estrangeiras
  await prisma.transactionSplit.deleteMany({});
  await prisma.transfer.deleteMany({});
  await prisma.reconciliationMatch.deleteMany({});
  await prisma.bankReconciliation.deleteMany({});
  await prisma.importRow.deleteMany({});
  await prisma.importBatch.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.installmentPlan.deleteMany({});

  // Recalcular saldos de todas as contas usando a função nativa do Postgres
  const accounts = await prisma.account.findMany();
  for (const acc of accounts) {
    await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${acc.id}'::uuid);`);
  }

  console.log('✅ Todos os lançamentos foram zerados com sucesso!');
  console.log('🛡️ Usuários, categorias, contas e cartões foram 100% preservados.');
}

resetTransactions()
  .catch((e) => {
    console.error('❌ Erro ao zerar lançamentos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
