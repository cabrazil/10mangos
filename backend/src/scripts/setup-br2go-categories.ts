import { PrismaClient, CategoryType } from '@prisma/client';

const prisma = new PrismaClient();

async function adjustBr2go() {
  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });
  if (!workspace) throw new Error('Workspace pessoal não encontrado');

  // 1. Atualizar nome da categoria de Despesa para 'BR2GO' (maiúsculas)
  const expenseCat = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      name: { in: ['Br2go', 'BR2GO'] },
      type: CategoryType.EXPENSE,
      parentId: null,
    },
    include: { children: true },
  });

  if (expenseCat) {
    await prisma.category.update({
      where: { id: expenseCat.id },
      data: { name: 'BR2GO' },
    });
    console.log(`✅ Categoria de Despesa 'BR2GO' ajustada (Subcategorias: ${expenseCat.children.map(c => c.name).join(', ')})`);
  }

  // 2. Garantir opções em Receitas para as entradas da empresa
  // Opção A: Categoria Pai 'BR2GO' em Receitas (ou sob Salário/Faturamento)
  let incomeCat = await prisma.category.findFirst({
    where: {
      workspaceId: workspace.id,
      name: 'BR2GO',
      type: CategoryType.INCOME,
      parentId: null,
    },
  });

  if (!incomeCat) {
    incomeCat = await prisma.category.create({
      data: {
        workspaceId: workspace.id,
        name: 'BR2GO (Receitas)',
        type: CategoryType.INCOME,
        icon: 'briefcase',
        color: '#F97316',
      },
    });

    await prisma.category.createMany({
      data: [
        {
          workspaceId: workspace.id,
          parentId: incomeCat.id,
          name: 'Faturamento Clientes',
          type: CategoryType.INCOME,
          color: '#F97316',
        },
        {
          workspaceId: workspace.id,
          parentId: incomeCat.id,
          name: 'Consultoria / Projetos',
          type: CategoryType.INCOME,
          color: '#F97316',
        },
      ],
    });
    console.log(`✅ Categoria de Receita 'BR2GO (Receitas)' criada com subcategorias 'Faturamento Clientes' e 'Consultoria / Projetos'`);
  }
}

adjustBr2go()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
