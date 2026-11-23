import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDetails() {
  const itau = await prisma.account.findFirst({
    where: { name: 'Itau PF' },
  });
  if (!itau) return;

  const batches = await prisma.importBatch.findMany({
    where: { accountId: itau.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log('Import Batches:', batches);

  const transactions = await prisma.transaction.findMany({
    where: { accountId: itau.id },
    orderBy: { date: 'asc' },
  });

  console.log('\n--- TODOS OS 41 LANÇAMENTOS ---');
  let running = Number(itau.initialBalance);
  console.log(`[INÍCIO] Saldo Inicial: ${running.toFixed(2)}`);

  for (const t of transactions) {
    running += Number(t.amount);
    console.log(`${t.date.toISOString().split('T')[0]} | ${t.amount.toString().padStart(9)} | Saldo: ${running.toFixed(2).padStart(10)} | ${t.description}`);
  }
}

checkDetails()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
