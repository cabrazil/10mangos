import { PrismaClient, CategoryType } from '@prisma/client';

const prisma = new PrismaClient();

async function splitInssCategory() {
  console.log('🔄 Atualizando subcategorias de INSS...');

  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });
  if (!workspace) throw new Error('Workspace Pessoal não encontrado');

  // Localizar a categoria pai 'Salário / Faturamento'
  let parent = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      name: 'Salário / Faturamento',
      type: CategoryType.INCOME,
    },
  });

  if (!parent) {
    // Tentar achar qualquer categoria pai de INCOME relacionada
    parent = await prisma.category.findFirst({
      where: {
        workspaceId: workspace.id,
        type: CategoryType.INCOME,
        parentId: null,
      },
    });
  }

  if (!parent) {
    throw new Error('Categoria pai de receita não encontrada');
  }

  console.log(`📁 Categoria Pai: ${parent.name} (${parent.id})`);

  // 1. Procurar subcategoria 'INSS' existente
  const existingInss = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      parentId: parent.id,
      name: 'INSS',
    },
  });

  if (existingInss) {
    // Renomear para 'INSS Carlos'
    await prisma.category.update({
      where: { id: existingInss.id },
      data: { name: 'INSS Carlos' },
    });
    console.log(`✅ Subcategoria 'INSS' renomeada para 'INSS Carlos' (preservando vínculos existentes)`);
  } else {
    // Se não existir 'INSS', garantir que 'INSS Carlos' exista
    const inssCarlos = await prisma.category.findFirst({
      where: {
        workspaceId: workspace.id,
        parentId: parent.id,
        name: 'INSS Carlos',
      },
    });
    if (!inssCarlos) {
      await prisma.category.create({
        data: {
          workspaceId: workspace.id,
          parentId: parent.id,
          name: 'INSS Carlos',
          type: CategoryType.INCOME,
          color: parent.color,
          icon: parent.icon,
        },
      });
      console.log(`✅ Subcategoria 'INSS Carlos' criada com sucesso`);
    } else {
      console.log(`ℹ️ Subcategoria 'INSS Carlos' já existe`);
    }
  }

  // 2. Garantir criação de 'INSS Cris'
  const inssCris = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      parentId: parent.id,
      name: 'INSS Cris',
    },
  });

  if (!inssCris) {
    await prisma.category.create({
      data: {
        workspaceId: workspace.id,
        parentId: parent.id,
        name: 'INSS Cris',
        type: CategoryType.INCOME,
        color: parent.color,
        icon: parent.icon,
      },
    });
    console.log(`✅ Subcategoria 'INSS Cris' criada com sucesso`);
  } else {
    console.log(`ℹ️ Subcategoria 'INSS Cris' já existe`);
  }

  // Listar todas as subcategorias sob o pai
  const subs = await prisma.category.findMany({
    where: {
      workspaceId: workspace.id,
      parentId: parent.id,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\n📋 Subcategorias atuais de '${parent.name}':`);
  for (const s of subs) {
    console.log(`   • ${s.name}`);
  }
}

splitInssCategory()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
