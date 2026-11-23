import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTaba() {
  const taba = await prisma.category.findFirst({
    where: { name: 'Taba' },
    include: {
      children: {
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!taba) {
    console.log('Categoria Taba não encontrada');
    return;
  }

  console.log(`Categoria: ${taba.name} (${taba.type})`);
  console.log('Subcategorias existentes:');
  for (const c of taba.children) {
    console.log(` - ${c.name}`);
  }

  const hasInternet = taba.children.some(c => c.name.toLowerCase() === 'internet');
  console.log(`Tem Internet? ${hasInternet ? 'SIM' : 'NÃO'}`);
}

checkTaba()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
