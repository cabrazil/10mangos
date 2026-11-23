import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspectItau() {
  const itau = await prisma.account.findFirst({
    where: { name: 'Itau PF' },
  });

  if (!itau) {
    console.log('Conta Itau PF não encontrada');
    return;
  }

  const transactions = await prisma.transaction.findMany({
    where: { accountId: itau.id },
    orderBy: { date: 'asc' },
  });

  console.log('====================================================');
  console.log(`🏦 Conta: ${itau.name}`);
  console.log(`Saldo Inicial: R$ ${itau.initialBalance}`);
  console.log(`Saldo Atual:   R$ ${itau.currentBalance}`);
  console.log(`Saldo Projet.: R$ ${itau.projectedBalance}`);
  console.log(`Total Lançamentos: ${transactions.length}`);
  console.log('====================================================');

  let sumAll = 0;
  let sumCleared = 0;
  for (const t of transactions) {
    sumAll += Number(t.amount);
    if (t.status === 'CLEARED' || t.status === 'RECONCILED') {
      sumCleared += Number(t.amount);
    }
  }

  console.log(`Soma de todos: R$ ${sumAll.toFixed(2)}`);
  console.log(`Soma efetivados: R$ ${sumCleared.toFixed(2)}`);
  console.log(`Saldo Inicial + Soma: R$ ${(Number(itau.initialBalance) + sumCleared).toFixed(2)}`);
  console.log('----------------------------------------------------');
  console.log('Últimos 10 lançamentos:');
  for (const t of transactions.slice(-10)) {
    console.log(`${t.date.toISOString().split('T')[0]} | ${t.amount.toString().padStart(9)} | ${t.status} | ${t.description}`);
  }
}

inspectItau()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
