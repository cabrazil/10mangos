import { PrismaClient, CategoryType } from '@prisma/client';

const prisma = new PrismaClient();

async function addPamelaRepasses() {
  console.log('🔄 Adicionando subcategoria "Repasses" em "Pamela"...');

  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });
  if (!workspace) throw new Error('Workspace Pessoal não encontrado');

  const pamela = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      name: 'Pamela',
      type: CategoryType.EXPENSE,
    },
  });

  if (!pamela) throw new Error('Categoria "Pamela" não encontrada');

  const existing = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      parentId: pamela.id,
      name: 'Repasses',
    },
  });

  if (existing) {
    console.log('ℹ️ Subcategoria "Repasses" já existe sob Pamela.');
  } else {
    await prisma.category.create({
      data: {
        workspaceId: workspace.id,
        parentId: pamela.id,
        name: 'Repasses',
        type: CategoryType.EXPENSE,
        color: pamela.color,
        icon: pamela.icon,
      },
    });
    console.log('✅ Subcategoria "Repasses" criada com sucesso em Pamela!');
  }

  const subs = await prisma.category.findMany({
    where: {
      workspaceId: workspace.id,
      parentId: pamela.id,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\n📋 Subcategorias de Pamela:`);
  for (const s of subs) {
    console.log(`   • ${s.name}`);
  }
}

addPamelaRepasses()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
