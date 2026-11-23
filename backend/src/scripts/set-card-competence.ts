import { prisma } from '../lib/prisma.js';

async function main() {
  const accounts = await prisma.account.findMany();
  console.log('--- TODAS AS CONTAS ---');
  for (const a of accounts) {
    const count = await prisma.transaction.count({ where: { accountId: a.id } });
    console.log(`[${a.name}] (Tipo: ${a.type}) -> ${count} transações`);
  }

  console.log('\n--- DETALHES DAS TRANSAÇÕES DOS CARTÕES ---');
  const cards = accounts.filter(a => a.type === 'CREDIT_CARD');
  for (const card of cards) {
    const txs = await prisma.transaction.findMany({
      where: { accountId: card.id },
      orderBy: { date: 'asc' },
    });
    console.log(`\nCartão [${card.name}] (Total: ${txs.length} transações):`);
    for (const t of txs) {
      console.log(`  - ID: ${t.id} | Date: ${t.date.toISOString().split('T')[0]} | CompDate: ${t.competenceDate?.toISOString()?.split('T')[0] || 'null'} | Valor: ${t.amount} | Desc: ${t.description}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Erro:', e.message);
  })
  .finally(() => prisma.$disconnect());
