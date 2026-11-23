import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTx() {
  const tx = await prisma.transaction.findUnique({
    where: { id: 'ef198b91-ab90-4eb1-81ba-d872c1276343' },
    include: { account: true },
  });

  console.log('Transação ef198b91:', tx);
}

checkTx()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
