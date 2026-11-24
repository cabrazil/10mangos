import { PrismaClient, AccountType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📌 Cadastrando nova conta corrente Banco Inter Pessoa Física...');

  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });

  if (!workspace) {
    throw new Error('Workspace Pessoal não encontrado');
  }

  const existing = await prisma.account.findFirst({
    where: {
      workspaceId: workspace.id,
      name: { in: ['Inter PF', 'Banco Inter PF'] },
    },
  });

  let account;
  if (existing) {
    console.log(`ℹ️ Conta já existente encontrada: ${existing.name} (${existing.id}). Atualizando...`);
    account = await prisma.account.update({
      where: { id: existing.id },
      data: {
        name: 'Inter PF',
        type: AccountType.CHECKING,
        currency: 'BRL',
        institutionName: 'Banco Inter',
        bankCode: '077',
        color: '#F97316',
        initialBalance: 12.70,
        initialBalanceDate: new Date('2026-10-31T00:00:00Z'),
      },
    });
  } else {
    account = await prisma.account.create({
      data: {
        workspaceId: workspace.id,
        name: 'Inter PF',
        type: AccountType.CHECKING,
        currency: 'BRL',
        institutionName: 'Banco Inter',
        bankCode: '077',
        color: '#F97316',
        initialBalance: 12.70,
        initialBalanceDate: new Date('2026-10-31T00:00:00Z'),
      },
    });
  }

  // Recalcular saldo através da stored procedure do Postgres
  await prisma.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${account.id}'::uuid);`);

  const updated = await prisma.account.findUnique({
    where: { id: account.id },
  });

  console.log(`✅ Conta criada com sucesso!`);
  console.log({
    id: updated?.id,
    name: updated?.name,
    type: updated?.type,
    currency: updated?.currency,
    initialBalance: updated?.initialBalance,
    initialBalanceDate: updated?.initialBalanceDate,
    currentBalance: updated?.currentBalance,
  });
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
