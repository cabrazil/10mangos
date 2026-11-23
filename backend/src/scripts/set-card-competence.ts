import { prisma } from '../lib/prisma.js';

async function main() {
  // Buscar todas as contas de cartão de crédito
  const creditCards = await prisma.account.findMany({
    where: { type: 'CREDIT_CARD' },
  });

  console.log(`Encontradas ${creditCards.length} contas de cartão de crédito.`);

  for (const card of creditCards) {
    // Buscar transações nos dias 28, 29, 30 e 31 de Outubro de 2026
    const octTxs = await prisma.transaction.findMany({
      where: {
        accountId: card.id,
        date: {
          gte: new Date('2026-10-28T00:00:00.000Z'),
          lte: new Date('2026-10-31T23:59:59.999Z'),
        },
      },
    });

    console.log(`Cartão [${card.name}]: ${octTxs.length} transações no final de Outubro/2026.`);
    for (const tx of octTxs) {
      console.log(`- Atualizando ${tx.date.toISOString().split('T')[0]} | ${tx.description} | R$ ${tx.amount} -> competenceDate: 2026-11-01`);
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          competenceDate: new Date('2026-11-01T12:00:00.000Z'),
        },
      });
    }
  }

  console.log('Migração de competência de faturas concluída com sucesso!');
}

main()
  .catch((e) => {
    console.error('Erro na migração:', e.message);
  })
  .finally(() => prisma.$disconnect());
