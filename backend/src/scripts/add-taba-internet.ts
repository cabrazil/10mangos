import { PrismaClient, CategoryType } from '@prisma/client';

const prisma = new PrismaClient();

async function addTabaInternet() {
  console.log('🔄 Adicionando subcategoria "Internet" em "Taba"...');

  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });
  if (!workspace) throw new Error('Workspace Pessoal não encontrado');

  const taba = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      name: 'Taba',
      type: CategoryType.EXPENSE,
    },
  });

  if (!taba) throw new Error('Categoria "Taba" não encontrada');

  const existing = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      parentId: taba.id,
      name: 'Internet',
    },
  });

  if (existing) {
    console.log('ℹ️ Subcategoria "Internet" já existe sob Taba.');
  } else {
    await prisma.category.create({
      data: {
        workspaceId: workspace.id,
        parentId: taba.id,
        name: 'Internet',
        type: CategoryType.EXPENSE,
        color: taba.color,
        icon: taba.icon,
      },
    });
    console.log('✅ Subcategoria "Internet" criada com sucesso sob Taba!');
  }

  const subs = await prisma.category.findMany({
    where: {
      workspaceId: workspace.id,
      parentId: taba.id,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\n📋 Subcategorias atuais de Taba:`);
  for (const s of subs) {
    console.log(`   • ${s.name}`);
  }
}

addTabaInternet()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
