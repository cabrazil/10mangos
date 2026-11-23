import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkBr2go() {
  const cats = await prisma.category.findMany({
    where: {
      OR: [
        { name: { contains: 'br2go', mode: 'insensitive' } },
        { name: { contains: 'ti', mode: 'insensitive' } },
      ],
    },
    include: {
      children: true,
      parent: true,
    },
  });

  console.log('Categorias encontradas com BR2GO / TI:');
  for (const c of cats) {
    console.log(`- ID: ${c.id} | Nome: ${c.name} | Tipo: ${c.type} | Pai: ${c.parent?.name || 'Nenhum'}`);
    if (c.children.length > 0) {
      console.log(`  Subcategorias: ${c.children.map(ch => ch.name).join(', ')}`);
    }
  }
}

checkBr2go()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
