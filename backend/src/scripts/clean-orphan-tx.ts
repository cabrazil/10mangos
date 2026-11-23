import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanOrphan() {
  const orphan = await prisma.transaction.findUnique({
    where: { id: '1da58eba-7736-4715-bd0c-832af5dc4ad6' },
    include: { account: true },
  });

  if (orphan) {
    console.log(`🧹 Transação órfã encontrada: ${orphan.id} (${orphan.description}, R$ ${orphan.amount}) na conta ${orphan.account?.name}`);
    await prisma.transaction.delete({
      where: { id: orphan.id },
    });
    console.log(`✅ Transação órfã removida com sucesso!`);
  } else {
    console.log(`ℹ️ Nenhuma transação órfã com esse ID encontrada.`);
  }

  // Recalcular saldos para garantir integridade
  const accounts = await prisma.account.findMany();
  for (const acc of accounts) {
    await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${acc.id}'::uuid);`);
  }
  console.log(`✅ Saldos de todas as contas recalculados!`);
}

cleanOrphan()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
