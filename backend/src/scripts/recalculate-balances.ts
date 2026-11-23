import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixBalances() {
  console.log('🔧 Recalculando saldos pelo banco de dados...');

  // Chamar a função de recálculo nativa do banco para cada conta
  const accounts = await prisma.account.findMany({
    orderBy: { name: 'asc' },
  });
  for (const acc of accounts) {
    await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${acc.id}'::uuid);`);
  }

  const updatedAccounts = await prisma.account.findMany({
    orderBy: { name: 'asc' },
  });
  const txCount = await prisma.transaction.count();

  console.log(`\n✅ Recalculado com sucesso! (Total de lançamentos no banco: ${txCount})\n`);
  for (const acc of updatedAccounts) {
    console.log(`🏦 ${acc.name.padEnd(16)} | Inicial: R$ ${acc.initialBalance.toFixed(2).padStart(10)} | Atual: R$ ${acc.currentBalance.toFixed(2).padStart(10)} | Projetado: R$ ${acc.projectedBalance.toFixed(2).padStart(10)}`);
  }
}

fixBalances()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
