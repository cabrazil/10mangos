import { prisma } from '../lib/prisma.js';

async function fixPaymentType() {
  const account = await prisma.account.findFirst({ where: { name: 'Nu Ultravioleta' } });
  if (!account) return;

  const paymentTx = await prisma.transaction.findFirst({
    where: {
      accountId: account.id,
      description: { contains: 'Pagamento recebido' },
    },
  });

  if (paymentTx) {
    await prisma.transaction.update({
      where: { id: paymentTx.id },
      data: {
        type: 'TRANSFER',
        amount: Math.abs(Number(paymentTx.amount)),
      },
    });
    console.log(`✅ Pagamento recebido atualizado para TRANSFER com valor +${Math.abs(Number(paymentTx.amount))}`);
  }
}

fixPaymentType()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
