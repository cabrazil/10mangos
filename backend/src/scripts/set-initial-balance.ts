import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function setInitialBalances() {
  console.log('📌 Configurando saldos iniciais em 31/10/2026...');

  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });

  if (!workspace) {
    throw new Error('Workspace Pessoal não encontrado');
  }

  // 1. Conta Itau PF
  await prisma.account.updateMany({
    where: {
      workspaceId: workspace.id,
      name: 'Itau PF',
    },
    data: {
      initialBalance: -311.67,
      initialBalanceDate: new Date('2026-10-31T00:00:00Z'),
    },
  });

  // Chamar recálculo seguro do Postgres
  const itauAcc = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, name: 'Itau PF' },
  });
  if (itauAcc) {
    await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${itauAcc.id}'::uuid);`);
  }

  console.log(`✅ Conta 'Itau PF' configurada com saldo inicial de -R$ 311,67 em 31/10/2026!`);

  // 2. Conta Inter PF
  await prisma.account.updateMany({
    where: {
      workspaceId: workspace.id,
      name: 'Inter PF',
    },
    data: {
      initialBalance: 12.70,
      initialBalanceDate: new Date('2026-10-31T00:00:00Z'),
    },
  });

  const interAcc = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, name: 'Inter PF' },
  });
  if (interAcc) {
    await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${interAcc.id}'::uuid);`);
  }

  console.log(`✅ Conta 'Inter PF' configurada com saldo inicial de R$ 12,70 em 31/10/2026!`);

  // Exibir resumo da conta
  const itauAccount = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, name: 'Itau PF' },
  });

  console.log(`🏦 ${itauAccount?.name}: Saldo Atual = R$ ${itauAccount?.currentBalance}`);
}

setInitialBalances()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
